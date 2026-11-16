import {DatabaseSync,backup} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {copyFile,mkdir,readFile,readdir,rename,rm,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const app=path.dirname(fileURLToPath(import.meta.url));
const snapshotFiles=['index.html','studio.css','studio.js','server.mjs','media.mjs','store.mjs','revisions.mjs','qa.mjs','glk-revision.py','glk-score.py','glk-captions.py','glk-word-timing.json','backup.mjs','Open KAT Studio.command','Implementation plan.md','Persistence and recovery.md','persistence.json','README.md','package.json','kat.mjs','bootstrap.sh','requirements.txt','skills','docs','test','fonts','Project Memory','Library'];
const hex=/^[0-9a-f]{64}$/;
const digest=async file=>{
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
};
const readConfig=()=>readFile(path.join(app,'persistence.json'),'utf8').then(JSON.parse);
async function listFiles(directory,prefix='') {
  const entries=await readdir(directory,{withFileTypes:true});
  const files=[];
  for(const item of entries.sort((a,b)=>a.name.localeCompare(b.name))){
    const relative=path.join(prefix,item.name);
    if(item.isDirectory())files.push(...await listFiles(path.join(directory,item.name),relative));
    else if(item.isFile())files.push(relative);
  }
  return files;
}
async function appFiles(){
  const files=[];
  for(const key of snapshotFiles){
    const file=path.join(app,key);
    const info=await stat(file).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(!info)continue;
    files.push(...(info.isDirectory()?await listFiles(file,key):[key]));
  }
  return files;
}
async function pointTo(root,manifest){
  const temp=path.join(root,'.latest-'+randomUUID());
  await writeFile(temp,JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
  await rename(temp,path.join(root,'latest.json'));
}
export async function saveSnapshot(data,root){
  root=path.resolve(root);data=path.resolve(data);
  if(root===data||root.startsWith(data+path.sep)||data.startsWith(root+path.sep))throw Error('Keep the backup and live data in separate locations.');
  const history=path.join(root,'snapshots'), objects=path.join(root,'objects');
  await Promise.all([mkdir(history,{recursive:true,mode:0o700}),mkdir(objects,{recursive:true,mode:0o700})]);
  const scratch=path.join(history,'.partial-'+randomUUID());
  await mkdir(scratch,{mode:0o700});
  try{
    const filename=path.join(scratch,'studio.sqlite');
    const source=new DatabaseSync(path.join(data,'studio.sqlite'),{readOnly:true});
    try{await backup(source,filename);}finally{source.close();}
    const snapshot=new DatabaseSync(filename,{readOnly:true});
    let rows,counts;
    try{
      if(snapshot.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('SQLite snapshot failed integrity check.');
      rows=snapshot.prepare('SELECT hash,size,file FROM media ORDER BY hash').all();
      counts=Object.fromEntries(['projects','clients','styles','assets','drafts','notes','attachments','jobs'].map(table=>[table,snapshot.prepare('SELECT count(*) AS n FROM '+table).get().n]));
    }finally{snapshot.close();}
    for(const row of rows){
      if(!hex.test(row.hash))throw Error('Invalid Studio media identifier.');
      const target=path.join(objects,row.hash);
      const existing=await stat(target).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
      if(existing){if(existing.size!==row.size)throw Error('Stored backup media has the wrong size.');continue;}
      const local=path.join(data,'media',row.hash);
      const file=await stat(local).then(()=>local).catch(error=>{if(error.code!=='ENOENT')throw error;return row.file;});
      const temp=path.join(scratch,row.hash);
      await copyFile(file,temp,constants.COPYFILE_FICLONE);
      if((await stat(temp)).size!==row.size||await digest(temp)!==row.hash)throw Error('Asset did not match its recorded content hash.');
      await rename(temp,target);
    }
    const files=await appFiles(), manifestEntries=[];
    for(const relative of files){
      const from=path.join(app,relative), to=path.join(scratch,'Application',relative);
      await mkdir(path.dirname(to),{recursive:true});
      await copyFile(from,to);
      manifestEntries.push({path:relative,sha256:await digest(to)});
    }
    const signature=createHash('sha256').update(await digest(filename)).update(JSON.stringify(manifestEntries)).digest('hex');
    const previous=await readFile(path.join(root,'latest.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(previous?.signature===signature)return previous;
    const created=new Date().toISOString();
    const name=created.replaceAll(':','-')+'-'+signature.slice(0,8);
    const manifest={schema:1,created,snapshot:name,signature,counts,assets:rows.map(({hash,size})=>({hash,size})),application:manifestEntries};
    await writeFile(path.join(scratch,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600});
    await rename(scratch,path.join(history,name));
    await pointTo(root,manifest);
    return manifest;
  }finally{await rm(scratch,{recursive:true,force:true});}
}

export async function restoreSnapshot(root,destination,version){
  root=path.resolve(root);destination=path.resolve(destination);
  const validName=value=>typeof value==='string'&&/^[-0-9T.Z]+[0-9a-f]{8}$/.test(value);
  if(version!==undefined&&!validName(version))throw Error('Invalid backup snapshot name.');
  const locationOfManifest=version?path.join(root,'snapshots',version,'manifest.json'):path.join(root,'latest.json');
  const manifest=JSON.parse(await readFile(locationOfManifest,'utf8'));
  if(manifest.schema!==1||!validName(manifest.snapshot)||(version&&manifest.snapshot!==version))throw Error('Invalid backup manifest.');
  const snapshot=path.join(root,'snapshots',manifest.snapshot);
  const sourceDatabase=path.join(snapshot,'studio.sqlite');
  const signature=createHash('sha256').update(await digest(sourceDatabase)).update(JSON.stringify(manifest.application)).digest('hex');
  if(signature!==manifest.signature)throw Error('Backup database checksum mismatch.');
  await mkdir(destination,{mode:0o700});
  const location=path.join(destination,'Studio Data');
  await mkdir(path.join(location,'media'),{recursive:true,mode:0o700});
  for(const item of manifest.application){
    const relative=item.path;
    if(path.isAbsolute(relative)||relative.split(path.sep).includes('..'))throw Error('Invalid backup application path.');
    const source=path.join(snapshot,'Application',relative), target=path.join(destination,relative);
    if(await digest(source)!==item.sha256)throw Error('Backup application checksum mismatch.');
    await mkdir(path.dirname(target),{recursive:true});
    await copyFile(source,target,constants.COPYFILE_EXCL);
  }
  const file=path.join(location,'studio.sqlite');
  await copyFile(sourceDatabase,file,constants.COPYFILE_EXCL);
  const database=new DatabaseSync(file);
  try{
    if(database.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Restore database failed integrity check.');
    const items=database.prepare('SELECT hash,size FROM media ORDER BY hash').all();
    if(JSON.stringify(items)!==JSON.stringify(manifest.assets))throw Error('Backup asset manifest does not match the database.');
    for(const {hash,size} of items){
      if(!hex.test(hash))throw Error('Invalid backup media identifier.');
      const source=path.join(root,'objects',hash), target=path.join(location,'media',hash);
      if((await stat(source)).size!==size||await digest(source)!==hash)throw Error('Backup media checksum mismatch.');
      await copyFile(source,target,constants.COPYFILE_EXCL|constants.COPYFILE_FICLONE);
    }
    // Recovered copies get their own paths. The live database is never modified.
    database.exec('BEGIN IMMEDIATE');
    try{
      const statement=database.prepare('UPDATE media SET file=? WHERE hash=?');
      for(const {hash} of items)statement.run(path.join(location,'media',hash),hash);
      database.exec('COMMIT');
    }catch(error){database.exec('ROLLBACK');throw error;}
  }finally{database.close();}
  await writeFile(path.join(destination,'persistence.json'),JSON.stringify({backupDirectory:destination+' Backups',intervalMs:120000})+'\n');
  return manifest;
}
export async function startBackups(data){
  if(process.env.KAT_NO_BACKUPS==='1')return;
  const config=await readConfig();
  if(!process.env.KAT_BACKUP_DIR&&path.resolve(data)!==path.join(app,'Studio Data'))return;
  const root=process.env.KAT_BACKUP_DIR||config.backupDirectory;
  let pending=false;
  const run=async()=>{
    if(pending)return;
    pending=true;
    try{await saveSnapshot(data,root);}
    catch(error){console.error('KAT Studio backup:',error.message);}
    finally{pending=false;}
  };
  void run();
  setInterval(run,Math.max(30000,config.intervalMs)).unref();
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const config=await readConfig();
    const root=process.env.KAT_BACKUP_DIR||config.backupDirectory;
    const action=process.argv[2]||'save';
    if(action==='save'){
      const saved=await saveSnapshot(process.env.KAT_DATA||path.join(app,'Studio Data'),root);
      console.log('Verified snapshot '+saved.snapshot+' ('+saved.assets.length+' media files)');
    }else if(action==='restore'&&process.argv[3]){
      const saved=await restoreSnapshot(root,process.argv[3],process.argv[4]);
      console.log('Recovered '+saved.snapshot+' into '+path.resolve(process.argv[3]));
    }else throw Error('Use backup.mjs save or backup.mjs restore <new-directory> [snapshot-name].');
  }catch(error){console.error(error.message);process.exitCode=1;}
}
