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
    '-vf','scale=320:-2,blackdetect=d=0.10:pix_th=0.10,freezedetect=n=-55dB:d=0.8'];
  if (info.audio) args.push('-map','0:a:0','-af','astats=metadata=0:reset=0');
  args.push('-nostats','-f','null','-');
  const {stderr} = await exec('ffmpeg', args, {
    timeout: Math.max(90_000, info.duration*1_000), maxBuffer: 2*1024*1024, signal
  });
  const black = [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m=>[Number(m[1]),Number(m[2])]);
  const freezes = [...stderr.matchAll(/freeze_start: ([\d.]+)/g)].map(m=>Number(m[1]));
  const peaks = [...stderr.matchAll(/Peak level dB: (-?\d+(?:\.\d+)?)/g)].map(m=>Number(m[1]));
  const peakDb = peaks.length ? Math.max(...peaks) : null;
  if (motionEnd != null && (black.some(([start])=>start<motionEnd) || freezes.some(start=>start+.8<=motionEnd))) {
    throw Error('Render QA detected black frames or an unexpected hold during the speaking section.');
  }
  if (audio && peakDb === null && motionEnd != null) throw Error('Render QA detected silent audio.');
  const warnings = [];
  if (black.length) warnings.push('Check black frames at '+black.map(([start])=>start.toFixed(2)+'s').join(', ')+'.');
  const reportableFreezes = motionEnd==null ? freezes : freezes.filter(start=>start+.8<=motionEnd);
  if (reportableFreezes.length) warnings.push('Check static frames at '+reportableFreezes.map(start=>start.toFixed(2)+'s').join(', ')+'.');
  if (info.audio && peakDb === null) warnings.push('Check the silent audio track.');
  if (peakDb !== null && peakDb >= -.1) warnings.push('Audio peak is near full scale.');
  return {duration:info.duration, frames:info.frames, peakDb, black, freezes, warnings};
}
