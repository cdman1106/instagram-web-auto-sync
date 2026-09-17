export function embedScriptBody(apiOrigin) {
  const origin = JSON.stringify(apiOrigin);
  return `(()=>{
  const script=document.currentScript;
  if(!script)return;
  const site=script.dataset.site;
  if(!site)return;
  const style=(script.dataset.style||'grid').toLowerCase();
  const mount=script.previousElementSibling&&script.previousElementSibling.hasAttribute('data-instagram-auto-sync')
    ? script.previousElementSibling
    : (()=>{const d=document.createElement('div');d.setAttribute('data-instagram-auto-sync','');script.parentNode.insertBefore(d,script);return d})();
  mount.setAttribute('data-iwas-style',style);
  const origin=${origin};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  if(!document.getElementById('iwas-style')){
    const st=document.createElement('style');
    st.id='iwas-style';
    st.textContent='[data-instagram-auto-sync]{--iwas-gap:10px;font-family:inherit}.iwas-stories{display:flex;gap:10px;overflow:auto;padding:3px 0 12px;scrollbar-width:none}.iwas-stories::-webkit-scrollbar{display:none}.iwas-story{width:70px;flex:0 0 70px;text-decoration:none;color:inherit}.iwas-story img{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #fff;outline:2px solid #d14f8f}.iwas-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--iwas-gap)}.iwas-item{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:#eee}.iwas-item img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s ease}.iwas-item:hover img{transform:scale(1.025)}.iwas-play{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:5px 8px;font:700 11px/1 sans-serif}.iwas-empty{padding:18px;color:#777;text-align:center;font-size:13px}[data-iwas-style="minimal"]{--iwas-gap:2px}[data-iwas-style="minimal"] .iwas-item{border-radius:0}[data-iwas-style="minimal"] .iwas-grid{grid-template-columns:repeat(4,minmax(0,1fr))}[data-iwas-style="minimal"] .iwas-play{right:5px;bottom:5px;padding:4px 6px;font-size:10px}[data-iwas-style="carousel"] .iwas-grid{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 1px 8px;scrollbar-width:none}[data-iwas-style="carousel"] .iwas-grid::-webkit-scrollbar{display:none}[data-iwas-style="carousel"] .iwas-item{flex:0 0 min(280px,74vw);scroll-snap-align:start;border-radius:16px;box-shadow:0 8px 26px rgba(0,0,0,.08)}@media(max-width:520px){.iwas-grid{gap:6px}.iwas-item{border-radius:5px}[data-iwas-style="minimal"] .iwas-grid{grid-template-columns:repeat(3,minmax(0,1fr))}[data-iwas-style="carousel"] .iwas-grid{gap:10px}[data-iwas-style="carousel"] .iwas-item{border-radius:14px}}';
    document.head.appendChild(st);
  }
  const mediaHtml=(m,isReel)=>{
    const src=esc(m.thumbnail_url||m.media_url||'');
    const href=esc(m.permalink||'#');
    const alt=esc((m.caption||'Instagram投稿').slice(0,120));
    if(!src)return '';
    return '<a class="iwas-item" href="'+href+'" target="_blank" rel="noopener noreferrer"><img src="'+src+'" loading="lazy" alt="'+alt+'">'+(isReel?'<span class="iwas-play">▶ Reel</span>':'')+'</a>';
  };
  fetch(origin+'/api/feed/'+encodeURIComponent(site),{mode:'cors'})
    .then(r=>{if(!r.ok)throw new Error('feed');return r.json()})
    .then(d=>{
      const stories=(d.stories||[]).map(s=>{
        const src=esc(s.thumbnail_url||s.media_url||'');
        const href=esc(s.permalink||'#');
        return src?'<a class="iwas-story" href="'+href+'" target="_blank" rel="noopener noreferrer"><img src="'+src+'" loading="lazy" alt="Instagram Story"></a>':'';
      }).join('');
      const items=[...(d.posts||[]).map(x=>mediaHtml(x,false)),...(d.reels||[]).map(x=>mediaHtml(x,true))].join('');
      mount.innerHTML=(stories?'<div class="iwas-stories">'+stories+'</div>':'')+(items?'<div class="iwas-grid">'+items+'</div>':'<div class="iwas-empty">Instagramの投稿を準備中です</div>');
    })
    .catch(()=>{mount.innerHTML='<div class="iwas-empty">Instagramを読み込めませんでした</div>'});
})();`;
}
