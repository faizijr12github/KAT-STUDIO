import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,mkdir,rm,copyFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore,id,now} from './store.mjs';
import {startBackups} from './backup.mjs';
import {supportsRevision,reviseIntroduction} from './revisions.mjs';
import {isIntake,makeDraftBrief,renderFirstDraft} from './first-draft.mjs';
import {checkRender} from './qa.mjs';
import {classifyAsset,dimensions,editingContext,organizeExistingAssets,matchesFormat,saveLearning} from './learning.mjs';
import {ingest,inspect,encode,streamFile,mediaType} from './media.mjs';

const app=path.dirname(fileURLToPath(import.meta.url));
const directory=path.resolve(process.env.KAT_DATA || path.join(app,'Studio Data'));
const db=openStore(directory);
organizeExistingAssets(db);
const instance=id();
const port=Number(process.env.KAT_PORT||52830);
let token;
try {token=(await readFile(path.join(directory,'access'),'utf8')).trim();}
catch(error) {
  if(error.code!=='ENOENT') throw error;
  token=randomBytes(24).toString('hex');
  await writeFile(path.join(directory,'access'),token,{mode:0o600,flag:'wx'});
}
const origin='http://127.0.0.1:'+port;
const prefix='/'+token+'/';
const active=new Map();
const parse=(row,...keys)=>row&&Object.fromEntries(Object.entries(row).map(([k,v])=>[k,keys.includes(k)?JSON.parse(v):v]));
const clean=(value,max=500)=>typeof value==='string'?value.trim().slice(0,max):'';
const categories=['Raw Footage','Audio','Voiceovers','Music','Sound Effects','Images','Logos','Graphics','End Screens','B-roll','Brand Assets','References','Documents'];
const fail=(code,message)=>Object.assign(new Error(message),{code});
const requireRow=(row,message)=>{if(!row)throw fail(404,message);return row;};
const projectOf=key=>requireRow(db.get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',key),'Project unavailable.');
const draftOf=(project,key)=>requireRow(db.get('SELECT * FROM drafts WHERE id=? AND project=?',key,project),'Draft unavailable.');
const allowedLinks=link=>{try {return ['https:','http:'].includes(new URL(link).protocol);}catch{return false;}};
const html=await readFile(path.join(app,'index.html'));
const css=await readFile(path.join(app,'studio.css'));
const js=await readFile(path.join(app,'studio.js'));
const gallery=await readFile(path.join(app,'style-gallery.js'));
const decode=value=>clean(decodeURIComponent(value||''),400).replaceAll('\\','/').split('/').filter(part=>part&&part!=='.'&&part!=='..').join('/');
const jobLog=(key,state,detail)=>db.run('UPDATE jobs SET state=?,detail=? WHERE id=?',state,detail,key);
function draftFrom(project,m,edit,summary) {
  const ver=db.get('SELECT COALESCE(MAX(version),0)+1 AS v FROM drafts WHERE project=?',project).v;
  const key=id();
  db.run('INSERT INTO drafts VALUES (?,?,?,?,?,?,?,?)',key,project,ver,m.hash,JSON.stringify(edit),summary,null,now());
  return key;
}
function layout() {
  const mediaFields='m.size,m.mime,m.metadata';
  const automatic=new Map();
  const canRevise=d=>{
    if(!supportsRevision(d.project,d.timeline))return false;
    if(!automatic.has(d.project)){
      const {constraints}=editingContext(db,d.project);
      automatic.set(d.project,!constraints.endCardHash&&!constraints.reviewChecks?.length);
    }
    return automatic.get(d.project);
  };
  return {
    projects:db.all('SELECT * FROM projects WHERE deleted_at IS NULL ORDER BY created DESC').map(x=>parse(x,'config')),
    trash:db.all('SELECT id,name,client,deleted_at FROM projects WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'),
    clients:db.all('SELECT * FROM clients ORDER BY name').map(x=>parse(x,'profile')),
    styles:db.all('SELECT * FROM styles ORDER BY name,version DESC').map(x=>parse(x,'rules')),
    assets:db.all(`SELECT a.*,${mediaFields} FROM assets a JOIN media m ON a.hash=m.hash JOIN projects p ON p.id=a.project WHERE p.deleted_at IS NULL ORDER BY a.name`).map(x=>parse(x,'metadata')).filter(item=>classifyAsset(item.name,item.mime)!=='Ignore'),
    drafts:db.all(`SELECT d.*,${mediaFields} FROM drafts d JOIN media m ON d.hash=m.hash JOIN projects p ON p.id=d.project WHERE p.deleted_at IS NULL ORDER BY d.version DESC`).map(x=>{const d=parse(x,'metadata','timeline');return {...d,canRevise:canRevise(d)};}),
    notes:db.all('SELECT n.* FROM notes n JOIN drafts d ON d.id=n.draft JOIN projects p ON p.id=d.project WHERE p.deleted_at IS NULL ORDER BY n.start_frame,n.created').map(n=>({...n,attachments:db.all('SELECT name,hash FROM attachments WHERE note=?',n.id)})),
    jobs:db.all('SELECT j.* FROM jobs j JOIN projects p ON p.id=j.project WHERE p.deleted_at IS NULL ORDER BY j.created DESC LIMIT 100'),
    categories
  };
}
async function seed() {
  if(process.env.KAT_NO_SEED||db.get("SELECT value FROM meta WHERE key='examples'"))return;
  const parent=path.dirname(app);
  const chartFiles=(await import('node:fs/promises')).readdir(parent).then(files=>files.filter(name=>/^animated-five-bar-chart(?:-v\d+)?\.mp4$/.test(name)).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})));
  const examples=[['Personal Short-Form Reel',['personal-short-form-test-reel.mp4'],'Vertical'],['Monthly sales',await chartFiles,'Landscape']];
  for(const [name,files,format] of examples){
    const found=[];
    for(const filename of files){
      const file=path.join(parent,filename);
      try {await stat(file);} catch(error){if(error.code==='ENOENT')continue;throw error;}
      found.push(await ingest(db,directory,createReadStream(file),filename,id()));
    }
    if(!found.length)continue;
    db.tx(()=>{
      let client=db.get("SELECT id FROM clients WHERE id='studio-samples'");
      if(!client){db.run('INSERT INTO clients VALUES (?,?,?)','studio-samples','Studio Samples','{}');client={id:'studio-samples'};}
      const project=name==='Monthly sales'?'sample-chart':'sample-reel';
      if(db.get('SELECT id FROM projects WHERE id=?',project))return;
      db.run('INSERT INTO projects (id,name,client,config,created) VALUES (?,?,?,?,?)',project,name,client.id,JSON.stringify({format,brief:'Existing workspace preview',platforms:[]}),now());
      found.forEach((m,i)=>draftFrom(project,m,{source:m.hash,start:0,duration:JSON.parse(m.metadata).duration},i===0?'Imported original preview':'Imported existing revision'));
    });
  }
  db.run("INSERT OR IGNORE INTO meta VALUES ('examples','1')");
}
await seed();
const bundledStyles=JSON.parse(await readFile(path.join(app,'styles.json'),'utf8'));
db.tx(()=>{
  for(const style of bundledStyles){
    db.run('INSERT OR IGNORE INTO styles VALUES (?,?,?,?,?)',style.id,style.version,style.name,
      JSON.stringify(style.rules),style.created);
  }
});

