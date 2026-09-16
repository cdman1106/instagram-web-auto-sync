export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

export function shell(title, body) {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>${escapeHtml(title)}</title>
  <style>
    :root{--ink:#142033;--muted:#687386;--accent:#405de6;--bg:#f4f6fb;--line:#e2e7ef;--ok:#176b3a}
    *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Segoe UI",sans-serif;min-height:100vh;display:grid;place-items:center;padding:22px}
    main{width:min(100%,560px);background:#fff;border:1px solid var(--line);border-radius:24px;padding:30px 24px;box-shadow:0 18px 70px rgba(20,32,51,.10)}
    .badge{display:inline-flex;padding:7px 11px;border-radius:999px;background:#edf0ff;color:#3349bf;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px}
    h1{margin:0 0 12px;font-size:26px;line-height:1.45}.lead{color:var(--muted);line-height:1.8}.info{margin:20px 0;padding:16px;border-radius:16px;background:#f7f8fb;border:1px solid var(--line);line-height:1.75}.info p{margin:7px 0 0;color:var(--muted)}
    .button{display:block;text-align:center;text-decoration:none;background:linear-gradient(135deg,#405de6,#833ab4,#e1306c);color:#fff;padding:16px 18px;border-radius:14px;font-weight:800;margin-top:20px}.success{padding:14px 16px;border-radius:14px;background:#edf9f1;color:var(--ok);font-weight:800;margin:16px 0}.fine{font-size:12px;color:#7b8491;line-height:1.7;margin:16px 0 0;text-align:center}
  </style>
</head>
<body><main>${body}</main></body>
</html>`;
}

export function simplePage(title, text) {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(text)}</p>`);
}

export function customerConnectPage(site) {
  const connected = Boolean(site.ig_user_id);
  const body = `
    <div class="badge">Instagram Auto Sync</div>
    <h1>${escapeHtml(site.name)}</h1>
    <p class="lead">ホームページにInstagramの最新投稿を自動表示するための連携です。</p>
    ${connected ? `<div class="success">✓ @${escapeHtml(site.ig_username || "Instagram")} と接続済みです</div>` : ""}
    <div class="info">
      <strong>店主さまがすることは1つだけです。</strong>
      <p>下のボタンを押し、Meta / Instagram公式画面で対象のInstagramアカウントを選んで「許可」してください。</p>
    </div>
    <a class="button" href="/oauth/start/${encodeURIComponent(site.connect_token)}">${connected ? "Instagramを再接続する" : "Instagramと接続する"}</a>
    <p class="fine">Instagramのパスワードを制作会社へ伝える必要はありません。パスワードはこのサービスにも保存されません。</p>
  `;
  return shell(`${site.name} Instagram連携`, body);
}

export function oauthSuccessPage(username) {
  const body = `
    <div class="badge">CONNECTED</div>
    <h1>Instagram連携が完了しました</h1>
    <div class="success">✓ @${escapeHtml(username || "Instagram")} と正常に接続しました</div>
    <p class="lead">今後はいつも通りInstagramを更新するだけで、ホームページ側にも自動反映されます。</p>
    <p class="fine">この画面は閉じて大丈夫です。</p>
  `;
  return shell("Instagram連携完了", body);
}

export function adminPage() {
  return String.raw`<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Instagram Web Auto Sync</title>
  <style>
    :root{--bg:#0f1420;--panel:#171e2c;--panel2:#1e2737;--text:#f7f9fc;--muted:#9ca9bd;--line:#2c3748;--accent:#6d7cff;--ok:#55d98b;--bad:#ff6f7d}
    *{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#0d121c,#121827 55%,#0d121c);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Noto Sans JP","Segoe UI",sans-serif;min-height:100vh}.wrap{width:min(1180px,calc(100% - 28px));margin:0 auto;padding:28px 0 70px}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}h1{font-size:24px;margin:0}.sub{color:var(--muted);font-size:13px;margin-top:6px}.grid{display:grid;grid-template-columns:360px 1fr;gap:18px}@media(max-width:850px){.grid{grid-template-columns:1fr}}
    .card{background:rgba(23,30,44,.96);border:1px solid var(--line);border-radius:20px;padding:20px;box-shadow:0 20px 70px rgba(0,0,0,.18)}label{display:block;font-size:12px;color:var(--muted);font-weight:700;margin:14px 0 7px}input{width:100%;border:1px solid var(--line);background:#0f1623;color:#fff;border-radius:12px;padding:13px 14px;font-size:15px;outline:none}input:focus{border-color:var(--accent)}
    .checks{display:flex;gap:12px;flex-wrap:wrap;margin:14px 0}.checks label{margin:0;color:#dce3ee;display:flex;align-items:center;gap:7px}.checks input{width:auto}.btn{border:0;border-radius:12px;padding:12px 15px;font-weight:800;cursor:pointer;background:var(--accent);color:#fff}.btn.secondary{background:#263248}.btn.danger{background:#40202a;color:#ffacb4}.btn.small{padding:9px 11px;font-size:12px}.actions{display:flex;gap:8px;flex-wrap:wrap}
    .login{width:min(430px,calc(100% - 30px));margin:14vh auto 0}.hidden{display:none!important}.sites{display:grid;gap:12px}.site{border:1px solid var(--line);background:var(--panel2);border-radius:16px;padding:16px}.siteTop{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.site h3{margin:0 0 5px;font-size:17px}.url{color:var(--muted);font-size:12px;word-break:break-all}.status{font-size:11px;font-weight:800;border-radius:999px;padding:6px 9px;white-space:nowrap}.status.ok{background:#173725;color:var(--ok)}.status.off{background:#382a1e;color:#ffc17a}.err{color:#ff909b;font-size:12px;margin-top:8px;word-break:break-word}.code{margin-top:12px;background:#101722;border:1px solid #293447;border-radius:12px;padding:11px;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#cbd5e5;white-space:pre-wrap;word-break:break-all}.row{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}.msg{font-size:13px;color:var(--muted);min-height:18px;margin-top:10px}.empty{color:var(--muted);text-align:center;padding:42px 12px}
  </style>
</head>
<body>
  <section id="login" class="login card">
    <h1>Instagram Web Auto Sync</h1>
    <p class="sub">管理者ログイン</p>
    <label>管理パスワード</label>
    <input id="password" type="password" autocomplete="current-password" placeholder="••••••••">
    <div class="row"><button class="btn" id="loginBtn">ログイン</button></div>
    <div class="msg" id="loginMsg"></div>
  </section>

  <div id="app" class="wrap hidden">
    <header><div><h1>Instagram Web Auto Sync</h1><div class="sub">店舗URLを登録 → 接続URLを店主へ送る → 埋め込みコードをHPへ貼る</div></div><button class="btn secondary small" id="logoutBtn">ログアウト</button></header>
    <div class="grid">
      <section class="card">
        <h2 style="margin:0;font-size:18px">新しいサイトを追加</h2>
        <label>店舗名・サイト名</label><input id="siteName" placeholder="例：○○カフェ">
        <label>ホームページURL</label><input id="siteUrl" type="url" placeholder="https://example.com">
        <label>表示件数</label><input id="postLimit" type="number" min="1" max="24" value="9">
        <div class="checks"><label><input id="showPosts" type="checkbox" checked>投稿</label><label><input id="showReels" type="checkbox" checked>Reels</label><label><input id="showStories" type="checkbox">Stories</label></div>
        <button class="btn" id="addBtn">サイトを追加</button><div class="msg" id="addMsg"></div>
      </section>
      <section class="card"><h2 style="margin:0 0 14px;font-size:18px">登録サイト</h2><div id="sites" class="sites"><div class="empty">読み込み中...</div></div></section>
    </div>
  </div>

<script>
var q=function(s){return document.querySelector(s)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]})};
async function api(path,opt){opt=opt||{};var headers=Object.assign({'Content-Type':'application/json'},opt.headers||{});var r=await fetch(path,Object.assign({credentials:'same-origin',headers:headers},opt));var d=await r.json().catch(function(){return {}});if(!r.ok){var e=new Error(d.error||'Request failed');e.status=r.status;throw e}return d}
function showApp(){q('#login').classList.add('hidden');q('#app').classList.remove('hidden')}
function showLogin(){q('#app').classList.add('hidden');q('#login').classList.remove('hidden')}
async function load(){try{var d=await api('/api/admin/sites');showApp();render(d.sites||[])}catch(e){if(e.status===401)showLogin();else q('#loginMsg').textContent=e.message}}
function render(sites){var root=q('#sites');if(!sites.length){root.innerHTML='<div class="empty">まだサイトがありません</div>';return}root.innerHTML=sites.map(function(s){var h='<article class="site"><div class="siteTop"><div><h3>'+esc(s.name)+'</h3><div class="url">'+esc(s.website_url)+'</div></div><span class="status '+(s.connected?'ok':'off')+'">'+(s.connected?'接続済み':'未接続')+'</span></div>';if(s.ig_username)h+='<div class="sub" style="margin-top:8px">Instagram: @'+esc(s.ig_username)+'</div>';if(s.sync_error)h+='<div class="err">同期エラー: '+esc(s.sync_error)+'</div>';h+='<div class="row"><button class="btn small" data-copy="'+esc(s.connect_url)+'">接続URLをコピー</button><button class="btn secondary small" data-code="'+encodeURIComponent(s.embed_code)+'">埋め込みコードをコピー</button>';if(s.connected)h+='<button class="btn secondary small" data-sync="'+esc(s.id)+'">今すぐ同期</button>';h+='<button class="btn danger small" data-del="'+esc(s.id)+'">削除</button></div><div class="code">'+esc(s.embed_code)+'</div></article>';return h}).join('')}
q('#loginBtn').onclick=async function(){try{q('#loginMsg').textContent='';await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:q('#password').value})});q('#password').value='';await load()}catch(e){q('#loginMsg').textContent=e.message}};
q('#password').addEventListener('keydown',function(e){if(e.key==='Enter')q('#loginBtn').click()});
q('#logoutBtn').onclick=async function(){await api('/api/admin/logout',{method:'POST'}).catch(function(){});showLogin()};
q('#addBtn').onclick=async function(){try{q('#addMsg').textContent='登録中...';await api('/api/admin/sites',{method:'POST',body:JSON.stringify({name:q('#siteName').value,website_url:q('#siteUrl').value,post_limit:Number(q('#postLimit').value||9),show_posts:q('#showPosts').checked,show_reels:q('#showReels').checked,show_stories:q('#showStories').checked})});q('#siteName').value='';q('#siteUrl').value='';q('#addMsg').textContent='追加しました';await load()}catch(e){q('#addMsg').textContent=e.message}};
document.addEventListener('click',async function(e){var t=e.target;if(t.dataset.copy){await navigator.clipboard.writeText(t.dataset.copy);var old=t.textContent;t.textContent='コピー済み';setTimeout(function(){t.textContent=old},1200)}if(t.dataset.code){await navigator.clipboard.writeText(decodeURIComponent(t.dataset.code));var old2=t.textContent;t.textContent='コピー済み';setTimeout(function(){t.textContent=old2},1200)}if(t.dataset.sync){t.textContent='同期中...';try{await api('/api/admin/sites/'+t.dataset.sync+'/sync',{method:'POST'});await load()}catch(err){alert(err.message)}}if(t.dataset.del&&confirm('このサイトを削除しますか？')){await api('/api/admin/sites/'+t.dataset.del,{method:'DELETE'});await load()}});
load();
</script>
</body>
</html>`;
}
