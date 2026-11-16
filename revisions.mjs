import {spawn} from 'node:child_process';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import path from 'node:path';

export const introductionProject='b37bdaa3-c847-46b8-8c05-28be87a8acf9';
const sourceNames={
  portrait:'Introduction/Raw Video/Introduction.mp4',
  office:'Introduction/Brolls/DJI_20250603132737_0032_D.MP4',
  meeting:'Introduction/Brolls/IMG_3602.MOV',
  desk:'Introduction/Brolls/IMG_3641.MOV',
  end_card:'Introduction/End Screen/GLK Law - End Screen.mp4',
};
const defaults={animateLowerThird:false,officeFullScreen:false,captionSize:32,showCallout:true,
  lowerThirdYOffset:0,stableCaptions:false,bannerAbove:false,officeEndFrame:251,
  mentoringStartFrame:739,mentoringEndFrame:833,cleanEnding:false,warmMusic:false};
const switches=['animateLowerThird','officeFullScreen','showCallout','stableCaptions','bannerAbove','cleanEnding','warmMusic'];
const ranges={captionSize:[26,50],lowerThirdYOffset:[0,120],officeEndFrame:[230,275],mentoringStartFrame:[720,765],mentoringEndFrame:[780,870]};
export function supportsRevision(project,timeline){
  return project===introductionProject&&Boolean(timeline.edit||timeline.revisionSettings);
}
function command(executable,args,control,{cwd,input='',env=process.env,timeout=240000}={}){
  if(control.cancelled)throw new Error('Revision cancelled.');
  return new Promise((resolve,reject)=>{
    const child=spawn(executable,args,{cwd,env,detached:true,stdio:['pipe','ignore','pipe']});
    let stderr='';
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-3500);});
    const stop=()=>{if(child.pid)try{if(process.platform==='win32')child.kill();else process.kill(-child.pid,'SIGTERM');}catch{}};
    control.stop=stop;
    const timer=setTimeout(stop,timeout);
    child.stdin.on('error',()=>{});child.stdin.end(input);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('close',code=>{
      clearTimeout(timer);control.stop=null;
      if(code===0&&!control.cancelled)resolve();
      else reject(new Error(control.cancelled?'Revision cancelled.':executable+' failed: '+stderr));
    });
  });
}
function validate(proposal,previous,notes){
  const settings=proposal?.settings;
  if(!settings||!switches.every(key=>typeof settings[key]==='boolean')||
      !Object.entries(ranges).every(([key,[min,max]])=>Number.isInteger(settings[key])&&settings[key]>=min&&settings[key]<=max)||
      !Array.isArray(proposal.results)||proposal.results.length!==notes.length)throw Error('Codex returned an invalid revision plan.');
  const actual=Object.fromEntries(Object.keys(defaults).map(key=>[key,settings[key]]));
  const allowedIds=new Set(notes.map(note=>note.id));
  const decisions=proposal.results.map(result=>{
    if(!allowedIds.delete(result.id)||typeof result.applied!=='boolean'||typeof result.reason!=='string'||!result.reason.trim())throw Error('Codex returned invalid note decisions.');
    return {id:result.id,applied:result.applied,reason:result.reason.slice(0,220)};
  });
  const changed=Object.keys(defaults).some(key=>previous[key]!==actual[key]);
  if(!changed)return {settings:actual,decisions:decisions.map(result=>({...result,applied:false})),changed};
  if(!decisions.some(result=>result.applied))throw Error('Codex proposed changes without identifying an applied note.');
  return {settings:actual,decisions,changed};
}

function resolvePlayheadCue(note,settings){
  const text=note.body.trim().replace(/[.!?]+$/,'');
  if(!/^(?:please\s+)?(?:keep|extend|trim) (?:the )?(?:(office|mentoring) )?b[\s-]?roll (?:on )?(?:till|until|through|to) (?:right )?here$/i.test(text))return null;
  const marker=note.start_frame;
  const clips=[
    {label:'office',start:164,key:'officeEndFrame'},
    {label:'mentoring',start:settings.mentoringStartFrame,key:'mentoringEndFrame'}
  ];
  const clip=clips.find(item=>marker>=item.start&&marker<=settings[item.key]+36);
  if(!clip||(/\boffice\b/i.test(text)&&clip.label!=='office')||(/\bmentoring\b/i.test(text)&&clip.label!=='mentoring'))return null;
  const out=marker+1;
  const [min,max]=ranges[clip.key];
  if(out<min||out>max)return null;
  if(out===settings[clip.key])return {id:note.id,applied:false,reason:'The '+clip.label+' B-roll already holds through the selected frame.'};
  settings[clip.key]=out;
  return {id:note.id,applied:true,reason:'Kept the '+clip.label+' B-roll through '+(marker/30).toFixed(2)+'s and returned to Jay at '+(out/30).toFixed(2)+'s.'};
}

function resolveSentenceCue(note,words,settings){
  const text=note.body.trim().replace(/[.!?]+$/,'');
  if(!/^(?:please\s+)?(?:extend|keep) (?:the )?(?:office )?b[\s-]?roll (?:on )?(?:until|through) (?:the )?(?:speaker )?(?:finishes (?:the )?(?:complete )?sentence|(?:end|completion) of (?:the )?sentence)$/i.test(text))return null;
  const marker=note.start_frame;
  if(marker<164||marker>settings.officeEndFrame+36)return null;
  // A punctuation boundary uses the onset of the next spoken sentence.
  const last=Math.max(marker,settings.officeEndFrame);
  const boundary=words.findIndex(([word],index)=>/[.!?]$/.test(word)&&words[index+1]&&Math.ceil(words[index+1][1]*30)>=last);
  if(boundary<0)return null;
  const frame=Math.ceil(words[boundary+1][1]*30);
  if(frame===settings.officeEndFrame)return {id:note.id,applied:false,reason:'The office B-roll already ends at the next spoken sentence.'};
  if(frame<ranges.officeEndFrame[0]||frame>ranges.officeEndFrame[1])return null;
  settings.officeEndFrame=frame;
  return {id:note.id,applied:true,reason:'Extended the office B-roll through “Gersowitz, Libo & Korek” to the transcript boundary at '+(frame/30).toFixed(2)+' seconds.'};
}

