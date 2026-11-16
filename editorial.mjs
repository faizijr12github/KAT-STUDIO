import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {execFile} from 'node:child_process';
import path from 'node:path';
import {promisify} from 'node:util';
import {assertEditorial,editingContext,saveLearning} from './learning.mjs';
import {checkRender} from './qa.mjs';
import {ingest,inspect} from './media.mjs';
import {now} from './store.mjs';

const exec=promisify(execFile);
export const contextReceipt=context=>createHash('sha256').update(JSON.stringify(context)).digest('hex');

async function verifyEndScreen(db,file,media,card){
  const {hash,startFrame,sourceInFrame=0,frames}=card;
  const source=db.get('SELECT file,metadata FROM media WHERE hash=?',hash);
  if(!source||![startFrame,sourceInFrame,frames].every(Number.isInteger)||startFrame<0||sourceInFrame<0||
     frames<2||startFrame+frames!==media.frames)throw Error('Render QA: the end-screen source or frame boundaries are invalid.');
  const sourceInfo=JSON.parse(source.metadata);
  if(sourceInFrame/media.fps+(frames-1)/media.fps>=sourceInfo.duration+.01)throw Error('Render QA: the end screen exceeds the supplied clip.');
  const graph=[
    `[0:v]trim=start_frame=${startFrame}:end_frame=${startFrame+frames},setpts=PTS-STARTPTS,scale=270:480,setsar=1[a]`,
    `[1:v]fps=${media.fps},trim=start_frame=${sourceInFrame}:end_frame=${sourceInFrame+frames},setpts=PTS-STARTPTS,scale=270:480,setsar=1[b]`,
    '[a][b]ssim=shortest=1'
  ].join(';');
  const {stderr}=await exec('ffmpeg',['-hide_banner','-nostdin','-xerror','-i',file,'-i',source.file,
    '-filter_complex_threads','1','-filter_complex',graph,'-an','-f','null','-'],{timeout:90000,maxBuffer:2**20});
  const similarity=Number(stderr.match(/\bAll:([\d.]+)/)?.[1]);
  if(!(similarity>=.94))throw Error('Render QA: the final frames do not match the supplied end screen.');
  return similarity;
}

export async function registerEditorial({db,directory,project,file,recipe,summary,contextToken}){
  const context=editingContext(db,project);
  if(!context||contextReceipt(context)!==contextToken)throw Error('Project instructions changed. Retrieve the current editing context before registering the draft.');
  if(typeof summary!=='string'||!summary.trim())throw Error('An editorial summary is required.');
  const info=await inspect(file,'video/mp4');
  assertEditorial(context,info,recipe);
  const similarity=recipe.endCard?await verifyEndScreen(db,file,info,recipe.endCard):null;
  const qa=await checkRender(file,{audio:true,width:info.width,height:info.height,fps:info.fps,frames:info.frames,
    motionEnd:(recipe.endCard?.startFrame??info.frames)/info.fps});
  if(qa.black.length||qa.peakDb===null||qa.peakDb>=-.1)throw Error('Render QA: black frames or invalid audio were detected.');
  const media=await ingest(db,directory,createReadStream(file),path.basename(file),randomUUID());
  return db.tx(()=>{
    if(contextReceipt(editingContext(db,project))!==contextToken)throw Error('Project instructions changed during verification.');
    if(db.get('SELECT id FROM drafts WHERE project=? AND hash=?',project,media.hash))throw Error('This render is already a draft in the project.');
    const id=randomUUID();
    const version=(context.drafts[0]?.version||0)+1;
    const editorialChecks={style:context.style&&`${context.style.name} v${context.style.version}`,
      retrievedLearning:context.learning.filter(l=>['Instruction','Preference'].includes(l.kind)).map(l=>l.id),
      endScreenSimilarity:similarity,review:recipe.review};
    const timeline={kind:'editorial',source:media.hash,start:0,duration:info.duration,fps:info.fps,
      recipe,contextToken,editorialChecks,qa};
    db.run('INSERT INTO drafts VALUES (?,?,?,?,?,?,?,?)',id,project,version,media.hash,JSON.stringify(timeline),summary.trim(),null,now());
    for(const note of recipe.appliedNotes||[]){
      if(!context.notes.some(n=>n.id===note&&['Pending','In Progress'].includes(n.status)))throw Error('An applied note does not belong to this revision.');
      db.run("UPDATE notes SET status='Needs Review' WHERE id=?",note);
    }
    saveLearning(db,{project,kind:'Revision',text:summary,source:id});
    return {id,version,hash:media.hash,info,qa,editorialChecks};
  });
}