function qaDetail(report){
  return ['Technical QA complete.', ...report.warnings].join(' ');
}
function startJob(project,draft,options,isDraft){
  if(active.size)throw fail(409,'A video job is already running.');
  const job=id(), total=Math.round(options.duration*options.fps);
  const temp=path.join(directory,job+'.mp4');
  db.run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)',job,project,draft,isDraft?'Source Preview':'Export','running',0,0,total,'Encoding video',null,now());
  let cancelled=false;
  const qaControl=new AbortController();
  const processing=encode({...options,output:temp,draft:isDraft,onProgress:frames=>{
    db.run('UPDATE jobs SET frames=?,progress=? WHERE id=?',Math.min(total,frames),Math.min(.99,frames/total),job);
  }});
  active.set(job,()=>{cancelled=true;processing.cancel();qaControl.abort();});
  void (async()=>{
    try {
      await processing.done;
      if(cancelled){jobLog(job,'cancelled','Cancelled.');return;}
      jobLog(job,'running','Checking rendered video and audio');
      const qa=await checkRender(temp,{...options,signal:qaControl.signal});
      const media=await ingest(db,directory,createReadStream(temp),'video.mp4',id());
      if(cancelled){jobLog(job,'cancelled','Cancelled.');return;}
      if(!JSON.parse(media.metadata).duration)throw Error('Export has no playable video duration.');
      db.tx(()=>{
        if(isDraft){
          const draftId=draftFrom(project,media,{kind:'source-preview',source:options.hash,start:options.start,duration:options.duration,qa},`Source preview · ${options.start.toFixed(2)}–${(options.start+options.duration).toFixed(2)} seconds`);
          db.run('UPDATE jobs SET draft=? WHERE id=?',draftId,job);
        }
        db.run("UPDATE jobs SET state='complete',progress=1,frames=total,hash=?,detail=? WHERE id=?",media.hash,qaDetail(qa),job);
      });
    } catch(error) {jobLog(job,cancelled?'cancelled':'failed',cancelled?'Cancelled.':clean(error.message,600));}
    finally {active.delete(job);await rm(temp,{force:true});}
  })();
  return job;
}
function startRevision(draft,notes,context){
  if(active.size||db.get("SELECT id FROM jobs WHERE state='running' LIMIT 1"))throw fail(409,'A video job is already running.');
  const job=id(), dir=path.join(directory,'revisions',job);
  const control={cancelled:false,stop:null};
  const qaControl=new AbortController();
  db.run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)',job,draft.project,draft.id,'Revision','running',0,0,0,'Codex is reviewing the submitted notes',null,now());
  active.set(job,()=>{control.cancelled=true;control.stop?.();qaControl.abort();});
  void (async()=>{
    try{
      const result=await reviseIntroduction({db,app,dir,draft,notes,context,control,onStage:detail=>jobLog(job,'running',detail)});
      if(control.cancelled){jobLog(job,'cancelled','Cancelled.');return;}
      if(!result.changed){
        jobLog(job,'needs_review',clean('No draft was changed. '+result.decisions.map(n=>n.reason).join(' '),800));
        return;
      }
      jobLog(job,'running','Checking revised video and audio');
      const [width,height]=dimensions(context.constraints.format)||[];
      const qa=await checkRender(result.file,{audio:true,fps:30,width,height,
        frames:result.settings.cleanEnding?1022:1033,
        motionEnd:result.settings.cleanEnding?884/30:undefined,signal:qaControl.signal});
      const rendered=await ingest(db,directory,createReadStream(result.file),'revision.mp4',id());
      if(control.cancelled){jobLog(job,'cancelled','Cancelled.');return;}
      const mediaInfo=JSON.parse(rendered.metadata);
      if(rendered.hash===draft.hash)throw Error('The revised preview did not pass validation.');
      const applied=result.decisions.filter(n=>n.applied);
      const remaining=result.decisions.filter(n=>!n.applied);
      const summary=clean(applied.map(n=>n.reason).join(' '),600);
      db.tx(()=>{
        const fresh=draftFrom(draft.project,rendered,{...JSON.parse(draft.timeline),source:rendered.hash,start:0,duration:mediaInfo.duration,revisionSettings:result.settings,qa,
          editorialChecks:{style:context.style&&context.style.name+' v'+context.style.version,
            retrievedLearning:context.learning.filter(l=>['Preference','Instruction'].includes(l.kind)).map(l=>l.id)}},summary);
        saveLearning(db,{project:draft.project,kind:'Revision',text:summary,source:fresh});
        for(const n of applied)db.run("UPDATE notes SET status='Needs Review' WHERE id=? AND status='Pending'",n.id);
        const detail=clean(qaDetail(qa)+' '+summary+(remaining.length?' Pending: '+remaining.map(n=>n.reason).join(' '):''),800);
        db.run("UPDATE jobs SET state='complete',progress=1,draft=?,hash=?,detail=? WHERE id=?",fresh,rendered.hash,detail,job);
      });
    }catch(error){
      console.error('Revision failed:', error.message);
      jobLog(job,control.cancelled?'cancelled':'failed',control.cancelled?'Cancelled.':(error.message.startsWith('Render QA')?error.message+' Your current draft is preserved.':'Codex could not finish the revision. Your notes and current draft are available for retry.'));
    }finally{
      active.delete(job);
      await rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  })();
  return job;
}
function startFirstDraft(context,brief){
  if(active.size||db.get("SELECT id FROM jobs WHERE state='running' LIMIT 1"))throw fail(409,'A video job is already running.');
  const project=context.project.id;
  const job=id(),dir=path.join(directory,'first-drafts',job);
  const controller=new AbortController();
  db.run('INSERT INTO jobs VALUES (?,?,?,?,?,?,?,?,?,?,?)',job,project,null,'First Draft','running',0,0,0,'Preparing the folder inventory',null,now());
  active.set(job,()=>controller.abort());
  void (async()=>{
    try{
      const draft=await renderFirstDraft({db,directory,context,brief,dir,signal:controller.signal,
        onStage:detail=>jobLog(job,'running',detail)});
      const unavailable=[...draft.intakeReview.assets,...draft.intakeReview.links].filter(item=>item.status==='unavailable').length;
      const detail=unavailable?`Draft ready. ${unavailable} inputs could not be inspected. See the input review for details.`:'Edited draft ready. Technical QA complete.';
      db.run("UPDATE jobs SET state='complete',progress=1,draft=?,hash=?,detail=? WHERE id=?",draft.id,draft.hash,detail,job);
    }catch(error){
      const message=error.code==='ENOENT'?'Install or configure a signed-in Codex CLI and retry.':clean(error.message,300);
      jobLog(job,controller.signal.aborted?'cancelled':'failed',controller.signal.aborted?'Draft cancelled.':message);
    }finally{
      active.delete(job);
      await rm(dir,{recursive:true,force:true}).catch(()=>{});
    }
  })();
  return job;
}
function exportOptions(m,body,preview,format){
  const info=JSON.parse(m.metadata);
  if(!m.mime.startsWith('video/')||!(info.duration>0))throw fail(400,'Choose playable video media.');
  const start=preview?Number(body.start):0;
  const end=preview?Math.min(info.duration,Number(body.end)):info.duration;
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<.042)throw fail(400,'Choose a valid range of at least one frame.');
  let width=Number(body.width),height=Number(body.height),fps=Number(body.fps);
  if(preview){
    const factor=Math.min(1,960/Math.max(info.width,info.height));
    [width,height]=dimensions(format)||[Math.max(2,2*Math.floor(info.width*factor/2)),Math.max(2,2*Math.floor(info.height*factor/2))];fps=Math.min(60,Math.max(12,info.fps||30));
  }
  const codec=body.codec||'h264';
  if(![width,height].every(n=>Number.isInteger(n)&&n%2===0&&n>=2&&n<=3840)||!Number.isFinite(fps)||fps<12||fps>60||!['h264','hevc'].includes(codec))throw fail(400,'Choose even dimensions up to 3840, 12–60 fps, and a supported codec.');
  return {file:m.file,hash:m.hash,start,duration:end-start,width,height,fps,codec,audio:info.audio};
}
async function jsonBody(req){
  let body='';
  for await(const chunk of req){body+=chunk;if(body.length>128000)throw fail(413,'Request is too large.');}
  let parsed;
  try{parsed=JSON.parse(body);}catch{throw fail(400,'Invalid request data.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw fail(400,'Invalid request data.');
  return parsed;
}
const json=(res,code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
const staticFiles={'':['text/html;charset=utf-8',html],'studio.css':['text/css;charset=utf-8',css],'studio.js':['text/javascript;charset=utf-8',js],'style-gallery.js':['text/javascript;charset=utf-8',gallery]};
const security={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; img-src 'self' blob:; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; style-src 'self' 'unsafe-inline'; base-uri 'none'"};
const server=createServer(async(req,res)=>{
  try{
    if(req.headers.host!==new URL(origin).host||!req.url.startsWith(prefix))throw fail(404,'Studio page unavailable.');
    const url=new URL(req.url,origin), route=url.pathname.slice(prefix.length), query=url.searchParams;
    const segments=route.split('/');
    if(req.method==='GET'&&Object.hasOwn(staticFiles,route)){
      const [type,content]=staticFiles[route];res.writeHead(200,{...security,'Content-Type':type});return res.end(content);
    }
    if(req.method==='GET'&&route==='api/state'){
      const tag='"'+instance+'.'+db.revision()+'"';
      res.setHeader('ETag',tag);
      res.setHeader('Cache-Control','no-store');
      if(req.headers['if-none-match']===tag){res.writeHead(304);return res.end();}
      return json(res,200,layout());
    }
    if(req.method==='GET'&&route==='api/editing-context'){
      return json(res,200,editingContext(db,projectOf(query.get('project')).id));
    }
    if(req.method==='GET'&&route==='api/latest-draft'){
      const project=projectOf(query.get('project'));
      const draft=requireRow(db.get('SELECT d.version,d.hash,m.size,m.mime FROM drafts d JOIN media m ON m.hash=d.hash WHERE d.project=? ORDER BY d.version DESC LIMIT 1',project.id),'No rendered draft is available.');
      const filenameBase=project.name.replace(/[^\p{L}\p{N}]+/gu,'_').replace(/^_+|_+$/g,'')||'Project';
      const extension={'video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm'}[draft.mime]||'mp4';
      const filename=filenameBase+'_Draft'+String(draft.version).padStart(2,'0')+'.'+extension;
      return json(res,200,{version:draft.version,hash:draft.hash,size:draft.size,mime:draft.mime,filename});
    }

    if(['GET','HEAD'].includes(req.method)&&segments[0]==='media'&&/^[a-f0-9]{64}$/.test(segments[1]||'')){
      const m=requireRow(db.get('SELECT * FROM media WHERE hash=?',segments[1]),'Media unavailable.');
      const known=/^(video|audio|image)\//.test(m.mime);
      return await streamFile(req,res,m.file,m.mime,query.has('download')||!known?(decode(query.get('download'))||'download'):null);
    }
    if(req.method!=='POST'||req.headers.origin!==origin)throw fail(403,'Open KAT Studio locally to make changes.');
    if(route==='api/import'||route==='api/attach'){
      const project=projectOf(query.get('project')).id;
      const name=decode(query.get('name'));
      if(!name)throw fail(400,'A filename is required.');
      const attach=route==='api/attach';
      const note=attach?requireRow(db.get('SELECT n.* FROM notes n JOIN drafts d ON d.id=n.draft WHERE n.id=? AND d.project=?',query.get('note'),project),'Note unavailable.'):null;
      const detected=classifyAsset(name,mediaType(name));
      const category=query.get('category');
      if(!attach&&detected==='Ignore'){req.resume();return json(res,200,{ignored:true});}
      if(!attach&&category!=='Auto'&&!categories.includes(category))throw fail(400,'Select an asset category.');
      const m=await ingest(db,directory,req,name,id()).catch(error=>{throw fail(422,'Could not import '+name+'. '+clean(error.message,160));});
      projectOf(project);
      if(attach)db.run('INSERT OR IGNORE INTO attachments VALUES (?,?,?)',note.id,m.hash,name);
      else{
        db.run('INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?)',id(),project,m.hash,name,category==='Auto'?detected:category);
      }
      return json(res,201,{hash:m.hash,category:attach?undefined:category==='Auto'?detected:category});
    }
    if(route==='api/shutdown'&&process.env.KAT_PORTABLE==='1'){
      if(active.size)throw fail(409,'Finish or cancel running video jobs first.');
      res.setHeader('Connection','close');
      res.once('finish',()=>server.close());
      return json(res,200,{});
    }
    const b=await jsonBody(req);
    if(route==='api/projects'){
      const name=clean(b.name,120), clientName=clean(b.clientName,120);
      if(!name||(!b.client&&!clientName))throw fail(400,'Enter a project and client name.');
      const key=id();
      db.tx(()=>{
        const client=b.client?requireRow(db.get('SELECT id FROM clients WHERE id=?',b.client),'Client unavailable.').id:id();
        if(!b.client)db.run('INSERT INTO clients VALUES (?,?,?)',client,clientName,JSON.stringify({
          description:clean(b.description,12000),brand:clean(b.brand,12000),links:clean(b.links,8000).split(/\s+/).filter(allowedLinks)
        }));
        const style=b.style?requireRow(db.get('SELECT id,version FROM styles WHERE id||\':\'||version=?',b.style),'Style unavailable.'):null;
        db.run('INSERT INTO projects (id,name,client,config,created) VALUES (?,?,?,?,?)',key,name,client,JSON.stringify({
          brief:clean(b.brief,16000),brand:clean(b.brand,12000),references:clean(b.references,12000),format:clean(b.format,40),style,platforms:Array.isArray(b.platforms)?b.platforms.map(v=>clean(v,40)).slice(0,10):[]
        }),now());
        const brief=clean(b.brief,16000);
        if(brief)saveLearning(db,{project:key,kind:'Instruction',text:brief,source:'initial-brief'});
      });
      return json(res,201,{id:key});
    }
    if(route==='api/styles'){
      const name=clean(b.name,100), rules=clean(b.rules,16000);
      if(!name||!rules)throw fail(400,'Enter a style name and editing rules.');
      let key=b.id||id(), version=1;
      if(b.id){
        const source=requireRow(db.get('SELECT MAX(version) AS version FROM styles WHERE id=?',key),'Style unavailable.');
        if(!source.version||b.confirm!==true)throw fail(400,'Confirm the new style version.');
        version=source.version+1;
      }
      db.run('INSERT INTO styles VALUES (?,?,?,?,?)',key,version,name,JSON.stringify({category:clean(b.category,80),rules}),now());
      return json(res,201,{id:key,version});
    }
    if(route==='api/trash/purge'){
      if(b.confirm!==true)throw fail(400,'Confirm permanent deletion.');
      db.tx(()=>{
        const project=requireRow(db.get('SELECT id FROM projects WHERE id=? AND deleted_at IS NOT NULL',b.project),'Project is unavailable in Trash.').id;
        if(db.get("SELECT id FROM jobs WHERE project=? AND state='running'",project))throw fail(409,'Cancel or finish the running render first.');
        db.run('DELETE FROM attachments WHERE note IN (SELECT n.id FROM notes n JOIN drafts d ON n.draft=d.id WHERE d.project=?)',project);
        db.run('DELETE FROM notes WHERE draft IN (SELECT id FROM drafts WHERE project=?)',project);
        db.run('DELETE FROM jobs WHERE project=?',project);
        db.run('DELETE FROM drafts WHERE project=?',project);
        db.run('DELETE FROM assets WHERE project=?',project);
        db.run('DELETE FROM projects WHERE id=?',project);
      });
      return json(res,200,{});
    }
    if(route==='api/trash/restore'){
      const restored=db.run('UPDATE projects SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL',b.project);
      if(!restored.changes)throw fail(404,'Project is unavailable in Trash.');
      return json(res,200,{});
    }
    const activeProject=projectOf(b.project);
    const project=activeProject.id;
    const config=JSON.parse(activeProject.config);
    if(route==='api/learning'){
      const instruction=clean(b.text,8000);
      if(!instruction||!['project','client'].includes(b.scope))throw fail(400,'Enter an instruction and choose its scope.');
      const key=saveLearning(db,{project,kind:b.scope==='client'?'Preference':'Instruction',text:instruction,scope:b.scope});
      return json(res,201,{id:key});
    }
    if(route==='api/project-style'){
      const style=b.style?requireRow(db.get("SELECT id,version FROM styles WHERE id||':'||version=?",b.style),'Style unavailable.'):null;
      if(db.get("SELECT id FROM jobs WHERE project=? AND state='running'",project))throw fail(409,'Finish the current job before changing the style.');
      db.run('UPDATE projects SET config=? WHERE id=?',JSON.stringify({...config,style}),project);
      return json(res,200,{});
    }
    if(route==='api/trash/delete'){
      if(b.confirm!==true)throw fail(400,'Confirm moving the project to Trash.');
      if(db.get("SELECT id FROM jobs WHERE project=? AND state='running'",project))throw fail(409,'Cancel or finish the running render before deleting this project.');
      db.run('UPDATE projects SET deleted_at=? WHERE id=?',now(),project);
      return json(res,200,{});
    }
    if(route==='api/revise'){
      const draft=draftOf(project,b.draft);
      if(!supportsRevision(project,JSON.parse(draft.timeline)))throw fail(400,'Automatic revisions are unavailable for this draft.');
      const notes=db.all("SELECT id,body,start_frame,end_frame FROM notes WHERE draft=? AND status='Pending' ORDER BY start_frame,created",draft.id);
      if(!notes.length)throw fail(400,'Add a pending note before submitting.');
      if(notes.length>20)throw fail(400,'Submit no more than 20 pending notes at a time.');
      const context=editingContext(db,project);
      if(context.constraints.endCardHash||context.constraints.reviewChecks?.length)throw fail(422,'Use Prepare edit for Codex to apply and verify the saved editorial requirements for this revision.');
      return json(res,202,{job:startRevision(draft,notes,context)});
    }
    if(route==='api/notes'){
      const draft=draftOf(project,b.draft), m=db.get('SELECT metadata FROM media WHERE hash=?',draft.hash), video=JSON.parse(m.metadata);
      const last=(video.frames||Math.ceil(video.duration*(video.fps||30)))-1;
      const start=Number(b.start),end=Number(b.end),body=clean(b.body,4000);
      if(!body||![start,end].every(Number.isInteger)||start<0||end<start||end>last)throw fail(400,'Enter a note and a frame range inside this draft.');
      const key=id();
      db.tx(()=>{
        db.run('INSERT INTO notes VALUES (?,?,?,?,?,?,?,?,?)',key,draft.id,start,end,body,['High','Normal','Low'].includes(b.priority)?b.priority:'Normal','Pending',allowedLinks(b.link)?b.link:null,now());
        saveLearning(db,{project,kind:'Feedback',text:body,source:key});
      });
      return json(res,201,{id:key});
    }
    if(route==='api/note-status'){
      const n=requireRow(db.get('SELECT n.id FROM notes n JOIN drafts d ON d.id=n.draft WHERE n.id=? AND d.project=?',b.note,project),'Note unavailable.');
      if(!['Pending','In Progress','Fixed','Needs Review','Approved'].includes(b.status))throw fail(400,'Unknown note status.');
      db.tx(()=>{
        db.run('UPDATE notes SET status=? WHERE id=?',b.status,n.id);
        if(b.status==='Approved')saveLearning(db,{project,kind:'Approved correction',
          text:db.get('SELECT body FROM notes WHERE id=?',n.id).body,source:n.id});
      });return json(res,200,{});
    }
    if(route==='api/approve'){
      const draft=draftOf(project,b.draft);
      if(JSON.parse(draft.timeline).kind==='source-preview'||/^Trim to /.test(draft.summary))throw fail(400,'Create an editorial draft before approving a source preview.');
      db.tx(()=>{
        db.run('UPDATE drafts SET approved=COALESCE(approved,?) WHERE id=?',now(),draft.id);
        saveLearning(db,{project,kind:'Approved edit',text:'Draft '+draft.version+' approved. '+draft.summary,source:draft.id});
      });
      return json(res,200,{});
    }
    if(route==='api/first-draft'){
      const context=editingContext(db,project);
      if(context.drafts.some(d=>!isIntake(d)))throw fail(409,'An edited draft already exists. Open it in Draft Review.');
      if(context.missingAssets.length)throw fail(422,'Import the required end screen before editing.');
      if(!context.assets.some(a=>a.id===b.asset&&a.category==='Raw Footage'&&a.mime.startsWith('video/')&&a.metadata.duration>0))
        throw fail(400,'Choose an imported raw video.');
      const brief=await makeDraftBrief(db,context,b.asset);
      return json(res,202,{job:startFirstDraft(context,brief)});
    }
    if(route==='api/preview'){
      if(b.first===true){
        const existing=db.get('SELECT id FROM drafts WHERE project=? AND version=1',project);
        if(existing)return json(res,200,{draft:existing.id});
      }
      const media=requireRow(db.get('SELECT m.* FROM assets a JOIN media m ON a.hash=m.hash WHERE a.id=? AND a.project=?',b.asset,project),'Video asset unavailable.');
      return json(res,202,{job:startJob(project,null,exportOptions(media,b.first===true?{start:0,end:JSON.parse(media.metadata).duration}:b,true,config.format),true)});
    }
    if(route==='api/export'){
      const draft=draftOf(project,b.draft);
      if(!draft.approved||b.confirm!==true)throw fail(400,'Approve the draft and confirm export settings first.');
      const original=draft.timeline&&JSON.parse(draft.timeline);
      const canUseSource=Boolean(original?.source&&original.source!==draft.hash);
      const media=requireRow(db.get('SELECT * FROM media WHERE hash=?',canUseSource?original.source:draft.hash),'Draft media unavailable.');
      const opts=exportOptions(media,b,false);
      if(!matchesFormat(opts.width,opts.height,config.format))throw fail(400,'Export dimensions must match the project format.');
      if(canUseSource){opts.start=original.start;opts.duration=original.duration;}
      return json(res,202,{job:startJob(project,draft.id,opts,false)});
    }
    if(route==='api/cancel'){
      const job=requireRow(db.get('SELECT id FROM jobs WHERE id=? AND project=?',b.job,project),'Job unavailable.');
      const stop=active.get(job.id);if(!stop)throw fail(409,'The job is no longer running.');
      stop();return json(res,202,{});
    }
    throw fail(404,'Action unavailable.');
  }catch(error){
    if(res.headersSent||res.destroyed)return;
    if(typeof error.code!=='number')console.error(error);
    json(res,typeof error.code==='number'?error.code:500,{error:typeof error.code==='number'?error.message:'KAT Studio could not complete this action.'});
  }
});
server.listen(port,'127.0.0.1',()=>{
  db.run("UPDATE jobs SET state='interrupted',detail='Studio closed before the job finished.' WHERE state='running'");
  console.log(origin+prefix);
  startBackups(directory).catch(error=>console.error('KAT Studio backup:',error.message));
});
