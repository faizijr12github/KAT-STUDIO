import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {inspect} from './media.mjs';

const exec = promisify(execFile);

export async function checkRender(file, {audio=false, duration, fps, width, height, frames, motionEnd, signal}={}) {
  const info = await inspect(file, 'video/mp4');
  if (!info.width || !info.height || !info.duration || !info.fps ||
      (audio && !info.audio) || (frames != null && frames !== info.frames) ||
      (width && info.width !== width) || (height && info.height !== height) ||
      (fps && Math.abs(fps-info.fps) > .02) ||
      (duration && Math.abs(duration-info.duration) > Math.max(.12, 1/info.fps))) {
    throw Error('Render QA found unexpected media streams, dimensions, frame rate, or duration.');
  }
  const args = ['-hide_banner','-nostdin','-xerror','-i',file,'-map','0:v:0',
    '-vf','scale=480:-2,blackdetect=d=0.10:pix_th=0.06,freezedetect=n=-68dB:d=0.8'];
  if (info.audio) args.push('-map','0:a:0','-af','astats=metadata=0:reset=0');
  args.push('-nostats','-f','null','-');
  const {stderr} = await exec('ffmpeg', args, {
    timeout: Math.max(90_000, info.duration*1_000), maxBuffer: 2*1024*1024, signal
  });
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  const holds=[];
  for(const line of stderr.matchAll(/freeze_(start|end): ([\d.]+)/g)){
    const time=Number(line[2]);
    if(line[1]==='start')holds.push([time,info.duration]);
    else if(holds.length)holds.at(-1)[1]=time;
  }
  const freezes=holds.map(([start])=>start);
  const peaks = [...stderr.matchAll(/Peak level dB: (-?\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
  const peakDb = peaks.length ? Math.max(...peaks) : null;
  if(motionEnd!=null){
    const issues=[
      ...black.filter(([start])=>start<motionEnd).map(([start,end])=>({type:'Black frames',start,end})),
      ...holds.filter(([start])=>start+.8<=motionEnd).map(([start,end])=>({type:'Unexpected still frame',start,end}))
    ].sort((a,b)=>a.start-b.start);
    if(issues.length){
      const details=issues.slice(0,4).map(({type,start,end})=>`${type} at ${start.toFixed(2)}–${end.toFixed(2)}s`).join('. ');
      throw Object.assign(Error(details+'. Check the affected shot and render again.'),{code:'KAT_VISUAL_QA',issues});
    }
  }
  if (audio && peakDb === null && motionEnd != null) throw Error('Render QA detected silent audio.');
  const warnings = [];
  if (black.length) warnings.push('Check black frames at '+black.map(([start])=>start.toFixed(2)+'s').join(', ')+'.');
  const reportableFreezes = motionEnd==null ? freezes : freezes.filter(start=>start+.8<=motionEnd);
  if (reportableFreezes.length) warnings.push('Check static frames at '+reportableFreezes.map(start=>start.toFixed(2)+'s').join(', ')+'.');
  if (info.audio && peakDb === null) warnings.push('Check the silent audio track.');
  if (peakDb !== null && peakDb >= -.1) warnings.push('Audio peak is near full scale.');
  return {duration:info.duration, frames:info.frames, peakDb, black, freezes, holds, warnings};
}
