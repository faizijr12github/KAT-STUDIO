const prefix='creator-pack-';
export const galleryGroups=['All styles','Saved styles','Short-form reels','Long-form & clips','Captions','Frame designs'];

const reelLayouts={
  'business-short-form-reels':['business','A better opening','Make the first beat count.'],
  'personal-short-form-reels':['personal','Behind the scenes','Here’s what worked.'],
  'broll-stacked-text-edit':['stacked','From idea','to final cut'],
  'split-reel':['split','Make it clear','Problem → solution'],
  'explainer-panel-reel':['panel','How it works','Start with one idea'],
  'glass-explainer-reel':['glass','Inside the workflow','Progress  •  72%'],
  'depth-ui-reel':['depth','Behind the edit','Small changes add up'],
  'cutout-backdrop-reel':['backdrop','Change the scene','One idea at a time'],
  'cutout-grid-reel':['grid','Four perspectives','The full picture'],
  'image-cluster-reel':['cluster','Connect the ideas','Look at the details'],
  'visual-essay-reel':['essay','The evidence','Look a little closer'],
  'ranking-format':['ranking','What makes the cut?','My editing shortlist'],
  'fitted-stacked-captions':['fitted','Make every','word count'],
  'educational-youtube-editor':['lesson','The story arc','Build the argument'],
  'split-screen-document-plus-animations':['document','Lesson notes','Structure the lesson'],
  'coaching-call-clips':['coaching','The turning point','Keep the strongest moment'],
  'youtube-clips':['clips','Pull the best moments','One lesson, three clips']
};
const frames={
  cartesian:['#ede8e0','#1a1a1a','#8a8178','serif','orbit'],
  'creative-mode':['#f7efe0','#201710','#f07d52','sans','blocks'],
  coral:['#f8eee7','#2d2226','#ef624c','sans','blocks'],
  'biennale-yellow':['#f8efd9','#292051','#f1c90d','serif','poster'],
  'daisy-days':['#fff2d7','#23493f','#62b8ae','serif','garden'],
  'cobalt-grid':['#f3ebda','#2443cb','#2443cb','sans','grid'],
  'code-editorial':['#f3edde','#232619','#c26550','serif','terminal'],
  capsule:['#efe9db','#171919','#8fba96','sans','pills'],
  'editorial-forest':['#f2ecdf','#173c32','#d989a4','serif','edit'],
  blockframe:['#f3e8fb','#191719','#b1daca','sans','blocks'],
  'blue-professional':['#faf4e6','#17264c','#1e2bfa','sans','business'],
  broadside:['#14110f','#f7f1e8','#fa692a','poster','poster'],
  'bold-poster':['#f5f0e7','#29211d','#e74029','poster','poster']
};

export function groupFor(style){
  const slug=style.id.startsWith(prefix)?style.id.slice(prefix.length):'';
  if(!slug)return 'Saved styles';
  if(frames[slug])return 'Frame designs';
  if(slug==='fitted-stacked-captions')return 'Captions';
  if(['educational-youtube-editor','split-screen-document-plus-animations','coaching-call-clips','youtube-clips'].includes(slug))return 'Long-form & clips';
  return 'Short-form reels';
}

function motifs(kind){
  if(kind==='ranking')return '<div class="mini-rank"><span>S</span><i></i><span>A</span><i></i><span>B</span><i></i></div>';
  if(kind==='document'||kind==='lesson'||kind==='coaching')return '<div class="mini-page"><b></b><i></i><i></i><i></i><i></i></div>';
  if(kind==='split'||kind==='panel')return '<div class="mini-flow"><i></i><b></b><i></i><b></b><i></i></div>';
  if(['glass','depth','business','clips'].includes(kind))return '<div class="mini-windows"><i></i><i></i><i></i></div>';
  if(['grid','cluster','essay','stacked','personal'].includes(kind))return '<div class="mini-tiles"><i></i><i></i><i></i><i></i></div>';
  return '';
}

export function artwork(style,escape){
  const slug=style.id.startsWith(prefix)?style.id.slice(prefix.length):'';
  if(frames[slug]){
    const [bg,ink,accent,type,motif]=frames[slug];
    return `<div class="style-art art-frame motif-${motif} type-${type}" style="--art-bg:${bg};--art-ink:${ink};--art-accent:${accent}" aria-hidden="true"><div class="frame-sample"><span class="frame-shapes"><i></i><i></i><i></i></span><span class="frame-type">${escape(style.name)}</span></div></div>`;
  }
  if(!reelLayouts[slug])return `<div class="style-art art-saved" aria-hidden="true"><span>${escape(style.name)}</span></div>`;
  const [kind,heading,caption]=reelLayouts[slug];
  return `<div class="style-art art-edit art-${kind}" aria-hidden="true"><div class="mini-edit">
    <span class="mini-heading">${heading}</span>${motifs(kind)}<span class="mini-person"><i></i></span><span class="mini-caption">${caption}</span>
  </div></div>`;
}
