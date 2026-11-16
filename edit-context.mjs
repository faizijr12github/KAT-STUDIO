import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openStore} from './store.mjs';
import {editingContext,organizeExistingAssets} from './learning.mjs';
import {contextReceipt,registerEditorial} from './editorial.mjs';

const app=path.dirname(fileURLToPath(import.meta.url));
const directory=path.resolve(process.env.KAT_DATA||path.join(app,'Studio Data'));
const db=openStore(directory);
organizeExistingAssets(db);
const [action,project,submission]=process.argv.slice(2);
try{
  if(action==='read'){
    const context=editingContext(db,project);
    if(!context)throw Error('Project unavailable.');
    const latest=db.get("SELECT version,timeline FROM drafts WHERE project=? ORDER BY version DESC LIMIT 1",project);
    const timeline=latest&&JSON.parse(latest.timeline);
    const previousEdit=timeline&&{version:latest.version,recipe:timeline.recipe||timeline.edit||timeline.revisionSettings||null};
    console.log(JSON.stringify({contextToken:contextReceipt(context),...context,previousEdit},null,2));
  }else if(action==='register'){
    const payload=JSON.parse(await readFile(submission,'utf8'));
    if(!path.isAbsolute(payload.file||''))throw Error('Provide an absolute render path.');
    console.log(JSON.stringify(await registerEditorial({...payload,db,directory,project}),null,2));
  }else throw Error('Use read PROJECT or register PROJECT SUBMISSION.json.');
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}
