import {id,now} from './store.mjs';

const formats={Vertical:[1080,1920],Landscape:[1920,1080],Square:[1080,1080]};
export const dimensions=format=>formats[format]||null;
export const matchesFormat=(width,height,format)=>{
  const size=dimensions(format);
  return !size||width*size[1]===height*size[0];
};

export function classifyAsset(name,mime=''){
  const path=name.toLowerCase().normalize('NFKC');
  if(/(^|\/)(?:\.ds_store|thumbs\.db|__macosx)(\/|$)/i.test(path))return 'Ignore';
  if(/end[ _-]?(?:screen|card)|outro|closing[ _-]?card/.test(path))return 'End Screens';
  if(/\blogos?\b|wordmark/.test(path))return 'Logos';
  if(/brand[ _-]?(?:guid|kit|assets)|typeface|\.([ot]tf|woff2?)$/.test(path))return 'Brand Assets';
  if(/captions?[ _-]?video|captioned|reference|\.srt$|\.vtt$/.test(path))return 'References';
  if(/b[ _-]?roll|cutaways?/.test(path))return 'B-roll';
  if(/sound[ _-]?effects|\bsfx\b/.test(path))return 'Sound Effects';
  if(/music|soundtrack|\bbgm\b/.test(path))return 'Music';
  if(/voice[ _-]?over|\bvo\b/.test(path))return 'Voiceovers';
  if(/raw[ _-]?(?:video|footage)|interview|a[ _-]?roll/.test(path)&&mime.startsWith('video/'))return 'Raw Footage';
  return mime.startsWith('video/')?'Raw Footage':mime.startsWith('audio/')?'Audio':
    mime.startsWith('image/')?'Images':'Documents';
}

export function organizeExistingAssets(db){
  if(db.get("SELECT value FROM meta WHERE key='asset-categories-v1'"))return;
  db.tx(()=>{
    for(const item of db.all("SELECT a.id,a.name,m.mime FROM assets a JOIN media m USING(hash) WHERE a.category='Raw Footage'")){
      const category=classifyAsset(item.name,item.mime);
      if(category!=='Raw Footage'&&category!=='Ignore')db.run('UPDATE OR IGNORE assets SET category=? WHERE id=?',category,item.id);
    }
    db.run("INSERT OR IGNORE INTO meta VALUES ('asset-categories-v1','1')");
  });
}

export function saveLearning(db,{project,kind,text,scope='project',source=null,checks={}}){
  const row=db.get('SELECT id,client FROM projects WHERE id=? AND deleted_at IS NULL',project);
  if(!row||!text?.trim()||!['project','client'].includes(scope))throw Error('A project, scope and instruction are required.');
  if(scope==='client'&&kind!=='Preference')throw Error('Only confirmed preferences can be shared across client projects.');
  const existing=source&&db.get('SELECT id FROM learning WHERE project=? AND kind=? AND source=?',project,kind,source);
  if(existing)return existing.id;
  const key=id();
  db.run('INSERT INTO learning VALUES (?,?,?,?,?,?,?,?,?)',key,row.client,project,scope,kind,text.trim(),source,JSON.stringify(checks),now());
  return key;
}

export function editingContext(db,project){
  const row=db.get('SELECT * FROM projects WHERE id=? AND deleted_at IS NULL',project);
  if(!row)return null;
  const config=JSON.parse(row.config);
  const client=db.get('SELECT name,profile FROM clients WHERE id=?',row.client);
  const style=config.style&&db.get('SELECT id,version,name,rules FROM styles WHERE id=? AND version=?',config.style.id,config.style.version);
  const assets=db.all('SELECT a.id,a.name,a.hash,a.category,m.mime,m.metadata FROM assets a JOIN media m USING(hash) WHERE a.project=? ORDER BY a.name',project)
    .filter(a=>classifyAsset(a.name,a.mime)!=='Ignore').map(a=>({...a,metadata:JSON.parse(a.metadata)}));
  const drafts=db.all('SELECT id,version,summary,approved,hash,timeline FROM drafts WHERE project=? ORDER BY version DESC',project)
    .map(({timeline,...d})=>{
      const t=JSON.parse(timeline);
      return {...d,kind:t.kind||'draft',checks:t.editorialChecks||{},qa:t.qa||null};
    });
  const notes=db.all('SELECT n.*,d.version FROM notes n JOIN drafts d ON d.id=n.draft WHERE d.project=? ORDER BY d.version,n.start_frame,n.created',project)
    .map(n=>({...n,attachments:db.all('SELECT name,hash FROM attachments WHERE note=? ORDER BY name',n.id)}));
  const learning=db.all("SELECT id,project,scope,kind,text,source,checks,created FROM learning WHERE client=? AND (project=? OR scope='client') ORDER BY rowid",row.client,project)
    .map(l=>({...l,checks:JSON.parse(l.checks)}));
  const preferences=learning.filter(l=>['Preference','Instruction'].includes(l.kind));
  const constraints=Object.assign({},...preferences.filter(l=>l.scope==='client').map(l=>l.checks),...preferences.filter(l=>l.scope==='project').map(l=>l.checks));
  if(dimensions(config.format))constraints.format=config.format;
  const missingAssets=constraints.endCardHash&&!assets.some(a=>a.hash===constraints.endCardHash&&a.category==='End Screens')?['Required end screen']:[];
  return {project:{id:row.id,name:row.name,config},client:{name:client.name,...JSON.parse(client.profile)},
    style:style&&{...style,rules:JSON.parse(style.rules)},assets,drafts,notes,learning,constraints,missingAssets};
}

export function assertEditorial(context,media,recipe){
  if(!matchesFormat(media.width,media.height,context.constraints.format))throw Error('Render QA: the video aspect ratio does not match the project.');
  if(media.sar&&media.sar!=='1:1'&&media.sar!=='N/A')throw Error('Render QA: the video must use square pixels.');
  if(!media.audio)throw Error('Render QA: the editorial draft needs playable audio.');
  const style=context.style;
  if(style&&(recipe.style?.id!==style.id||recipe.style?.version!==style.version))throw Error('Render QA: the edit must use the selected style version.');
  if(context.missingAssets?.length)throw Error("Render QA: the required end screen is missing from this project.");
  const card=context.constraints.endCardHash;
  if(card&&recipe.endCard?.hash!==card)throw Error('Render QA: the edit must include the selected end screen.');
  const byHash=new Map(context.assets.map(a=>[a.hash,a]));
  if(recipe.endCard&&!context.assets.some(a=>a.hash===recipe.endCard.hash&&a.category==='End Screens'))throw Error('Render QA: the end screen must be a project asset.');
  for(const hash of recipe.sources||[])if(!byHash.has(hash))throw Error('Render QA: a timeline source is missing from Project Assets.');
  for(const check of context.constraints.reviewChecks||[])if(!recipe.review?.[check])throw Error('Render QA: missing review evidence for '+check+'.');
}
