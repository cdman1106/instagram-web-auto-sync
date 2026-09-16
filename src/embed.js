export function embedScriptBody(apiOrigin) {
  const origin = JSON.stringify(apiOrigin);
  return `(()=>{
  const script=document.currentScript;
  if(!script)return;
  const site=script.dataset.site;
  if(!site)return;
  const mount=script.previousElementSibling&&script.previousElementSibling.hasAttribute('data-instagram-auto-sync')
    ? script.previousElementSibling
    : (()=>{const d=document.createElement('div');d.setAttribute('data-instagram-auto-sync','');script.parentNode.insertBefore(d,script);return d})();
  const origin=${origin};
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  if(!document.getElementById('iwas-style')){
    const st=document.createElement('style');
    st.id='iwas-style';
    st.textContent='[data-instagram-auto-sync]{--iwas-gap:10px;font-family:inherit}.iwas-stories{display:flex;gap:10px;overflow:auto;padding:3px 0 12px}.iwas-story{width:70px;flex:0 0 70px;text-decoration:none;color:inherit}.iwas-story img,.iwas-story video{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #fff;outline:2px solid #d14f8f}.iwas-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--iwas-gap)}.iwas-item{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:#eee}.iwas-item img,.iwas-item video{width:100%;height:100%;object-fit:cover;display:block}.iwas-play{position:absolute;right:8px;bottom:8px;background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:5px 8px;font:700 11px/1 sans-serif}.iwas-empty{padding:18px;color:#777;text-align:center;font-size:13px}@media(max-width:520px){.iwas-grid{gap:6px}.iwas-item{border-radius:5px}}';
    document.head.appendChild(st);
  }
  const mediaHtml=(m,isReel)=>{
    const src=esc(m.thumbnail_url||m.media_url||'');
    const href=esc(m.permalink||'#');
    if(!src)return '';
    return '<a class="iwas-item" href="'+href+'" target="_blank" rel="noopener noreferrer"><img src="'+src+'" loading="lazy" alt="Instagram投稿">'+(isReel?'<span class="iwas-play">▶ Reel</span>':'')+'</a>';
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
