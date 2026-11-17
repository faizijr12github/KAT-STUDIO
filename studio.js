import {galleryGroups,groupFor,artwork} from './style-gallery.js';

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
let styleFilter=galleryGroups[0], styleSearch='', comparedStyles=[];
function sampleFor(style){
  if(style.id!=='glk-law-firm-style')return null;
  return state.drafts.filter(d=>d.timeline.editorialChecks?.style===style.name+' v'+style.version)
    .sort((a,b)=>b.created.localeCompare(a.created))[0]||null;
}
function styleVisual(style,player=false){
  const sample=sampleFor(style);
  return sample?`<div class="style-art art-video">${player?`<video controls playsinline preload="metadata" src="${urlFor(sample.hash)}#t=1.25" aria-label="${escape(style.name)} rendered sample"></video>`:
    `<video muted playsinline preload="metadata" src="${urlFor(sample.hash)}#t=1.25" aria-hidden="true"></video><span class="preview-play" aria-hidden="true">▶</span>`}</div>`:artwork(style,escape);
}
function styleSummary(style){
  if(style.id==='glk-law-firm-style')return 'Portrait interviews with Poppins captions, navy and gold graphics, and a GLK closing card.';
  return style.rules.rules.split(/\n\s*\n/).find(section=>section.trim()&&!section.trimStart().startsWith('#'))||style.rules.rules;
}
function displayStylePreview(selected){
  const multiple=selected.length>1;
  dialog.classList.add('style-dialog');
  dialog.setAttribute('aria-labelledby','style-preview-heading');
  dialog.addEventListener('close',()=>{
    $$('video',dialog).forEach(video=>video.pause());
    dialog.classList.remove('style-dialog');
    dialog.removeAttribute('aria-labelledby');
  },{once:true});
  dialog.innerHTML=`<div class="split dialog-heading"><h2 id="style-preview-heading">${multiple?'Compare editing styles':escape(selected[0].name)}</h2>
    <button type="button" data-close aria-label="Close style preview">×</button></div>
    <div class="style-detail-grid ${multiple?'is-comparison':''}">${selected.map(style=>{
      const versions=state.styles.filter(x=>x.id===style.id);
      const projects=state.projects.filter(p=>p.config.style?.id===style.id&&p.config.style?.version===style.version);
      return `<section class="style-detail">${styleVisual(style,true)}
      <div class="stack style-detail-copy">
      ${multiple?`<h3>${escape(style.name)}</h3>`:''}
      <div class="row"><span class="pill">V${style.version}</span><span class="muted">${sampleFor(style)?'Rendered example':'Illustrative layout'}</span></div>
      <p class="style-rules">${escape(style.rules.rules)}</p>
      ${projects.length?`<p class="muted">Active in ${escape(projects.map(p=>p.name).join(', '))}</p>`:''}
      <details><summary>Version history</summary><div class="stack style-history">${versions.map(x=>`<p><strong>V${x.version}</strong> · ${escape(styleSummary(x))}</p>`).join('')}</div></details>
      <div class="row"><button class="primary" data-style-use="${escape(style.id)}">Start project</button><button data-style-edit="${escape(style.id)}">Create new version</button></div></div></section>`;
    }).join('')}</div>`;
  $$('[data-style-use]',dialog).forEach(button=>button.onclick=()=>{
    const style=selected.find(s=>s.id===button.dataset.styleUse);
    dialog.addEventListener('close',()=>wizard('',style.id+':'+style.version),{once:true});
    dialog.close();
  });
  $$('[data-style-edit]',dialog).forEach(button=>button.onclick=()=>{
    const style=selected.find(s=>s.id===button.dataset.styleEdit);
    dialog.addEventListener('close',()=>styleDialog(style),{once:true});
    dialog.close();
  });
  dialog.showModal();
}
function updateStyleGallery(){
  const all=latestStyles().sort((a,b)=>galleryGroups.indexOf(groupFor(a))-galleryGroups.indexOf(groupFor(b))||a.name.localeCompare(b.name));
  const query=styleSearch.trim().toLowerCase();
  const items=all.filter(s=>(styleFilter===galleryGroups[0]||groupFor(s)===styleFilter)&&
    [s.name,s.rules.category,s.rules.rules].some(value=>value?.toLowerCase().includes(query)));
  $('#style-count').textContent=items.length+' of '+all.length+' styles';
  $$('[data-style-filter]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.styleFilter===styleFilter)));
  const grid=$('#style-cards');
  grid.innerHTML=items.map(style=>{
    const selected=comparedStyles.includes(style.id);
    const group=groupFor(style);
    const summary=styleSummary(style);
    return `<article class="card style-card ${selected?'is-selected':''}">
      <button type="button" class="style-cover" data-preview-style="${escape(style.id)}" aria-label="Preview ${escape(style.name)}">${styleVisual(style)}${sampleFor(style)?'':'<span class="preview-open" aria-hidden="true">↗</span>'}</button>
      <div class="style-card-body"><div class="style-card-meta"><span>${escape(group)}</span><span>V${style.version}</span></div>
      <h2>${escape(style.name)}</h2><p>${escape(summary)}</p>
      <button type="button" class="style-compare-toggle" data-compare-style="${escape(style.id)}" aria-pressed="${selected}" aria-label="Compare ${escape(style.name)}">${selected?'✓ Added':'＋ Compare'}</button></div></article>`;
  }).join('')||empty('No styles match your filters.');
  const compare=$('#style-compare');
  compare.textContent='Compare ('+comparedStyles.length+'/2)';
  compare.disabled=comparedStyles.length!==2;
  $('#style-selection').textContent=comparedStyles.map(id=>all.find(s=>s.id===id)?.name).filter(Boolean).join(' + ');
  $('#style-clear').hidden=!comparedStyles.length;
  if(matchMedia('(hover: hover) and (prefers-reduced-motion: no-preference)').matches){
    $$('.style-cover video',grid).forEach(video=>{
      const button=video.closest('button');
      button.onpointerenter=e=>{if(e.pointerType==='mouse')video.play().catch(()=>{});};
      button.onpointerleave=()=>video.pause();
    });
  }
}
function styles(){
  content.innerHTML=`<header class="gallery-header">
    <div><h1>Editing <em>styles</em></h1><p class="muted">Preview a style, compare two, or start a project with a preset.</p></div>
    <button class="primary" id="new-style">＋ New style</button>
  </header>
  <div class="gallery-toolbar">
    <div class="style-filters" role="group" aria-label="Filter styles">
      ${galleryGroups.map(group=>`<button type="button" data-style-filter="${escape(group)}" aria-pressed="false">${escape(group)}</button>`).join('')}
    </div>
    <input id="style-search" type="search" aria-label="Search editing styles" placeholder="Search styles" value="${escape(styleSearch)}">
  </div>
  <div class="split gallery-status"><span id="style-count" role="status"></span><div class="row">
    <span id="style-selection"></span><button class="quiet" id="style-clear" hidden>Clear</button><button id="style-compare" disabled>Compare (0/2)</button>
  </div></div>
  <div class="style-grid" id="style-cards"></div>`;
  $('#new-style').onclick=()=>styleDialog();
  $('#style-search').oninput=e=>{styleSearch=e.target.value;updateStyleGallery();};
  $$('.style-filters button').forEach(button=>button.onclick=()=>{styleFilter=button.dataset.styleFilter;updateStyleGallery();});
  $('#style-clear').onclick=()=>{comparedStyles=[];updateStyleGallery();$('#style-search').focus();};
  $('#style-compare').onclick=()=>displayStylePreview(comparedStyles.map(id=>latestStyles().find(s=>s.id===id)).filter(Boolean));
  $('#style-cards').onclick=e=>{
    const preview=e.target.closest('[data-preview-style]');
    if(preview)return displayStylePreview([latestStyles().find(s=>s.id===preview.dataset.previewStyle)]);
    const button=e.target.closest('[data-compare-style]');
    if(!button)return;
    const id=button.dataset.compareStyle;
    if(comparedStyles.includes(id))comparedStyles=comparedStyles.filter(value=>value!==id);
    else if(comparedStyles.length<2)comparedStyles.push(id);
    else return notice('Clear one selected style before adding another.');
    updateStyleGallery();
    $$('[data-compare-style]').find(b=>b.dataset.compareStyle===id)?.focus({preventScroll:true});
  };
  updateStyleGallery();
}
function jobMarkup(job){
  const name=state.projects.find(p=>p.id===job.project)?.name||'Project';
  return `<article class="card"><div class="split"><strong>${escape(name)} · ${escape(job.kind)}</strong><span class="pill">${escape(job.state)}</span></div>
  <p class="muted">${escape(job.detail)}</p>${job.total>0&&['running','complete'].includes(job.state)?`<progress value="${job.progress}" max="1" aria-label="Render completion"></progress><p class="muted">${Math.floor(job.progress*100)}% · ${job.frames} / ${job.total} frames</p>`:''}
  ${job.state==='running'?`<button class="space" data-cancel="${job.id}" data-job-project="${job.project}">Cancel</button>`:''}
  ${view==='queue'&&job.kind==='First Draft'&&['failed','cancelled','interrupted'].includes(job.state)?`<button class="space" data-project="${escape(job.project)}">Open setup and retry</button>`:''}
  ${job.state==='complete'&&job.hash?`<a class="button" href="${urlFor(job.hash,'KAT-'+job.kind.toLowerCase()+'.mp4')}">Download MP4</a>`:''}</article>`;
}
function queue(){
  content.innerHTML=title('Render queue','Preview and export jobs on this Mac.')+
  `<div class="stack" id="job-list">${state.jobs.map(jobMarkup).join('')||empty('Rendered previews and confirmed exports will appear here.')}</div>`;
}
function display(){
  $$('.nav button').forEach(btn=>{
    const active=btn.dataset.view===view||(view==='workspace'&&btn.dataset.view==='projects');
    btn.classList.toggle('active',active);
    if(active)btn.setAttribute('aria-current','page');else btn.removeAttribute('aria-current');
  });
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
  view=next;history.replaceState(null,'',location.pathname+(next==='projects'?'':'#'+next));display();
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
function wizard(clientId='',styleKey=''){
  const known=client(clientId);
  const fields=[
    ['Client',`<label>Client library<select name="client" id="client-input"><option value="">New client</option>${state.clients.map(c=>`<option value="${c.id}" ${c.id===clientId?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label><label>Client name<input name="clientName" value="${escape(known?.name)}"></label><label>Business, products, customers and selling points<textarea name="description">${escape(known?.profile.description)}</textarea></label><label>Website and social links<textarea name="links" placeholder="One link per line">${escape(known?.profile.links?.join('\n'))}</textarea></label>`],
    ['Publishing',`<div class="checks">${platforms.map(p=>`<label><input type="checkbox" name="platforms" value="${p}"> ${p}</label>`).join('')}</div><label>Starting format<select name="format" id="format-input">${options(['Vertical','Landscape','Square'])}</select></label>`],
    ['Brand',`<label>Colors, fonts, voice and prohibited elements<textarea name="brand">${escape(known?.profile.brand)}</textarea></label><p class="muted">You can import brand PDFs, logos, and screenshots in Project Assets.</p>`],
    ['Brief','<label>Objective, audience, duration, story, hook, CTA and pacing<textarea name="brief"></textarea></label>'],
    ['References','<label>URLs and what to take from each reference<textarea name="references" placeholder="Link and notes"></textarea></label><p class="muted">Import reference images and clips in the workspace.</p>'],
    ['Style',`<p class="muted" id="glk-style-prompt" hidden>Would you like to apply GLK Law Firm Styles?</p><label>Editing style<select name="style"><option value="">Choose later</option><option value="none">Continue without saved style</option>${latestStyles().map(s=>`<option value="${s.id}:${s.version}">${escape(s.name)} · V${s.version}</option>`).join('')}</select></label><div class="active-style-preview" id="wizard-style-preview"></div>`],
    ['Create', '<label>Project name<input name="name" required placeholder="Campaign or video title"></label><p class="muted" id="wizard-summary"></p>']
  ];
  dialog.innerHTML=`<p class="step-label" id="step-label"></p><h2 id="wizard-heading"></h2><form id="project-form" class="space">
  ${fields.map(([,markup],i)=>`<div class="form-step fields" data-step="${i}">${markup}</div>`).join('')}
  <div class="dialog-foot"><div class="row"><button type="button" data-close>Cancel</button><button type="button" id="prev-step">Back</button></div>
  <button type="button" class="primary" id="next-step">Next</button><button type="submit" class="primary" id="create-project">Create project</button></div></form>`;
  let step=0;const form=$('#project-form');
  if(styleKey)form.elements.style.value=styleKey;
  const updateStylePreview=()=>{
    const style=state.styles.find(s=>s.id+':'+s.version===form.elements.style.value);
    $('#wizard-style-preview').innerHTML=style?`${styleVisual(style)}<p class="muted">${escape(styleSummary(style))}</p>`:'';
  };
  form.elements.style.onchange=updateStylePreview;
  function show(){
    $$('.form-step',form).forEach((el,i)=>el.hidden=i!==step);
    $('#step-label').textContent='STEP '+(step+1)+' OF '+fields.length;
    $('#wizard-heading').textContent=fields[step][0];
    $('#prev-step').disabled=!step;$('#next-step').hidden=step===6;$('#create-project').hidden=step!==6;
    $('#glk-style-prompt').hidden=!requiresStyleChoice();
    if(step===5)updateStylePreview();
    if(step===6)$('#wizard-summary').textContent=[form.elements.clientName.value,form.elements.format.value,form.elements.style.selectedOptions[0]?.textContent,...new FormData(form).getAll('platforms')].filter(Boolean).join(' · ');
  }
  function requiresStyleChoice(){
    const chosen=client(form.elements.client.value)?.name||form.elements.clientName.value;
    return /^GLK(?: Law Firm)?$/i.test(chosen.trim())&&latestStyles().some(s=>s.id==='glk-law-firm-style');
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
function sourcePreview(d){
  return d.timeline.kind==='source-preview'||/^(?:Trim to |Imported original preview)/.test(d.summary);
}

function contextMarkup(ctx){
  const style=ctx.style;
  return `<div class="context-grid">
    <section><h3>Instructions</h3>
      ${ctx.missingAssets.length?`<p class="invalid">Missing: ${ctx.missingAssets.map(escape).join(", ")}</p>`:''}
      <p class="context-text">${escape(ctx.project.config.brief||'No project brief saved.')}</p>
      <details><summary>Brand and references</summary><p class="context-text">${escape(ctx.project.config.brand||ctx.client.brand)}</p><p class="context-text">${escape(ctx.project.config.references||(ctx.client.links||[]).join('\n'))}</p></details>
      ${style?`<details><summary>${escape(style.name)} v${style.version} rules</summary><p class="context-text">${escape(style.rules.rules)}</p></details>`:''}
    </section>
    <section><h3>Revision history</h3>
      ${ctx.drafts.map(d=>`<article class="context-record"><strong>V${d.version}${d.approved?' · Approved':''}</strong><p>${escape(d.summary)}</p>${d.checks.style?`<small>${escape(d.checks.style)}${d.checks.endScreenSimilarity!=null?' · End screen verified':''}</small>`:''}</article>`).join('')||empty('Drafts will appear here.')}
      ${ctx.notes.map(n=>`<article class="context-record"><strong>V${n.version} · ${escape(n.status)}</strong><p>${escape(n.body)}</p></article>`).join('')}
    </section>
    <section><h3>Learned preferences</h3>
      ${ctx.learning.filter(l=>l.source!=='initial-brief').slice().reverse().map(l=>`<article class="context-record"><strong>${escape(l.kind)} · ${l.scope==='client'?'Client':'Project'}</strong><p class="context-text">${escape(l.text)}</p></article>`).join('')||empty('Save a project instruction or a reusable client preference.')}
    </section>
  </div>`;
}

async function readContext(p){
  return request('editing-context?'+new URLSearchParams({project:p.id}));
}
async function prepareEdit(p){
  const ctx=await readContext(p);
  const brief={...ctx,drafts:ctx.drafts.map(({version,summary,approved})=>({version,summary,approved}))};
  await navigator.clipboard.writeText(
    'Create a new editorial draft for this KAT Studio project. Read its current context with edit-context.mjs before editing and register the verified render through the same CLI. Follow newer explicit project directions and the selected style version. Account for earlier feedback and approved decisions.\n\n'+JSON.stringify(brief,null,2));
  notice('Editing brief copied with saved instructions, style and assets.');
}
function compareDrafts(current){
  const previous=drafts().find(d=>d.version<current.version)||drafts().find(d=>d.id!==current.id);
  const choices=chosen=>drafts().map(d=>`<option value="${d.id}" ${d.id===chosen?'selected':''}>V${d.version}${sourcePreview(d)?' · Source preview':''}</option>`).join('');
  const panel=(side,d)=>`<section class="stack"><label>${side}<select aria-label="${side}" class="compare-choice">${choices(d.id)}</select></label><video preload="metadata" playsinline muted src="${urlFor(d.hash)}"></video><p class="muted compare-summary">${escape(d.summary)}</p></section>`;
  dialog.classList.add('compare-dialog');
  dialog.addEventListener('close',()=>{dialog.classList.remove('compare-dialog');dialog.querySelectorAll('video').forEach(v=>v.pause());},{once:true});
  dialog.innerHTML=`<h2>Compare drafts</h2><div class="compare-grid space">${panel('Earlier draft',previous)}${panel('Current draft',current)}</div>
    <div class="row space"><button id="compare-play">Play both</button><label class="row">Preview time <input id="compare-time" type="range" min="0" step=".033" value="0"></label><label class="row"><input id="compare-audio" type="checkbox"> Current draft audio</label></div>
    <div class="dialog-foot"><button data-close>Close</button></div>`;
  const videos=$$('video',dialog), play=$('#compare-play'), seek=$('#compare-time');
  function refreshRange(){
    seek.max=Math.max(0,...videos.map(v=>Number.isFinite(v.duration)?v.duration:0));
  }
  function seekBoth(time){for(const v of videos)if(Number.isFinite(v.duration))v.currentTime=Math.min(time,v.duration);}
  videos.forEach(v=>v.onloadedmetadata=refreshRange);
  videos[1].ontimeupdate=()=>{if(!videos[1].paused)seek.value=videos[1].currentTime;};
  videos[1].onended=()=>{videos[0].pause();play.textContent='Play both';};
  seek.oninput=()=>seekBoth(Number(seek.value));
  play.onclick=guard(async()=>{
    if(videos.some(v=>!v.paused)){videos.forEach(v=>v.pause());play.textContent='Play both';return;}
    if(videos[1].ended)seek.value=0;
    seekBoth(Number(seek.value));
    await Promise.all(videos.map(v=>v.play()));
    play.textContent='Pause both';
  });
  $('#compare-audio').onchange=e=>{videos[1].muted=!e.target.checked;};
  $$('.compare-choice',dialog).forEach((select,i)=>{select.onchange=()=>{
    videos.forEach(v=>v.pause());play.textContent='Play both';seek.value=0;
    const draft=drafts().find(d=>d.id===select.value);
    videos[i].src=urlFor(draft.hash);seekBoth(0);
    $$('.compare-summary',dialog)[i].textContent=draft.summary;
  };});
  dialog.showModal();
}

function workspace(){
  const p=project();if(!p){setView('projects');return;}
  if(stage==='review'&&!selectedDraft()){setStage('setup');return;}
  const review=stage==='review';
  const d=review?selectedDraft():null, a=review?null:selectedAsset();
  const first=drafts().find(item=>!sourcePreview(item));
  const videos=assets().filter(item=>item.mime.startsWith('video/')&&item.metadata.duration>0);
  const sourceVideos=videos.filter(item=>item.category==='Raw Footage');
  const primarySource=sourceVideos.find(item=>/\/raw video\//i.test(item.name))||sourceVideos[0];
  const activeDraft=jobs().find(job=>job.kind==='First Draft'&&job.state==='running');
  const source=a||d, playable=source?.mime?.startsWith('video/');
  const info=source?.metadata||{}, fps=info.fps||30, endFrame=Math.max(0,(info.frames||Math.ceil((info.duration||0)*fps))-1);
  const notes=!a&&d?state.notes.filter(n=>n.draft===d.id):[];
  const style=state.styles.find(s=>s.id===p.config.style?.id&&s.version===p.config.style?.version);
  const actionButton=d&&!a&&!sourcePreview(d) ? (d.approved?'<button class="primary" id="export">Export approved draft</button>':'<button class="primary" id="approve">Approve draft</button>'):'';
  const stageActions=review?'<button id="back-setup">← Project Setup</button>'+actionButton+'<button class="primary" id="download-latest">Download Latest Draft</button>':
    first?'<button id="open-latest">Open latest draft</button>':'';
  content.innerHTML=`<div class="eyebrow stage-label">${review?'02 · Draft Review':'01 · Project Setup'}</div>`+
    title(p.name,[client(p.client)?.name,p.config.format,style&&style.name+' v'+style.version].filter(Boolean).join(' · '),stageActions)+
  `<div class="row project-tools"><button id="show-context" aria-expanded="false">Instructions and history</button>
  <button id="prepare-edit">Prepare edit for Codex</button>
  ${review&&drafts().length>1?'<button id="compare-drafts">Compare drafts</button>':''}
  ${!review?'<button id="change-style">Change active style</button>':''}</div>
  <section class="pane context-pane" id="editing-context" hidden>
    <h2>Project instructions and learning</h2><div class="pad" id="context-body" aria-live="polite"></div>
    <form id="learning-form" class="pad stack"><label>Instruction or preference<textarea name="text" required maxlength="8000"></textarea></label>
    <div class="row"><label>Applies to<select name="scope"><option value="project">This project</option><option value="client">All projects for this client</option></select></label><button class="primary">Save guidance</button></div></form>
  </section>`+
  `  ${!review&&!first?`<section class="pane setup-footer space"><div><h2>First draft</h2>
  <p class="muted">${first?'Open the latest edit for review.':primarySource?'Codex reviews the imported folder, footage and references, then renders an edited draft.':'Import a project folder or raw footage to begin.'}</p></div>
  <div class="setup-next">${!first&&sourceVideos.length>1?`<label for="draft-source" class="muted">Main footage</label><select id="draft-source">${sourceVideos.map(item=>`<option value="${item.id}" ${item.id===((a?.category==='Raw Footage'?a:primarySource)?.id)?'selected':''}>${escape(item.name)}</option>`).join('')}</select>`:''}
  <button class="primary" id="start-draft" data-source="${escape(primarySource?.id)}" ${!first&&(!primarySource||activeDraft)?'disabled':''}>${activeDraft?'Making first draft…':first?'Open latest draft':jobs().some(j=>j.kind==='First Draft'&&j.state==='failed')?'Retry first draft':'Make first draft'}</button></div></section>`:''}
  <div class="space stack workspace-jobs" id="project-jobs">${projectJobsHtml()}</div>`+
  `<div class="workspace ${review?'review-workspace':'setup-workspace'}">
    ${!review?`<section class="pane" id="asset-pane"><h2>Project Assets <small class="muted">${assets().length} files</small></h2><div class="pad">
    <div class="import-area stack"><h3>Add your project media</h3><p class="muted">Import a project folder to preserve its structure, or add individual files. You can also drop files here.</p>
    <label>Import as<select id="category">${options(['Auto',...state.categories],'Auto')}</select></label>
    <div class="row"><button id="pick-folder" class="primary">Choose project folder</button><button id="pick-files">Add files</button></div>
    <input type="file" id="files" multiple hidden><input type="file" id="folder" webkitdirectory multiple hidden></div>
    <div id="import-progress" class="stack" hidden><span id="import-status" role="status"></span><progress id="import-meter"></progress></div>
    <label>Filter assets<select id="asset-filter">${options(['All assets',...new Set(assets().map(a=>a.category))],'All assets')}</select></label>
    <div class="asset-list space">${assets().map(item=>`<button data-asset="${item.id}" data-category="${escape(item.category)}" class="asset ${item.id===assetId?'selected':''}">${escape(item.name)}<small>${escape(item.category)}${item.metadata.duration?' · '+item.metadata.duration.toFixed(1)+'s':''}</small></button>`).join('')||'<p class="muted">No source media imported.</p>'}</div>
    <details class="space"><summary>Project brief</summary><p>${escape(p.config.brief)||'No brief added.'}</p>${p.config.brand?`<p>${escape(p.config.brand)}</p>`:''}${p.config.references?`<p>${escape(p.config.references)}</p>`:''}${style?`<p class="style-rules">${escape(style.rules.rules)}</p>`:''}</details>
    </div></section>`:''}
    <section class="pane preview-pane"><div class="pane-title split"><h2>${review?(sourcePreview(d)?'Source preview · V'+d.version:'Draft '+d.version+' preview'):'Source preview'}</h2>
    <div class="row">${review?`<select id="draft-select" aria-label="Draft version">${drafts().map(item=>`<option value="${item.id}" ${!a&&d?.id===item.id?'selected':''}>V${item.version}${item.approved?' · Approved':''}</option>`).join('')}</select>`:''}</div></div>
    <div class="stage" id="stage">
    ${playable?`<video id="video" preload="metadata" playsinline src="${urlFor(source.hash)}"></video><div id="guide" class="guide" hidden></div>`:a?.mime.startsWith('image/')?`<img style="max-width:100%;max-height:480px" src="${urlFor(a.hash)}" alt="${escape(a.name)}">`:a?.mime.startsWith('audio/')?`<audio controls src="${urlFor(a.hash)}"></audio>`:a?`<a href="${urlFor(a.hash,a.name)}">Download source file</a>`:empty('Select an imported asset to preview it here.')}</div>
    ${playable?`<div class="transport"><input id="playhead" type="range" min="0" max="${endFrame}" value="0" aria-label="Video frame">
    <div class="marker-row">${notes.map((n,i)=>`<button data-seek="${n.start_frame}" data-marker="${n.id}" style="left:${n.start_frame/Math.max(1,endFrame)*100}%" title="${escape(n.body)}" aria-label="Note ${i+1}">${i+1}</button>`).join('')}</div>
    <div class="split"><div class="row"><button id="play">Play</button><button id="frame-back" aria-label="Previous frame">−1f</button><button id="frame-next" aria-label="Next frame">+1f</button><button id="guides">Safe zone</button><button id="fullscreen">Full screen</button></div>
    <div class="row"><select id="speed" aria-label="Playback speed">${[.5,1,1.5,2].map(n=>`<option value="${n}" ${n===1?'selected':''}>${n}×</option>`).join('')}</select><span class="tc" id="time">00:00:00:00</span></div></div></div>`:''}
    ${d?.timeline.recipe?.intakeReview?`<details class="qa-panel"><summary>Folder and reference review</summary>
      <ul>${[...d.timeline.recipe.intakeReview.assets,...d.timeline.recipe.intakeReview.links].map(item=>`<li><strong>${escape(item.url||assets().find(a=>a.id===item.id)?.name||'Imported asset')}</strong> · ${escape(item.status)} — ${escape(item.detail)}</li>`).join('')}</ul></details>`:''}
    ${d?.timeline.qa?`<details class="qa-panel"><summary>${d.timeline.qa.warnings.length?'Technical QA · review flagged items':'Technical QA · checks passed'}</summary><p>${d.timeline.qa.warnings.length?d.timeline.qa.warnings.map(escape).join(' '):'Video and audio decoded successfully.'} Check caption sync and pacing during playback.</p></details>`:''}
    ${review?`<div class="draft-download" id="draft-download" hidden><p class="muted" id="download-status" role="status"></p><progress id="download-progress" aria-label="Draft download progress" max="1" hidden></progress></div>`:''}
    </section>
    ${review?`<section class="pane review"><h2>Timeline feedback</h2><div class="pad">
    <form id="note-form" class="stack"><label>Revision note<textarea name="body" required placeholder="What should change here?"></textarea></label>
    <div class="note-anchor"><span class="muted">Comment at</span> <output id="note-time" class="tc">00:00:00:00</output></div>
    <label>Images or clips<input type="file" name="files" accept="image/*,video/*" multiple></label>
    <button class="primary">Add note</button></form><div><div class="notes-list">${notes.map(n=>noteMarkup(n,fps)).join('')}</div>${d.canRevise?`<button class="primary space" id="submit-revision" ${notes.some(n=>n.status==='Pending')&&!jobs().some(j=>j.state==='running')?'':'disabled'}>Submit to Codex</button>`:notes.length?'<button class="space" id="copy-review">Copy review for Codex</button>':''}</div></div></section>`:''}
  </div>
`;
  bindWorkspace(p,d,a,info,fps,endFrame);
  const updateContext=async()=>{$('#context-body').innerHTML=contextMarkup(await readContext(p));};
  $('#show-context').onclick=guard(async e=>{
    const panel=$('#editing-context');
    panel.hidden=!panel.hidden;
    e.target.setAttribute('aria-expanded',String(!panel.hidden));
    if(!panel.hidden){$('#context-body').textContent='Loading project context…';await updateContext();}
  });
  $('#learning-form').onsubmit=guard(async e=>{
    e.preventDefault();
    const form=e.currentTarget, input=Object.fromEntries(new FormData(form));
    await request('learning',{...input,project:p.id});form.reset();await updateContext();notice('Guidance saved.');
  });
  $('#prepare-edit').onclick=guard(()=>prepareEdit(p));
  if($('#compare-drafts'))$('#compare-drafts').onclick=()=>compareDrafts(d);
  if($('#change-style'))$('#change-style').onclick=()=>{
    dialog.innerHTML=`<h2>Active editing style</h2><form id="active-style-form" class="fields space">
      <label>Style version<select name="style"><option value="">No style selected</option>
      ${state.styles.map(x=>`<option value="${x.id}:${x.version}" ${x.id===style?.id&&x.version===style?.version?'selected':''}>${escape(x.name)} v${x.version}</option>`).join('')}</select></label><div class="active-style-preview" id="active-style-preview"></div>
      <div class="dialog-foot"><button type="button" data-close>Cancel</button><button class="primary">Apply style</button></div></form>`;
    dialog.showModal();
    const select=$('#active-style-form select');
    const preview=()=>{
      const chosen=state.styles.find(s=>s.id+':'+s.version===select.value);
      $('#active-style-preview').innerHTML=chosen?`${styleVisual(chosen)}<p class="muted">${escape(styleSummary(chosen))}</p>`:'';
    };
    select.onchange=preview;
    preview();
    $('#active-style-form').onsubmit=guard(async e=>{
      e.preventDefault();
      await request('project-style',{project:p.id,style:new FormData(e.currentTarget).get('style')});
      dialog.close();await refresh();notice('Active style saved.');
    });
  };
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
async function droppedFiles(transfer){
  const files=[...transfer.files];
  const entries=[...transfer.items].map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
  if(!entries.some(entry=>entry.isDirectory))return files;
  async function walk(entry){
    if(entry.isFile){
      const file=await new Promise((resolve,reject)=>entry.file(resolve,reject));
      return [{file,relativePath:entry.fullPath.replace(/^\//,'')}];
    }
    const reader=entry.createReader(), children=[];
    for(;;){
      const batch=await new Promise((resolve,reject)=>reader.readEntries(resolve,reject));
      if(!batch.length)break;
      children.push(...batch);
    }
    return (await Promise.all(children.map(walk))).flat();
  }
  return (await Promise.all(entries.map(walk))).flat();
}

async function upload(route,files,query,onProgress=()=>{}){
  const failures=[];
  for(const [index,entry] of files.entries()){
    const file=entry.file||entry;
    const params=new URLSearchParams({...query,name:entry.relativePath||file.webkitRelativePath||file.name});
    try{
      const result=await fetch('api/'+route+'?'+params,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(!result.ok)throw Error((await result.json()).error);
    }catch(error){failures.push(file.name+' · '+error.message);}
    onProgress(index+1,files.length);
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
    let importing=false;
    $('#asset-filter').onchange=e=>$$('[data-asset]',pane).forEach(item=>{item.hidden=e.target.value!=='All assets'&&item.dataset.category!==e.target.value;});
    const doImport=guard(async files=>{
      if(!files.length||importing)return;
      importing=true;
      const draftButton=$('#start-draft');
      if(draftButton)draftButton.disabled=true;
      const progress=$('#import-progress',pane), meter=$('#import-meter',pane), status=$('#import-status',pane);
      progress.hidden=false;meter.max=files.length;meter.value=0;status.textContent='Scanning project files…';
      notice('Importing '+files.length+' file(s)…');
      let failures;
      try{failures=await upload('import',files,{project:p.id,category:$('#category').value},(count,total)=>{
        meter.value=count;status.textContent=count+' of '+total+' files processed';
      });}finally{importing=false;progress.hidden=true;}
      await refresh();
      notice(failures.length?failures.join(' · '):'Media imported.',Boolean(failures.length));
    });
    $('#pick-files').onclick=()=>$('#files').click();
    $('#pick-folder').onclick=()=>$('#folder').click();
    for(const selector of ['#files','#folder'])$(selector).onchange=e=>void doImport([...e.target.files]);
    pane.ondragover=e=>{e.preventDefault();pane.classList.add('dragging');};
    pane.ondragleave=()=>pane.classList.remove('dragging');
    pane.ondrop=guard(async e=>{e.preventDefault();pane.classList.remove('dragging');await doImport(await droppedFiles(e.dataTransfer));});
  }
  if($('#back-setup'))$('#back-setup').onclick=()=>setStage('setup');
  if($('#open-latest'))$('#open-latest').onclick=()=>setStage('review',drafts()[0]);
  const startDraft=$('#start-draft');
  if(startDraft)startDraft.onclick=guard(async()=>{
    const first=drafts().find(item=>!sourcePreview(item));
    if(first){setStage('review',first);return;}
    const sourceId=$('#draft-source')?.value||startDraft.dataset.source;
    if(!sourceId)return;
    startDraft.disabled=true;
    startDraft.textContent='Making first draft…';
    try{
      const result=await request('first-draft',{project:p.id,asset:sourceId});
      pendingPreview=result.job;
      await refresh(false);updateJobs();notice('First draft started. Codex will review the supplied material.');
    }catch(error){startDraft.disabled=false;startDraft.textContent='Make first draft';throw error;}
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
      "Read the current KAT Studio editing context before applying these notes, then register the verified render.",
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
function projectJobsHtml(){
  const rows=jobs();
  const latest=rows.find(job=>job.kind==='First Draft');
  return rows.filter(job=>job.state==='running'||job===latest&&['failed','cancelled','interrupted'].includes(job.state)).map(jobMarkup).join('');
}
function updateJobs(){
  if(view==='queue')$('#job-list').innerHTML=state.jobs.map(jobMarkup).join('')||empty('No render jobs.');
  if(view==='workspace')$('#project-jobs').innerHTML=projectJobsHtml();
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
    const completed=state.jobs.find(job=>job.project===projectId&&['Preview','Source Preview','Revision','First Draft'].includes(job.kind)&&
      (job.id===pendingPreview||before.some(old=>old.id===job.id&&old.state==='running'))&&job.state!=='running');
    if(view==='workspace'&&completed){
      pendingPreview=null;
      if(completed.state==='complete'){setStage('review',drafts().find(item=>item.id===completed.draft));notice(completed.kind==='First Draft'?completed.detail:completed.kind==='Revision'?'The revised draft is ready.':'Source preview is ready.');}
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
  if(state.projects.some(p=>p.id===projectKey))openProject(projectKey,screen==='review'?'review':'setup');
  else if(['styles','clients','queue'].includes(projectKey))setView(projectKey);
  else display();
  $('#connection').textContent='Local studio';
  setTimeout(poll,1800);
}catch(error){content.innerHTML=empty(error.message);$('#connection').textContent='Studio offline';}
