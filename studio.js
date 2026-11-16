const $ = (selector, root=document) => root.querySelector(selector);
const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
const content = $('#content'), dialog = $('#dialog');
const escape = value => String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
const urlFor = (hash, download) => 'media/'+encodeURIComponent(hash)+(download?'?download='+encodeURIComponent(download):'');
const options = (items, selected) => items.map(item=>`<option ${item===selected?'selected':''}>${escape(item)}</option>`).join('');
const latestStyles = () => state.styles.filter(row=>!state.styles.some(other=>other.id===row.id&&other.version>row.version));
let state = {projects:[], trash:[], clients:[], drafts:[], assets:[], styles:[], notes:[], jobs:[], categories:[]};
let view = 'projects', projectId = null, draftId = null, assetId = null;
let stateTag, refreshSequence=0, appliedRefresh=0;
let toastTimer, stage='setup', pendingPreview=null;
function notice(message, danger=false) {
  const toast=$('#toast');toast.textContent=message;toast.classList.toggle('invalid',danger);
  clearTimeout(toastTimer);toastTimer=setTimeout(()=>{toast.textContent='';},6000);
}
async function request(route, data) {
  const response=await fetch('api/'+route,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const body=await response.json();
  if(!response.ok)throw Error(body.error||'Action failed.');
  return body;
}
const guard = fn => async event => {try {await fn(event);}catch(error){notice(error.message,true);}};
const project = () => state.projects.find(row=>row.id===projectId);
const drafts = () => state.drafts.filter(row=>row.project===projectId);
const selectedDraft = () => drafts().find(row=>row.id===draftId);
const assets = () => state.assets.filter(row=>row.project===projectId);
const selectedAsset = () => assets().find(row=>row.id===assetId);
const jobs = () => state.jobs.filter(row=>row.project===projectId);
const client = key => state.clients.find(row=>row.id===key);
const statuses=['Pending','In Progress','Fixed','Needs Review','Approved'];
function timecode(frame, fps) {
  const rate=Math.max(1,Math.round(fps||30));
  return [Math.floor(frame/(rate*3600)),Math.floor(frame/(rate*60))%60,Math.floor(frame/rate)%60,frame%rate].map(n=>String(n).padStart(2,'0')).join(':');
}
const title=(name,sub='',actions='')=>`<div class="heading"><div><h1>${escape(name)}</h1>${sub?`<p class="muted">${escape(sub)}</p>`:''}</div><div class="row">${actions}</div></div>`;
const empty=msg=>`<p class="empty">${escape(msg)}</p>`;
const projectDrafts=key=>state.drafts.filter(d=>d.project===key);
function cards(projects){
  return projects.map(p=>{
    const latest=projectDrafts(p.id)[0];
    const status=latest?(latest.approved?'Draft approved':'Draft ready'):state.assets.some(a=>a.project===p.id)?'Assets uploaded':'Not started';
    return `<article class="card project-tile"><button class="project-card" data-project="${escape(p.id)}" data-format="${escape(p.config.format)}">
      ${latest?`<video preload="metadata" muted playsinline src="${urlFor(latest.hash)}#t=0.25"></video>`:''}
      <span class="card-copy"><strong>${escape(p.name)}</strong><br><small class="muted">${escape(client(p.client)?.name)}</small><br><span class="pill">${status}</span></span></button><div class="project-actions"><button class="danger-text" data-delete-project="${escape(p.id)}" aria-label="Delete ${escape(p.name)}">Delete</button></div></article>`;
  }).join('');
}
let trashOpen=false;
function dashboard(){
  const waiting=state.projects.filter(p=>{const d=projectDrafts(p.id)[0];return d&&!d.approved;}).length;
  const approved=state.drafts.filter(d=>d.approved).length;
  content.innerHTML=title('Projects','Review drafts and pick up where you left off.','<input id="search" type="search" aria-label="Search projects" placeholder="Search projects or clients">')+
    `<div class="metrics"><div class="metric"><strong>${state.projects.length}</strong>Projects</div><div class="metric"><strong>${waiting}</strong>Awaiting review</div><div class="metric"><strong>${approved}</strong>Approved drafts</div></div>
    <div class="cards" id="project-cards">${cards(state.projects)||empty('Create a project to get started.')}</div>
    <details class="trash space"${trashOpen?' open':''}><summary>Trash (${state.trash.length})</summary>
    <div class="stack">${state.trash.map(p=>`<div class="split trash-item"><span><strong>${escape(p.name)}</strong><br><small class="muted">${escape(client(p.client)?.name)}</small></span><div class="row"><button data-restore-project="${escape(p.id)}" aria-label="Restore ${escape(p.name)}">Restore</button><button class="danger-text" data-purge-project="${escape(p.id)}" aria-label="Permanently delete ${escape(p.name)}">Delete permanently</button></div></div>`).join('')||'<p class="muted">Trash is empty.</p>'}</div></details>`;
  $('.trash').ontoggle=e=>{trashOpen=e.target.open;};
  $('#search').oninput=e=>{
    const q=e.target.value.toLowerCase();
    const results=state.projects.filter(p=>[p.name,client(p.client)?.name].some(s=>s?.toLowerCase().includes(q)));
    $('#project-cards').innerHTML=cards(results)||empty('No projects match your search.');
  };
}
function deleteProjectDialog(p){
  dialog.innerHTML=`<h2>Delete ${escape(p.name)}?</h2>
    <p class="muted space">This moves the project, its drafts, and feedback to Trash. You can restore it from the Projects dashboard.</p>
    <form id="delete-project-form"><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="danger">Move to Trash</button></div></form>`;
  dialog.showModal();
  $('#delete-project-form').onsubmit=guard(async e=>{
    e.preventDefault();
    await request('trash/delete',{project:p.id,confirm:true});
    dialog.close();await refresh();notice('Project moved to Trash.');
  });
}
function purgeProjectDialog(p){
  dialog.innerHTML=`<h2>Permanently delete ${escape(p.name)}?</h2>
    <p class="muted space">This permanently removes the project, its draft history, and its feedback from KAT Studio. You can’t restore it afterward. Media files are kept.</p>
    <form id="purge-project-form"><div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="danger">Delete permanently</button></div></form>`;
  dialog.showModal();
  $('#purge-project-form').onsubmit=guard(async e=>{
    e.preventDefault();
    const submit=e.submitter;
    if(submit)submit.disabled=true;
    try{
      await request('trash/purge',{project:p.id,confirm:true});
      dialog.close();await refresh();notice('Project permanently deleted.');
    }finally{if(submit)submit.disabled=false;}
  });
}
function library(){
  content.innerHTML=title('Client library','Reusable brand guidelines and project history.')+
  `<div class="cards">${state.clients.map(c=>{
    const projects=state.projects.filter(p=>p.client===c.id);
    return `<article class="card"><h2>${escape(c.name)}</h2><p class="muted">${escape(c.profile.description)}</p>
    ${c.profile.brand?`<p class="space">${escape(c.profile.brand)}</p>`:''}
    <div class="stack space">${(c.profile.links||[]).map(link=>`<a href="${escape(link)}" rel="noopener noreferrer" target="_blank">${escape(link)}</a>`).join('')}
    ${projects.map(p=>`<button data-project="${escape(p.id)}">${escape(p.name)}</button>`).join('')}</div>
    <button class="space" data-new-client="${escape(c.id)}">New project for client</button></article>`;
  }).join('')||empty('Client profiles appear when you create projects.')}</div>`;
}
function styles(){
  content.innerHTML=title('Editing styles','Use saved rules as a starting point in new projects.','<button class="primary" id="new-style">+ New style</button>')+
  `<div class="cards">${latestStyles().map(s=>`<article class="card"><div class="split"><h2>${escape(s.name)}</h2><span class="pill">V${s.version}</span></div>
  <p class="muted">${escape(s.rules.category)}</p><p class="space style-rules">${escape(s.rules.rules)}</p>
  <details class="space"><summary>Version history</summary><div class="stack">${state.styles.filter(x=>x.id===s.id).map(x=>`<p class="style-rules">V${x.version} · ${escape(x.rules.rules)}</p>`).join('')}</div></details>
  <button class="space" data-style="${escape(s.id)}">Create new version</button></article>`).join('')||empty('Create a style to reuse its editing rules across projects.')}</div>`;
  $('#new-style').onclick=()=>styleDialog();
}
function jobMarkup(job){
  const name=state.projects.find(p=>p.id===job.project)?.name||'Project';
  return `<article class="card"><div class="split"><strong>${escape(name)} · ${escape(job.kind)}</strong><span class="pill">${escape(job.state)}</span></div>
  <p class="muted">${escape(job.detail)}</p>${job.total>0&&['running','complete'].includes(job.state)?`<progress value="${job.progress}" max="1" aria-label="Render completion"></progress><p class="muted">${Math.floor(job.progress*100)}% · ${job.frames} / ${job.total} frames</p>`:''}
  ${job.state==='running'?`<button class="space" data-cancel="${job.id}" data-job-project="${job.project}">Cancel</button>`:''}
  ${job.state==='complete'&&job.hash?`<a class="button" href="${urlFor(job.hash,'KAT-'+job.kind.toLowerCase()+'.mp4')}">Download MP4</a>`:''}</article>`;
}
function queue(){
  content.innerHTML=title('Render queue','Preview and export jobs on this Mac.')+
  `<div class="stack" id="job-list">${state.jobs.map(jobMarkup).join('')||empty('Rendered previews and confirmed exports will appear here.')}</div>`;
}
function display(){
  $$('.nav button').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===view||(view==='workspace'&&btn.dataset.view==='projects')));
  ({projects:dashboard,clients:library,styles,queue,workspace})[view]();
}
function setStage(next,draft=null){
  stage=next;
  if(next==='review'){
    draftId=draft?.id||projectDrafts(projectId)[0]?.id||null;
    assetId=null;
  }
  history.replaceState(null,'','#'+encodeURIComponent(projectId)+(stage==='review'?'/review':''));
  display();
}
function openProject(key,next='setup'){
  projectId=key;draftId=null;assetId=null;pendingPreview=null;view='workspace';
  setStage(next);
}
function setView(next){
  view=next;history.replaceState(null,'',location.pathname);display();
}
function styleDialog(source){
  dialog.innerHTML=`<h2>${source?'Create style version':'New editing style'}</h2>
  <form id="style-form" class="fields space"><label>Name<input name="name" required value="${escape(source?.name)}"></label>
  <label>Category<input name="category" value="${escape(source?.rules.category)}" placeholder="Reel, explainer, interview"></label>
  <label>Editing rules<textarea name="rules" required placeholder="Caption design, pacing, transitions, sound, quality checks">${escape(source?.rules.rules)}</textarea></label>
  ${source?`<p class="muted">V${source.version} stays available. Review the rule changes before saving V${source.version+1}.</p><label><input type="checkbox" name="confirm" required> Confirm the new version</label>`:''}
  <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Save style</button></div></form>`;
  dialog.showModal();
  $('#style-form').onsubmit=guard(async e=>{
    e.preventDefault();const b=Object.fromEntries(new FormData(e.target));
    await request('styles',{...b,id:source?.id,confirm:b.confirm==='on'});dialog.close();await refresh();notice('Style saved.');
  });
}
const platforms=['Instagram Reels','TikTok','YouTube Shorts','YouTube Long Form','LinkedIn','Facebook','Paid Advertisements'];
function wizard(clientId=''){
  const known=client(clientId);
  const fields=[
    ['Client',`<label>Client library<select name="client" id="client-input"><option value="">New client</option>${state.clients.map(c=>`<option value="${c.id}" ${c.id===clientId?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label><label>Client name<input name="clientName" value="${escape(known?.name)}"></label><label>Business, products, customers and selling points<textarea name="description">${escape(known?.profile.description)}</textarea></label><label>Website and social links<textarea name="links" placeholder="One link per line">${escape(known?.profile.links?.join('\n'))}</textarea></label>`],
    ['Publishing',`<div class="checks">${platforms.map(p=>`<label><input type="checkbox" name="platforms" value="${p}"> ${p}</label>`).join('')}</div><label>Starting format<select name="format" id="format-input">${options(['Vertical','Landscape','Square'])}</select></label>`],
    ['Brand',`<label>Colors, fonts, voice and prohibited elements<textarea name="brand">${escape(known?.profile.brand)}</textarea></label><p class="muted">You can import brand PDFs, logos, and screenshots in Project Assets.</p>`],
    ['Brief','<label>Objective, audience, duration, story, hook, CTA and pacing<textarea name="brief"></textarea></label>'],
    ['References','<label>URLs and what to take from each reference<textarea name="references" placeholder="Link and notes"></textarea></label><p class="muted">Import reference images and clips in the workspace.</p>'],
    ['Style',`<p class="muted" id="glk-style-prompt" hidden>Would you like to apply GLK Law Firm Styles?</p><label>Editing style<select name="style"><option value="">Choose later</option><option value="none">Continue without saved style</option>${latestStyles().map(s=>`<option value="${s.id}:${s.version}">${escape(s.name)} · V${s.version}</option>`).join('')}</select></label>`],
    ['Create', '<label>Project name<input name="name" required placeholder="Campaign or video title"></label><p class="muted" id="wizard-summary"></p>']
  ];
  dialog.innerHTML=`<p class="step-label" id="step-label"></p><h2 id="wizard-heading"></h2><form id="project-form" class="space">
  ${fields.map(([,markup],i)=>`<div class="form-step fields" data-step="${i}">${markup}</div>`).join('')}
  <div class="dialog-foot"><div class="row"><button type="button" data-close>Cancel</button><button type="button" id="prev-step">Back</button></div>
  <button type="button" class="primary" id="next-step">Next</button><button type="submit" class="primary" id="create-project">Create project</button></div></form>`;
  let step=0;const form=$('#project-form');
  function show(){
    $$('.form-step',form).forEach((el,i)=>el.hidden=i!==step);
    $('#step-label').textContent='STEP '+(step+1)+' OF '+fields.length;
    $('#wizard-heading').textContent=fields[step][0];
    $('#prev-step').disabled=!step;$('#next-step').hidden=step===6;$('#create-project').hidden=step!==6;
    $('#glk-style-prompt').hidden=!requiresStyleChoice();
    if(step===6)$('#wizard-summary').textContent=[form.elements.clientName.value,form.elements.format.value,...new FormData(form).getAll('platforms')].filter(Boolean).join(' · ');
  }
  function requiresStyleChoice(){
    const chosen=client(form.elements.client.value)?.name||form.elements.clientName.value;
    return /^GLK Law Firm$/i.test(chosen.trim())&&latestStyles().some(s=>s.id==='glk-law-firm-style');
  }
  $('#client-input').onchange=e=>{
    const c=client(e.target.value);
    form.elements.clientName.value=c?.name||'';form.elements.description.value=c?.profile.description||'';
    form.elements.links.value=c?.profile.links?.join('\n')||'';form.elements.brand.value=c?.profile.brand||'';
  };
  let formatEdited=false;$('#format-input').onchange=()=>{formatEdited=true;};
  $$('[name="platforms"]',form).forEach(input=>input.onchange=()=>{
    const selections=new FormData(form).getAll('platforms');
    if(!formatEdited)form.elements.format.value=selections.includes('YouTube Long Form')?'Landscape':'Vertical';
  });
  $('#prev-step').onclick=()=>{if(step){step--;show();}};
  $('#next-step').onclick=()=>{
    if(step===0&&!form.elements.client.value&&!form.elements.clientName.value.trim())return notice('Enter a client name.',true);
    if(step===5&&requiresStyleChoice()&&!form.elements.style.value)return notice('Choose an editing style or continue without one.',true);
    if(step<6){step++;show();}
  };
  form.onsubmit=guard(async e=>{
    e.preventDefault();if(step!==6)return;
    const fd=new FormData(form), body={...Object.fromEntries(fd),platforms:fd.getAll('platforms')};
    if(body.style==='none')body.style='';
    const result=await request('projects',body);dialog.close();await refresh(false);openProject(result.id);notice('Project created.');
  });
  show();dialog.showModal();
}
function noteMarkup(note,fps){
  return `<article class="note" id="note-${note.id}">
  <div class="split"><button type="button" data-seek="${note.start_frame}" class="tc">${timecode(note.start_frame,fps)}${note.end_frame!==note.start_frame?'–'+timecode(note.end_frame,fps):''}</button></div>
  <p>${escape(note.body)}</p>
  ${note.link?`<p><a href="${escape(note.link)}" rel="noopener noreferrer" target="_blank">Reference link</a></p>`:''}
  ${note.attachments.map(a=>`<a href="${urlFor(a.hash,a.name)}">${/\.(png|jpe?g|webp)$/i.test(a.name)?`<img src="${urlFor(a.hash)}" alt="${escape(a.name)}">`:escape(a.name)}</a>`).join('')}
  <label class="note-status">Status <select data-note-status="${note.id}">${options(statuses,note.status)}</select></label></article>`;
}
function workspace(){
  const p=project();if(!p){setView('projects');return;}
  if(stage==='review'&&!selectedDraft()){setStage('setup');return;}
  const review=stage==='review';
  const d=review?selectedDraft():null, a=review?null:selectedAsset();
  const first=drafts().find(item=>item.version===1);
  const videos=assets().filter(item=>item.mime.startsWith('video/')&&item.metadata.duration>0);
  const primarySource=videos.find(item=>/\/raw video\//i.test(item.name))||videos.find(item=>item.category==='Raw Footage')||videos[0];
  const activePreview=jobs().find(job=>job.kind==='Preview'&&job.state==='running');
  const source=a||d, playable=source?.mime?.startsWith('video/');
  const info=source?.metadata||{}, fps=info.fps||30, endFrame=Math.max(0,(info.frames||Math.ceil((info.duration||0)*fps))-1);
  const notes=!a&&d?state.notes.filter(n=>n.draft===d.id):[];
  const style=state.styles.find(s=>s.id===p.config.style?.id&&s.version===p.config.style?.version);
  const actionButton=d&&!a ? (d.approved?'<button class="primary" id="export">Export approved draft</button>':'<button class="primary" id="approve">Approve draft</button>'):'';
  const stageActions=review?'<button id="back-setup">← Project Setup</button>'+actionButton+'<button class="primary" id="download-latest">Download Latest Draft</button>':
    first?'<button id="open-latest">Open latest draft</button>':'';
  content.innerHTML=`<div class="eyebrow stage-label">${review?'02 · Draft Review':'01 · Project Setup'}</div>`+
    title(p.name,[client(p.client)?.name,p.config.format,style?.name].filter(Boolean).join(' · '),stageActions)+
  `<div class="workspace ${review?'review-workspace':'setup-workspace'}">
    ${!review?`<section class="pane" id="asset-pane"><h2>Project Assets <small class="muted">${assets().length} files</small></h2><div class="pad">
    <div class="import-area stack"><h3>Add your project media</h3><p class="muted">Import a project folder to preserve its structure, or add individual files. You can also drop files here.</p>
    <label>Import as<select id="category">${options(state.categories,'Raw Footage')}</select></label>
    <div class="row"><button id="pick-folder" class="primary">Choose project folder</button><button id="pick-files">Add files</button></div>
    <input type="file" id="files" multiple hidden><input type="file" id="folder" webkitdirectory multiple hidden></div>
    <div class="asset-list space">${assets().map(item=>`<button data-asset="${item.id}" class="asset ${item.id===assetId?'selected':''}">${escape(item.name)}<small>${escape(item.category)}${item.metadata.duration?' · '+item.metadata.duration.toFixed(1)+'s':''}</small></button>`).join('')||'<p class="muted">No source media imported.</p>'}</div>
    <details class="space"><summary>Project brief</summary><p>${escape(p.config.brief)||'No brief added.'}</p>${p.config.brand?`<p>${escape(p.config.brand)}</p>`:''}${p.config.references?`<p>${escape(p.config.references)}</p>`:''}${style?`<p class="style-rules">${escape(style.rules.rules)}</p>`:''}</details>
    </div></section>`:''}
    <section class="pane preview-pane"><div class="pane-title split"><h2>${review?'Draft '+d.version+' preview':'Source preview'}</h2>
    <div class="row">${review?`<select id="draft-select" aria-label="Draft version">${drafts().map(item=>`<option value="${item.id}" ${!a&&d?.id===item.id?'selected':''}>V${item.version}${item.approved?' · Approved':''}</option>`).join('')}</select>`:''}</div></div>
    <div class="stage" id="stage">
    ${playable?`<video id="video" preload="metadata" playsinline src="${urlFor(source.hash)}"></video><div id="guide" class="guide" hidden></div>`:a?.mime.startsWith('image/')?`<img style="max-width:100%;max-height:480px" src="${urlFor(a.hash)}" alt="${escape(a.name)}">`:a?.mime.startsWith('audio/')?`<audio controls src="${urlFor(a.hash)}"></audio>`:a?`<a href="${urlFor(a.hash,a.name)}">Download source file</a>`:empty('Select an imported asset to preview it here.')}</div>
    ${playable?`<div class="transport"><input id="playhead" type="range" min="0" max="${endFrame}" value="0" aria-label="Video frame">
    <div class="marker-row">${notes.map((n,i)=>`<button data-seek="${n.start_frame}" data-marker="${n.id}" style="left:${n.start_frame/Math.max(1,endFrame)*100}%" title="${escape(n.body)}" aria-label="Note ${i+1}">${i+1}</button>`).join('')}</div>
    <div class="split"><div class="row"><button id="play">Play</button><button id="frame-back" aria-label="Previous frame">−1f</button><button id="frame-next" aria-label="Next frame">+1f</button><button id="guides">Safe zone</button><button id="fullscreen">Full screen</button></div>
    <div class="row"><select id="speed" aria-label="Playback speed">${[.5,1,1.5,2].map(n=>`<option value="${n}" ${n===1?'selected':''}>${n}×</option>`).join('')}</select><span class="tc" id="time">00:00:00:00</span></div></div></div>`:''}
    ${d?.timeline.qa?`<details class="qa-panel"><summary>${d.timeline.qa.warnings.length?'Technical QA · review flagged items':'Technical QA · checks passed'}</summary><p>${d.timeline.qa.warnings.length?d.timeline.qa.warnings.map(escape).join(' '):'Video and audio decoded successfully.'} Check caption sync and pacing during playback.</p></details>`:''}
    ${review?`<div class="draft-download" id="draft-download" hidden><p class="muted" id="download-status" role="status"></p><progress id="download-progress" aria-label="Draft download progress" max="1" hidden></progress></div>`:''}
    </section>
    ${review?`<section class="pane review"><h2>Timeline feedback</h2><div class="pad">
    <form id="note-form" class="stack"><label>Revision note<textarea name="body" required placeholder="What should change here?"></textarea></label>
    <div class="note-anchor"><span class="muted">Comment at</span> <output id="note-time" class="tc">00:00:00:00</output></div>
    <label>Images or clips<input type="file" name="files" accept="image/*,video/*" multiple></label>
    <button class="primary">Add note</button></form><div><div class="notes-list">${notes.map(n=>noteMarkup(n,fps)).join('')}</div>${d.canRevise?`<button class="primary space" id="submit-revision" ${notes.some(n=>n.status==='Pending')&&!jobs().some(j=>j.state==='running')?'':'disabled'}>Submit to Codex</button>`:notes.length?'<button class="space" id="copy-review">Copy review for Codex</button>':''}</div></div></section>`:''}
  </div>
  ${!review?`<section class="pane setup-footer space"><div><h2>Ready for Draft 1?</h2>
  <p class="muted">${first?'Open the existing first draft for review.':primarySource?'Create a source preview from the selected footage.':'Import raw footage to start Draft 1.'}</p></div>
  <div class="setup-next">${!first&&videos.length?`<label for="draft-source" class="muted">Source video</label><select id="draft-source">${videos.map(item=>`<option value="${item.id}" ${item.id===((a?.mime.startsWith('video/')?a:primarySource)?.id)?'selected':''}>${escape(item.name)}</option>`).join('')}</select>`:''}
  <button class="primary" id="start-draft" ${!first&&(!primarySource||activePreview)?'disabled':''}>${activePreview?'Preparing Draft 1…':'Start Draft 1'}</button></div></section>`:''}
  <div class="space stack" id="project-jobs">${jobs().filter(job=>job.state==='running').map(jobMarkup).join('')}</div>`;
  bindWorkspace(p,d,a,info,fps,endFrame);
  if(review)$('#download-latest').onclick=guard(()=>downloadLatestDraft(p.id));
}
async function downloadLatestDraft(project){
  const button=$('#download-latest'), panel=$('#draft-download'), progress=$('#download-progress'), status=$('#download-status');
  button.disabled=true;panel.hidden=false;progress.hidden=false;progress.removeAttribute('value');
  status.textContent='Finding the latest rendered draft…';
  try{
    const draft=await request('latest-draft?'+new URLSearchParams({project}));
    const response=await fetch(urlFor(draft.hash));
    if(!response.ok||!response.body)throw Error('The draft file is unavailable.');
    const reader=response.body.getReader(), chunks=[];
    let downloaded=0;
    for(;;){
      const {done,value}=await reader.read();
      if(done)break;
      chunks.push(value);
      downloaded+=value.byteLength;
      progress.value=Math.min(1,downloaded/draft.size);
      status.textContent='Downloading Draft '+draft.version+' · '+Math.floor(progress.value*100)+'%';
    }
    if(downloaded!==draft.size)throw Error('The draft transfer was incomplete. Try downloading it again.');
    const url=URL.createObjectURL(new Blob(chunks,{type:draft.mime}));
    const anchor=document.createElement('a');
    anchor.href=url;anchor.download=draft.filename;
    document.body.append(anchor);anchor.click();anchor.remove();
    setTimeout(()=>URL.revokeObjectURL(url),30000);
    progress.value=1;
    status.textContent=draft.filename+' · Ready';
  }catch(error){
    progress.hidden=true;status.textContent=error.message;
    throw error;
  }finally{button.disabled=false;}
}
async function upload(route,files,query){
  const failures=[];
  for(const file of files){
    const params=new URLSearchParams({...query,name:file.webkitRelativePath||file.name});
    try{
      const result=await fetch('api/'+route+'?'+params,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(!result.ok)throw Error((await result.json()).error);
    }catch(error){failures.push(file.name+' · '+error.message);}
  }
  return failures;
}
function bindWorkspace(p,d,a,info,fps,last){
  const video=$('#video');
  let noteAnchor=null;
  const current=()=>Math.max(0,Math.min(last,Math.floor((video?.currentTime||0)*fps+.001)));
  const syncNoteTime=()=>{
    const output=$('#note-time');
    if(!output)return;
    const {start,end}=noteAnchor??{start:current(),end:current()};
    output.textContent=timecode(start,fps)+(end!==start?' – '+timecode(end,fps):'');
  };
  const seek=frame=>{if(video){video.pause();const target=Math.max(0,Math.min(last,frame));video.currentTime=target/fps;if(noteAnchor)noteAnchor={start:target,end:target};syncNoteTime();}};
  const select=$('#draft-select');
  if(select)select.onchange=e=>{if(e.target.value){draftId=e.target.value;assetId=null;display();}};
  if(video){
    const sync=()=>{$('#time').textContent=timecode(current(),fps);$('#playhead').value=current();$('#play').textContent=video.paused?'Play':'Pause';syncNoteTime();};
    ['timeupdate','seeking','play','pause','ended'].forEach(event=>video.addEventListener(event,sync));
    video.onerror=()=>notice('This format cannot play in the browser. A generated preview uses a browser-compatible format.',true);
    $('#play').onclick=guard(()=>video.paused?video.play():video.pause());
    $('#frame-back').onclick=()=>seek(current()-1);
    $('#frame-next').onclick=()=>seek(current()+1);
    $('#playhead').oninput=e=>seek(Number(e.target.value));
    $('#speed').onchange=e=>{video.playbackRate=Number(e.target.value);};
    $('#guides').onclick=e=>{const guide=$('#guide'), w=video.clientWidth,h=video.clientHeight;
      const ratio=video.videoWidth/video.videoHeight || 16/9, actualW=Math.min(w,h*ratio), actualH=Math.min(h,w/ratio);
      guide.style.inset=`${(h-actualH*.8)/2}px ${(w-actualW*.8)/2}px`;
      guide.hidden=!guide.hidden;e.target.setAttribute('aria-pressed',String(!guide.hidden));
    };
    $('#fullscreen').onclick=guard(()=>$('#stage').requestFullscreen());
    $$('[data-seek]').forEach(btn=>btn.onclick=()=>{seek(Number(btn.dataset.seek));if(btn.dataset.marker)$('#note-'+btn.dataset.marker)?.scrollIntoView({block:'nearest'});});
  }
  const pane=$('#asset-pane');
  if(pane){
    const doImport=guard(async files=>{
      if(!files.length)return;
      notice('Importing '+files.length+' file(s)…');
      const failures=await upload('import',files,{project:p.id,category:$('#category').value});
      await refresh();
      notice(failures.length?failures.join(' · '):'Media imported.',Boolean(failures.length));
    });
    $('#pick-files').onclick=()=>$('#files').click();
    $('#pick-folder').onclick=()=>$('#folder').click();
    for(const selector of ['#files','#folder'])$(selector).onchange=e=>void doImport([...e.target.files]);
    pane.ondragover=e=>{e.preventDefault();pane.classList.add('dragging');};
    pane.ondragleave=()=>pane.classList.remove('dragging');
    pane.ondrop=e=>{e.preventDefault();pane.classList.remove('dragging');void doImport([...e.dataTransfer.files]);};
  }
  if($('#back-setup'))$('#back-setup').onclick=()=>setStage('setup');
  if($('#open-latest'))$('#open-latest').onclick=()=>setStage('review',drafts()[0]);
  const startDraft=$('#start-draft');
  if(startDraft)startDraft.onclick=guard(async()=>{
    const first=drafts().find(item=>item.version===1);
    if(first){setStage('review',first);return;}
    const sourceId=$('#draft-source')?.value;
    if(!sourceId)return;
    startDraft.disabled=true;
    startDraft.textContent='Preparing Draft 1…';
    try{
      const result=await request('preview',{project:p.id,asset:sourceId,first:true});
      if(result.draft){await refresh(false);setStage('review',drafts().find(item=>item.id===result.draft));return;}
      pendingPreview=result.job;
      await refresh(false);updateJobs();notice('Preparing the first review draft.');
    }catch(error){startDraft.disabled=false;startDraft.textContent='Start Draft 1';throw error;}
  });
  if($('#approve'))$('#approve').onclick=guard(async()=>{await request('approve',{project:p.id,draft:d.id});await refresh();notice('Draft approved. Its version is preserved.');});
  if($('#export'))$('#export').onclick=()=>exportDialog(p,d);
  const submitRevision=$('#submit-revision');
  if(submitRevision)submitRevision.onclick=guard(async()=>{
    submitRevision.disabled=true;
    submitRevision.textContent='Starting revision…';
    try{
      const result=await request('revise',{project:p.id,draft:d.id});
      pendingPreview=result.job;
      submitRevision.textContent='Revising draft…';
      notice('Feedback submitted. The new draft will open when ready.');
      await refresh(false);updateJobs();
    }catch(error){
      if(!pendingPreview){
        submitRevision.disabled=false;
        submitRevision.textContent='Submit to Codex';
        throw error;
      }
    }
  });
  const copyReview=$('#copy-review');
  if(copyReview)copyReview.onclick=guard(async()=>{
    const notes=state.notes.filter(n=>n.draft===d.id);
    const review=[
      "Please review these KAT Studio notes and create a new draft for "+p.name+".",
      "Project ID: "+p.id+" | Draft V"+d.version+" | "+fps+" fps",
      p.config.brief ? "Brief: "+p.config.brief : "",
      ...notes.map(n=>"- ["+timecode(n.start_frame,fps)+"–"+timecode(n.end_frame,fps)+"] "+n.body+
        (n.link?" | "+n.link:"")+
        (n.attachments.length?" | Attachments: "+n.attachments.map(a=>a.name).join(", "):""))
    ].filter(Boolean).join("\n");
    await navigator.clipboard.writeText(review);
    notice('Review copied. Paste it into Codex. Attach any reference files you want Codex to inspect.');
  });
  const form=$('#note-form');
  if(form){
    const capture=()=>{
      video.pause();
      const frame=current();
      noteAnchor={start:frame,end:frame};
      syncNoteTime();
    };
    form.elements.body.addEventListener('focus',()=>{if(!noteAnchor)capture();});
    form.onsubmit=guard(async e=>{
      e.preventDefault();const fd=new FormData(form),body=Object.fromEntries(fd);delete body.files;
      const {start,end}=noteAnchor??{start:current(),end:current()};
      const result=await request('notes',{project:p.id,draft:d.id,...body,start,end});
      const files=[...form.elements.files.files];
      const failures=await upload('attach',files,{project:p.id,note:result.id});
      const frame=current();
      await refresh(false);
      if(projectId===p.id&&stage==='review'&&draftId===d.id){
        display();
        const player=$('#video');
        if(player.readyState>0)player.currentTime=frame/fps;
        else player.addEventListener('loadedmetadata',()=>{player.currentTime=frame/fps;},{once:true});
      }
      notice(failures.length?'Note saved. Attachment failed. '+failures.join(' · '):'Timestamped note saved.',Boolean(failures.length));
    });
    $$('[data-note-status]').forEach(select=>select.onchange=guard(async e=>{
      await request('note-status',{project:p.id,note:e.target.dataset.noteStatus,status:e.target.value});
      await refresh(false);notice('Note status saved.');
    }));
  }
}
function exportDialog(p,d){
  const info=d.metadata;
  const format=p.config.format;
  const presets={Vertical:[1080,1920],Landscape:[1920,1080],Square:[1080,1080]};
  const [w,h]=presets[format]||[info.width,info.height];
  dialog.innerHTML=`<h2>Confirm full-quality export</h2><p class="muted">${escape(p.name)} · Approved V${d.version} · MP4</p>
  <form id="export-form" class="fields space"><div class="two"><label>Width<input name="width" type="number" min="2" max="3840" step="2" value="${w}" required></label><label>Height<input name="height" type="number" min="2" max="3840" step="2" value="${h}" required></label></div>
  <div class="two"><label>Frames per second<input name="fps" type="number" min="12" max="60" step="any" value="${info.fps||30}" required></label><label>Codec<select name="codec"><option value="h264">H.264</option><option value="hevc">HEVC</option></select></label></div>
  <p class="muted">The export is saved in Studio Data and becomes downloadable from the render queue.</p>
  <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Start render</button></div></form>`;
  dialog.showModal();
  $('#export-form').onsubmit=guard(async e=>{
    e.preventDefault();const body=Object.fromEntries(new FormData(e.target));
    await request('export',{project:p.id,draft:d.id,...body,confirm:true});
    dialog.close();await refresh(false);updateJobs();notice('Export started.');
  });
}
function updateJobs(){
  if(view==='queue')$('#job-list').innerHTML=state.jobs.map(jobMarkup).join('')||empty('No render jobs.');
  if(view==='workspace')$('#project-jobs').innerHTML=jobs().filter(job=>job.state==='running').map(jobMarkup).join('');
}
async function refresh(redraw=true){
  const sequence=++refreshSequence;
  const headers = stateTag ? {'If-None-Match':stateTag} : {};
  const response=await fetch('api/state',{cache:'no-store',headers});
  if(response.status!==304){
    if(!response.ok)throw Error('Could not load Studio data.');
    const next=await response.json();
    if(sequence>appliedRefresh){
      state=next;
      stateTag=response.headers.get('ETag');
      appliedRefresh=sequence;
    }
  }
  if(redraw)display();
}
document.addEventListener('click',guard(async e=>{
  const btn=e.target.closest('button');if(!btn)return;
  if(btn.hasAttribute('data-close'))return dialog.close();
  if(btn.dataset.view)return setView(btn.dataset.view);
  if(btn.dataset.project)return openProject(btn.dataset.project);
  if(btn.dataset.deleteProject){
    const p=state.projects.find(item=>item.id===btn.dataset.deleteProject);
    if(p)deleteProjectDialog(p);
    return;
  }
  if(btn.dataset.purgeProject){
    const p=state.trash.find(item=>item.id===btn.dataset.purgeProject);
    if(p)purgeProjectDialog(p);
    return;
  }
  if(btn.dataset.restoreProject){
    await request('trash/restore',{project:btn.dataset.restoreProject});
    await refresh();notice('Project restored.');
    return;
  }
  if(btn.dataset.newClient)return wizard(btn.dataset.newClient);
  if(btn.dataset.style)return styleDialog(latestStyles().find(s=>s.id===btn.dataset.style));
  if(btn.dataset.asset){assetId=btn.dataset.asset;display();return;}
  if(btn.dataset.cancel){await request('cancel',{project:btn.dataset.jobProject,job:btn.dataset.cancel});await refresh(false);updateJobs();}
}));
$('#new-project').onclick=()=>wizard();
async function poll(){
  try{
    const before=state.jobs;
    await refresh(false);
    const completed=state.jobs.find(job=>job.project===projectId&&['Preview','Revision'].includes(job.kind)&&
      (job.id===pendingPreview||before.some(old=>old.id===job.id&&old.state==='running'))&&job.state!=='running');
    if(view==='workspace'&&completed){
      pendingPreview=null;
      if(completed.state==='complete'){setStage('review',drafts().find(item=>item.id===completed.draft));notice(completed.kind==='Revision'?'The revised draft is ready.':'Draft 1 is ready to review.');}
      else{display();notice(completed.detail,true);}
    }else if(['workspace','queue'].includes(view)&&JSON.stringify(before)!==JSON.stringify(state.jobs))updateJobs();
    $('#connection').textContent='Local studio';
  }catch{$('#connection').textContent='Studio offline';}
  finally{setTimeout(poll,1800);}
}
try{
  await refresh(false);
  const [encodedKey,screen]=location.hash.slice(1).split('/');
  const projectKey=decodeURIComponent(encodedKey);
  if(state.projects.some(p=>p.id===projectKey))openProject(projectKey,screen==='review'?'review':'setup');else display();
  $('#connection').textContent='Local studio';
  setTimeout(poll,1800);
}catch(error){content.innerHTML=empty(error.message);$('#connection').textContent='Studio offline';}
