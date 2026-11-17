import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {openStore} from '../store.mjs';
import {assertEditorial,editingContext,saveLearning} from '../learning.mjs';
import {contextReceipt,registerEditorial} from '../editorial.mjs';
import {checkRender} from '../qa.mjs';
test('assisted draft validation, assets, scoped memory, and review/export',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'kat-editorial-'));
  const listener=createServer().listen(0,'127.0.0.1');
  await once(listener,'listening');
  const port=listener.address().port, origin='http://127.0.0.1:'+port;
  await new Promise(resolve=>listener.close(resolve));
  const env={...process.env,KAT_DATA:dir,KAT_PORT:String(port),KAT_NO_SEED:'1',KAT_NO_BACKUPS:'1'};
  let server,base;
  async function start(){
   server=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env,stdio:['ignore','pipe','inherit']});
   const line=await Promise.race([once(server.stdout,'data').then(([buf])=>buf.toString().trim()),
   new Promise((_,reject)=>setTimeout(()=>reject(Error('Studio failed to start')),5000).unref())]);
   assert(line.startsWith(origin+'/'));base=line;
  }
  async function stop(){
   if(!server)return;
   const gone=once(server,'exit');server.kill();await gone;server=null;
  }
  async function api(route,body,expected=200){
   const res=await fetch(base+'api/'+route,body===undefined?{}:{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
   const json=await res.json();assert.equal(res.status,expected,JSON.stringify(json));return json;
  }
  const info=project=>api('editing-context?'+new URLSearchParams({project}));
  async function upload(project,name,file,expected='Auto'){
   const res=await fetch(base+'api/import?'+new URLSearchParams({project,name,category:expected}),
     {method:'POST',headers:{origin,'Content-Type':'application/octet-stream'},body:await readFile(file)});
   assert(res.ok,await res.clone().text());return res.json();
  }
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function completed(job){
   for(let i=0;i<80;i++){
    const state=await api('state');const j=state.jobs.find(j=>j.id===job);
    if(j.state!=='running'){assert.equal(j.state,'complete',j.detail);return j;}
    await wait(220);
   }
   throw Error('Render timed out');
  }
  const ff=(...args)=>execFileSync('ffmpeg',['-v','error','-y',...args],{stdio:'pipe'});
  try{
   const raw=path.join(dir,'landscape.mp4'), card=path.join(dir,'card.mp4'), render=path.join(dir,'fixture.mp4');
   ff('-f','lavfi','-i','testsrc2=s=320x180:r=30','-f','lavfi','-i','sine=frequency=450:sample_rate=48000','-t','1.2','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',raw);
   ff('-f','lavfi','-i','testsrc=s=180x320:r=30','-t','0.4','-c:v','libx264','-pix_fmt','yuv420p',card);
   ff('-i',raw,'-i',card,'-filter_complex','[0:v]scale=180:320,setsar=1[a];[1:v]setsar=1[b];[a][b]concat=n=2:v=1:a=0[v]','-map','[v]','-map','0:a','-af','apad=whole_dur=1.6','-t','1.6','-c:v','libx264','-c:a','aac',render);
   const frozen=path.join(dir,'frozen.mp4');
   ff('-f','lavfi','-i','color=c=black:s=180x320:r=30','-i',raw,'-map','0:v','-map','1:a','-t','1.2','-c:v','libx264','-c:a','copy',frozen);
   const still=path.join(dir,'still.mp4');
   ff('-f','lavfi','-i','color=c=blue:s=180x320:r=30','-i',raw,'-map','0:v','-map','1:a','-t','1.2','-c:v','libx264','-c:a','copy',still);
   await assert.rejects(checkRender(still,{audio:true,motionEnd:1.2}),
     error=>error.code==='KAT_VISUAL_QA'&&error.issues.some(issue=>issue.type==='Unexpected still frame'&&issue.start===0));
   const worker=path.join(dir,'fixture-codex');
   env.KAT_CODEX_BIN=worker;
   await writeFile(worker,`#!${process.execPath}
const fs=require('node:fs');
(async()=>{
 const b=JSON.parse(fs.readFileSync('brief.json'));
 const raw=b.assets.find(a=>a.id===b.source);
 if(!b.assets.some(a=>a.name==='Folder/References/Reference.txt'&&a.text.includes('https://example.org/cut'))||
    b.links.length!==2||!b.style||!b.project.config.brief)process.exit(1);
 let prompt='';
 for await(const chunk of process.stdin)prompt+=chunk;
 const repair=prompt.includes('Previous render failed technical QA: Black frames at 0.00');
 fs.copyFileSync(repair?${JSON.stringify(render)}:${JSON.stringify(frozen)},'draft.mp4');
 fs.writeFileSync('result.json',JSON.stringify({
   summary:'Fixture document cut with authored closing card.',
   recipe:{style:{id:b.style.id,version:b.style.version},sources:[raw.hash],review:{branding:'Checked',pacing:'Checked',audioSync:'Checked',transitions:'Checked'}},
   assetReview:b.assets.map(a=>({id:a.id,status:'inspected',detail:'Fixture input examined'})),
   linkReview:b.links.map(url=>({url,status:'unavailable',detail:'External lookup disabled in fixture'})),
   interventions:['Add a closing sequence']
 }));
})();
`,{mode:0o700});
   await start();
   const initialState=await api('state');
   assert.equal(new Set(initialState.styles.map(row=>row.id)).size,31);
   const gallery=await fetch(base+'style-gallery.js');
   assert.equal(gallery.status,200);
   assert.match(await gallery.text(),/galleryGroups/);
   const style=await api('styles',{name:'Fixture legal brand',rules:'Use upright white captions and the selected project assets.'},201);
   const key=style.id+':'+style.version;
   const {id:project}=await api('projects',{name:'Fixture reel',clientName:'Fixture Law',format:'Vertical',brief:'Retain the narrative.',style:key},201);
   const src=await upload(project,'Project/Raw Video/Interview.mp4',raw);
   const end=await upload(project,'Project/End Screen/Closing.mp4',card);
   assert.equal(src.category,'Raw Footage');assert.equal(end.category,'End Screens');
   assert.equal((await upload(project,'Project/.DS_Store',raw)).ignored,true);
   assert.equal((await upload(project,'Project/Brolls/Meeting.mp4',raw)).category,'B-roll');
   assert.equal((await upload(project,'Project/Brand Guidlines/fonts.txt',raw)).category,'Brand Assets');
   const {id:firstProject}=await api('projects',{name:'First draft fixture',clientName:'Fixture Client',
     format:'Vertical',brief:'Use the uploaded files.',references:'Example https://example.org/ref',style:key},201);
   await api('first-draft',{project:firstProject,asset:'missing'},400);
   await upload(firstProject,'Folder/Raw Video/A-roll.mp4',raw);
   const reference=path.join(dir,'reference.txt');
   await writeFile(reference,'Reference: https://example.org/cut');
   await upload(firstProject,'Folder/References/Reference.txt',reference);
   const firstCtx=await info(firstProject);
   const firstAsset=firstCtx.assets.find(a=>a.category==='Raw Footage');
   const firstJob=await completed((await api('first-draft',{project:firstProject,asset:firstAsset.id},202)).job);
   assert.equal(firstJob.kind,'First Draft');
   assert.equal(firstJob.state,'complete');
   const firstDraft=(await api('state')).drafts.find(d=>d.id===firstJob.draft);
   assert.equal(firstDraft.version,1);
   assert.equal(firstDraft.timeline.kind,'editorial');
   assert.equal(firstDraft.timeline.recipe.intakeReview.links.length,2);
   await api('first-draft',{project:firstProject,asset:firstAsset.id},409);
   const ctx=await info(project);
   assert.equal(ctx.style.id,style.id);
   assert.equal(ctx.assets.filter(a=>a.category==='Raw Footage').length,1);
   console.log('PASS project style, folder classification and ignored metadata');
   const asset=ctx.assets.find(a=>a.category==='Raw Footage').id;
   const preview=await api('preview',{project,asset,first:true},202);
   const previewJob=await completed(preview.job);
   let state=await api('state');
   const initial=state.drafts.find(d=>d.id===previewJob.draft);
   assert.deepEqual([initial.metadata.width,initial.metadata.height,initial.timeline.kind],[1080,1920,'source-preview']);
   await api('approve',{project,draft:initial.id},400);
   console.log('PASS horizontal source produces a portrait intake preview and cannot be approved as an edit');
   const note=await api('notes',{project,draft:initial.id,start:5,end:7,body:'Use the supplied closing screen.'},201);
   await api('learning',{project,scope:'client',text:'Keep white captions on future reels.'},201);
   let db=openStore(dir);
   saveLearning(db,{project,kind:'Instruction',text:'Required exact ending.',source:'fixture-card',checks:{endCardHash:end.hash,reviewChecks:['branding']}});
   let active=editingContext(db,project);
   const recipe={style,sources:[src.hash,end.hash],endCard:{hash:end.hash,startFrame:36,sourceInFrame:0,frames:12},review:{branding:'Matched fixture style.'},appliedNotes:[note.id]};
   assert.throws(()=>assertEditorial(active,{width:320,height:180,audio:true},recipe),/aspect ratio/);
   assert.throws(()=>assertEditorial(active,{width:180,height:320,audio:true},{...recipe,style:{id:style.id,version:999}}),/style version/);
   assert.throws(()=>assertEditorial(active,{width:180,height:320,audio:true},{...recipe,endCard:null}),/selected end screen/);
   assert.throws(()=>assertEditorial(active,{width:180,height:320,audio:true},{...recipe,review:{}}),/review evidence/);
   const params={db,directory:dir,project,file:render,recipe,summary:'Fixture revised with exact end screen.'};
   await assert.rejects(registerEditorial({...params,contextToken:contextReceipt(ctx)}),/instructions changed/);
   const wrongSource=path.join(dir,'wrong.mp4');
   ff('-i',render,'-vf',"negate=enable='gte(n,36)'",'-c:v','libx264','-c:a','copy',wrongSource);
   await assert.rejects(registerEditorial({...params,file:wrongSource,contextToken:contextReceipt(active)}),/do not match the supplied end screen/);
   const saved=await registerEditorial({...params,contextToken:contextReceipt(active)});
   assert.equal(saved.version,2);assert(saved.editorialChecks.endScreenSimilarity>.94);
   assert.equal((await info(project)).notes[0].status,'Needs Review');
   console.log('PASS persisted constraints reject wrong ratio, style, missing review, stale brief and substituted end-screen pixels');
   await api('note-status',{project,note:note.id,status:'Approved'});
   await api('approve',{project,draft:saved.id});
   await api('export',{project,draft:saved.id,width:1920,height:1080,fps:30,confirm:true},400);
   const output=await api('export',{project,draft:saved.id,width:180,height:320,fps:30,confirm:true},202);
   await completed(output.job);
   const latest=await api('latest-draft?'+new URLSearchParams({project}));
   assert.equal(latest.hash,saved.hash);
   const original=Buffer.from(await (await fetch(base+'media/'+latest.hash)).arrayBuffer());
   assert(original.equals(await readFile(render)));
   const client=state.projects.find(p=>p.id===project).client;
   await stop();await start();
   const learned=await info(project);
   assert(learned.learning.some(l=>l.kind==='Approved correction'));
   assert(learned.learning.some(l=>l.kind==='Approved edit'));
   assert(learned.learning.some(l=>l.kind==='Feedback'));
   assert.equal(learned.style.id,style.id);
   assert.equal(learned.constraints.endCardHash,end.hash);
   const {id:sibling}=await api('projects',{name:'Same client',client,format:'Vertical',style:key},201);
   assert((await info(sibling)).learning.some(l=>l.text==='Keep white captions on future reels.'));
   assert(!(await info(sibling)).learning.some(l=>l.source==='fixture-card'));
   const {id:other}=await api('projects',{name:'Different client',clientName:'Other firm',format:'Vertical',style:key},201);
   assert.equal((await info(other)).learning.length,0);
   console.log('PASS approvals and feedback survive restart, client scope is isolated, and approved export uses the edited render');
  }finally{
   await stop();
   await rm(dir,{recursive:true,force:true});
  }

});
