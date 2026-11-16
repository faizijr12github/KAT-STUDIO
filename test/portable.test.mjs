import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const app=fileURLToPath(new URL('..',import.meta.url));
const launcher=path.join(app,'kat.mjs');
function cli(args,env){
  return execFileSync(process.execPath,[launcher,...args],{cwd:app,env,encoding:'utf8'});
}
function cliAsync(args,env){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[launcher,...args],{cwd:app,env});
    let stdout='',stderr='';
    child.stdout.on('data',data=>{stdout+=data;});
    child.stderr.on('data',data=>{stderr+=data;});
    child.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout):reject(Error(stderr)));
  });
}
async function freePort(){
  const listener=createServer().listen(0,'127.0.0.1');
  await once(listener,'listening');
  const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  return String(port);
}
test('init, open, update-independent data location, verified backup and recovery',async()=>{
  const home=await mkdtemp(path.join(tmpdir(),'kat-cli-test-'));
  const data=path.join(home,'project-files'), skills=path.join(home,'skills'), backups=path.join(home,'backups');
  const env={...process.env,KAT_HOME:home,KAT_DATA:data,KAT_PORT:await freePort(),KAT_SKILL_DIR:skills,KAT_BACKUP_DIR:backups,KAT_NO_BROWSER:'1',KAT_NO_BACKUPS:'1'};
  try{
    cli(['init'],env);
    const skill=path.join(skills,'kat-studio');
    const text=await readFile(path.join(skill,'SKILL.md'),'utf8');
    assert.match(text,/^---\nname: kat-studio\ndescription: .+\n---/);
    assert.equal(JSON.parse(await readFile(path.join(skill,'workspace.json'))).launcher,launcher);
    cli(['init'],env);
    assert.equal(await readFile(path.join(skill,'SKILL.md'),'utf8'),text);
    const nextEnv={...env};
    delete nextEnv.KAT_DATA;
    delete nextEnv.KAT_PORT;
    const url=(await cliAsync(['open'],nextEnv)).trim();
    const root=new URL(url);
    const response=await fetch(new URL('api/projects',root),{
      method:'POST',headers:{Origin:root.origin,'Content-Type':'application/json'},
      body:JSON.stringify({name:'Portable fixture',clientName:'Test'})
    });
    assert.equal(response.status,201);
    assert.equal(JSON.parse(cli(['status'],nextEnv)).data,data);
    assert.match(cli(['save'],nextEnv),/Verified snapshot/);
    const restored=path.join(home,'restored');
    assert.match(cli(['restore',restored],nextEnv),/Recovered/);
    const restoredFiles=await readdir(path.join(restored,'Studio Data'));
    assert(restoredFiles.includes('studio.sqlite'));
    assert(!restoredFiles.includes('access'));
    await writeFile(path.join(skill,'SKILL.md'),text+'\nLocal edits.\n');
    cli(['init'],nextEnv);
    assert.match(await readFile(path.join(skill,'SKILL.md'),'utf8'),/Local edits/);
    await cliAsync(['stop'],nextEnv);
    assert.equal(JSON.parse(cli(['status'],nextEnv)).running,false);
  }finally{
    try{await cliAsync(['stop'],env);}finally{await rm(home,{recursive:true,force:true});}
  }
});
