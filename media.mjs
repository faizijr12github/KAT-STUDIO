import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {createReadStream, createWriteStream} from 'node:fs';
import {mkdir, rename, rm, stat} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import path from 'node:path';

const exec = promisify(execFile);
const types = {'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.m4v':'video/mp4','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.wav':'audio/wav','.mp3':'audio/mpeg','.m4a':'audio/mp4','.aac':'audio/aac','.pdf':'application/pdf','.txt':'text/plain'};
export function mediaType(filename) {return types[path.extname(filename).toLowerCase()] ?? 'application/octet-stream';}
export async function inspect(file, mime) {
  if (!/^(video|audio|image)\//.test(mime)) return {};
  const {stdout} = await exec('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{timeout:15000});
  const data = JSON.parse(stdout);
  const v = data.streams.find(s=>s.codec_type === 'video'), a = data.streams.find(s=>s.codec_type === 'audio');
  const fpsRational = v?.avg_frame_rate || '0/1';
  const [n,d] = fpsRational.split('/').map(Number);
  const rotation = Math.abs(v?.side_data_list?.find(item=>item.rotation !== undefined)?.rotation ?? 0);
  return {duration:Number(data.format?.duration) || 0,width:rotation%180 ? v.height : v?.width,height:rotation%180 ? v.width : v?.height, fps:n/d || 0,fpsRational,frames:Number(v?.nb_frames)||null,audio:Boolean(a),sar:v?.sample_aspect_ratio||null,codec:v?.codec_name ?? a?.codec_name};
}
export async function ingest(store,directory,source,name,jobId) {
  const folder = path.join(directory,'media');
  await mkdir(folder,{recursive:true});
  const temp = path.join(folder,jobId+'.incoming');
  const digest = createHash('sha256');
  let size = 0;
  try {
    await pipeline(source,new Transform({transform(chunk,enc,cb){
      size+=chunk.length;
      if (size>2_000_000_000) return cb(new Error('File exceeds the 2 GB import limit.'));
      digest.update(chunk); cb(null,chunk);
    }}),createWriteStream(temp,{flags:'wx'}));
    if (!size) throw new Error('File is empty.');
    const hash=digest.digest('hex');
    const existing=store.get('SELECT * FROM media WHERE hash=?',hash);
    if (existing) return existing;
    const mime=mediaType(name);
    const metadata=await inspect(temp,mime);
    const file=path.join(folder,hash);
    await rename(temp,file);
    store.run('INSERT OR IGNORE INTO media VALUES (?,?,?,?,?)',hash,file,size,mime,JSON.stringify(metadata));
    return store.get('SELECT * FROM media WHERE hash=?',hash);
  } finally {await rm(temp,{force:true});}
}
export async function streamFile(req,res,file,mime,download) {
  const size=(await stat(file)).size;
  const range=req.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  let start=0,end=size-1;
  if(range){
    if(range[1]) {start=Number(range[1]); if(range[2]) end=Math.min(end,Number(range[2]));}
    else if(range[2]) start=Math.max(0,size-Number(range[2]));
    if(start > end || start >= size) {res.writeHead(416,{'Content-Range':'bytes */'+size}); return res.end();}
  }
  const headers={'Content-Type':mime,'Accept-Ranges':'bytes','Content-Length':end-start+1,'X-Content-Type-Options':'nosniff'};
  if(range) headers['Content-Range']=`bytes ${start}-${end}/${size}`;
  if(download) headers['Content-Disposition']="attachment; filename*=UTF-8''"+encodeURIComponent(download);
  res.writeHead(range?206:200,headers);
  if(req.method==='HEAD') return res.end();
  const readable=createReadStream(file,{start,end});
  res.on('close',()=>readable.destroy());
  readable.on('error',()=>res.destroy());
  readable.pipe(res);
}
export function encode({file,output,start=0,duration,width,height,fps,codec='h264',draft=false,onProgress}) {
  const args=['-hide_banner','-v','error','-nostdin','-n','-ss',String(start),'-i',file,'-t',String(duration),'-map','0:v:0','-map','0:a:0?','-vf',`scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,'-r',String(fps),'-c:v',codec==='hevc'?'libx265':'libx264','-threads','4','-preset',draft?'ultrafast':'fast','-crf',draft?'27':'19','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','-progress','pipe:1','-nostats',output];
  const child=spawn('ffmpeg',args,{stdio:['ignore','pipe','pipe']});
  let pending='', errors='';
  child.stdout.on('data',chunk=>{
    pending+=chunk;
    const lines=pending.split('\n'); pending=lines.pop();
    for(const line of lines) if(line.startsWith('frame=')) onProgress(Number(line.slice(6))||0);
  });
  child.stderr.on('data',chunk=>{errors=(errors+chunk).slice(-1200);});
  const done=new Promise((resolve,reject)=>{
    child.once('error',reject);
    child.once('close', code=>code===0 ? resolve() : reject(new Error(errors.trim()||'FFmpeg stopped before completing the video.')));
  });
  return {done,cancel:()=>child.kill('SIGTERM')};
}