export async function reviseIntroduction({db,app,dir,draft,notes,control,onStage}){
  const sources={};
  for(const [key,name] of Object.entries(sourceNames)){
    const source=db.get('SELECT m.file FROM assets a JOIN media m ON m.hash=a.hash WHERE a.project=? AND a.name=?',draft.project,name);
    if(!source)throw Error('Missing project footage: '+name);
    sources[key]=source.file;
  }
  const timeline=JSON.parse(draft.timeline);
  const previous={...defaults,...timeline.revisionSettings};
  await mkdir(dir,{recursive:true});
  const proposalFile=path.join(dir,'plan.json');
  const words=JSON.parse(await readFile(path.join(app,'glk-word-timing.json'),'utf8'));
  const resolvedSettings={...previous};
  const resolved=new Map();
  for(const note of notes){
    const decision=resolvePlayheadCue(note,resolvedSettings)||resolveSentenceCue(note,words,resolvedSettings);
    if(decision)resolved.set(note.id,decision);
  }
  const remaining=notes.filter(note=>!resolved.has(note.id));
  const userNotes=remaining.map(note=>({id:note.id,text:note.body,startSeconds:note.start_frame/30,endSeconds:note.end_frame/30}));
  const prompt=`Interpret these timestamped revision notes for this specific GLK Law interview. Return only JSON with settings and results. Do not use tools or execute code.
Allowed settings: animateLowerThird (smooth fade/rise on name graphic), lowerThirdYOffset (integer 0–120 pixels down, 101 preferred for a lower position), officeFullScreen (first office insert only), officeEndFrame (integer 230–275 at 30fps; 266 ends after the firm name), mentoringStartFrame (integer 720–765 at 30fps; 734 covers the 24.47 second point), mentoringEndFrame (integer 780–870 at 30fps; exclusive cut point back to Jay), captionSize (integer 26–50), stableCaptions (fixed lower chest position, no caption flicker in the short-phrase style), showCallout (products liability explanation), bannerAbove (ease the banner on and off above the head), cleanEnding (remove the frozen hold at 29.47s and cut to the supplied card), warmMusic (quiet instrumental groove with light percussion). Keep all settings that a note does not change. For artifact reports, only claim the supported fix when its timestamp matches a known issue: around 1.90s use stableCaptions to eliminate the caption dropout, around 24.47s consider moving mentoringStartFrame to 734, at 29.50s use cleanEnding. This is not a general visual-glitch repair engine. Do not claim to fix an unspecified artifact or a source-file problem. Notes from the old UI may have timestamp zero; only resolve those if the edit target is identifiable from the text. Supply one result per note with original id, applied boolean, and a short explanation.
Schema: {"settings": <complete settings object with all listed keys>, "results":[{"id":"original id","applied":false,"reason":"why"}]}.
Current settings: ${JSON.stringify(resolvedSettings)}
Transcript ([word, onset seconds]): ${JSON.stringify(words)}
The transcript can resolve verbal cut cues. Use the next word’s onset after the requested sentence, quantized up to a 30 fps frame. Do not require an exact out-point from the user when the transcript determines it.
Notes: ${JSON.stringify(userNotes)}`;
  const codexEnv=process.env.KAT_CODEX_HOME?{...process.env,CODEX_HOME:process.env.KAT_CODEX_HOME}:process.env;
  let plan;
  if(remaining.length){
    for(let attempt=0;attempt<2;attempt++){
      try{
        await command('codex',['--ask-for-approval','never','exec','--sandbox','read-only','--ephemeral','--skip-git-repo-check','--ignore-user-config','-o',proposalFile,'-'],control,{
          cwd:dir,input:prompt+(attempt?'\nReturn valid JSON with every setting and exactly one result per supplied note.':''),env:codexEnv,
        });
        const raw=(await readFile(proposalFile,'utf8')).trim().replace(/^```(?:json)?\s*|\s*```$/g,'');
        plan=validate(JSON.parse(raw),resolvedSettings,remaining);
        break;
      }catch(error){
        if(control.cancelled)throw error;
        if(attempt)plan={settings:resolvedSettings,decisions:remaining.map(note=>({id:note.id,applied:false,reason:'Codex could not prepare a valid edit for this note. The note remains pending.'}))};
      }
    }
  }else plan={settings:resolvedSettings,decisions:[]};
  plan.decisions=[...resolved.values(),...plan.decisions];
  plan.changed=Object.keys(defaults).some(key=>plan.settings[key]!==previous[key]);
  if(!plan.changed)return plan;
  await writeFile(path.join(dir,'render.json'),JSON.stringify({settings:plan.settings,sources,captionStyle:timeline.captionStyle,mixStyle:timeline.mixStyle}));
  onStage('Rendering the revised preview');
  await command(process.env.KAT_PYTHON||(process.platform==='win32'?'python':'python3'),[path.join(app,'glk-revision.py'),path.join(dir,'render.json')],control,{cwd:dir});
  return {...plan,file:path.join(dir,'revision.mp4')};
}
