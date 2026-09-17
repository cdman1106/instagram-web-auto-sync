import baseWorker from "./worker.js";

const DAY = 24 * 60 * 60;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/admin" && request.method === "GET") {
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response || !response.ok) return response;
      const type = response.headers.get("content-type") || "";
      if (!type.includes("text/html")) return response;
      const text = await response.text();
      const injected = text.replace(
        "</body>",
        '<script src="/admin-enhancements.js" defer></script></body>',
      );
      const headers = new Headers(response.headers);
      headers.delete("content-length");
      return new Response(injected, { status: response.status, headers });
    }

    if (url.pathname === "/admin-enhancements.js" && request.method === "GET") {
      return new Response(adminEnhancementsScript(), {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const disconnectMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)\/disconnect$/);
    if (disconnectMatch && request.method === "POST") {
      await requireAdmin(request, env);
      return disconnectSite(disconnectMatch[1], env);
    }

    return baseWorker.fetch(request, env, ctx);
  },

  async scheduled(event, env, ctx) {
    return baseWorker.scheduled(event, env, ctx);
  },
};

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return bytesToBase64Url(new Uint8Array(sig));
}

function timingSafeEqual(a, b) {
  a = String(a ?? "");
  b = String(b ?? "");
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function base64UrlToText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function verifyAdminSession(token, env) {
  if (!token || !env.ADMIN_SESSION_SECRET) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const expected = await hmac(env.ADMIN_SESSION_SECRET, payload);
  if (!timingSafeEqual(signature, expected)) return false;
  try {
    const parsed = JSON.parse(base64UrlToText(payload));
    return Number(parsed.exp || 0) > nowSec();
  } catch {
    return false;
  }
}

async function requireAdmin(request, env) {
  const token = cookieValue(request, "iwas_admin");
  if (!(await verifyAdminSession(token, env))) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

async function disconnectSite(siteId, env) {
  const site = await env.DB.prepare("SELECT id FROM sites WHERE id = ?").bind(siteId).first();
  if (!site) return json({ error: "Site not found" }, 404);

  await env.DB.prepare("DELETE FROM oauth_states WHERE site_id = ?").bind(siteId).run();
  await env.DB.prepare(`
    UPDATE sites
       SET ig_user_id = NULL,
           ig_username = NULL,
           ig_account_type = NULL,
           access_token_enc = NULL,
           token_expires_at = NULL,
           token_refreshed_at = NULL,
           feed_json = NULL,
           last_sync_at = NULL,
           sync_error = NULL,
           updated_at = ?
     WHERE id = ?
  `).bind(nowSec(), siteId).run();

  return json({ ok: true });
}

function adminEnhancementsScript() {
  return String.raw`(()=>{
    const $=(s,r=document)=>r.querySelector(s);
    const fmt=(v)=>{
      if(!v)return '未同期';
      const d=new Date(Number(v)*1000);
      return new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(d);
    };
    const copy=async(text,btn)=>{
      await navigator.clipboard.writeText(text);
      const old=btn.textContent;
      btn.textContent='コピー済み';
      setTimeout(()=>btn.textContent=old,1200);
    };
    const codeFor=(s,style)=>'<div data-instagram-auto-sync></div>\n<script src="'+location.origin+'/embed.js" data-site="'+s.id+'" data-style="'+style+'" defer><\/script>';
    const api=async(path,opt={})=>{
      const r=await fetch(path,Object.assign({credentials:'same-origin',headers:{'Content-Type':'application/json'}},opt));
      const d=await r.json().catch(()=>({}));
      if(!r.ok)throw new Error(d.error||'Request failed');
      return d;
    };
    async function enhance(){
      const root=$('#sites');
      if(!root||root.classList.contains('iwas-enhancing'))return;
      root.classList.add('iwas-enhancing');
      try{
        const d=await api('/api/admin/sites');
        for(const s of d.sites||[]){
          const del=root.querySelector('[data-del="'+CSS.escape(s.id)+'"]');
          if(!del)continue;
          const card=del.closest('.site');
          if(!card||card.dataset.enhanced==='1')continue;
          card.dataset.enhanced='1';

          const top=card.querySelector('.siteTop');
          if(top){
            const status=top.querySelector('.status');
            if(status){
              if(s.sync_error){status.textContent='要確認';status.classList.remove('ok','off');status.style.background='#4a2329';status.style.color='#ff9ca6'}
              else if(s.connected){status.textContent='正常接続'}
            }
          }

          const info=document.createElement('div');
          info.style.cssText='margin-top:10px;padding:10px 12px;border:1px solid #2c3748;border-radius:12px;background:#121a27;font-size:12px;line-height:1.75;color:#c8d1df';
          info.innerHTML='<div><b>Instagram:</b> '+(s.ig_username?'@'+s.ig_username:'未接続')+'</div><div><b>最終同期:</b> '+fmt(s.last_sync_at)+'</div>'+(s.sync_error?'<div style="color:#ff9ca6"><b>エラー:</b> '+String(s.sync_error).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))+'</div>':'<div style="color:#55d98b"><b>状態:</b> 問題なし</div>');
          const row=card.querySelector('.row');
          card.insertBefore(info,row);

          const design=document.createElement('div');
          design.style.cssText='margin-top:12px';
          design.innerHTML='<div style="font-size:11px;color:#9ca9bd;margin-bottom:7px;font-weight:800">埋め込みデザイン</div><div class="actions"><button class="btn secondary small" data-stylecopy="grid">標準グリッド</button><button class="btn secondary small" data-stylecopy="minimal">ミニマル</button><button class="btn secondary small" data-stylecopy="carousel">横スクロール</button></div>';
          card.insertBefore(design,card.querySelector('.code'));
          design.querySelectorAll('[data-stylecopy]').forEach(b=>b.addEventListener('click',()=>copy(codeFor(s,b.dataset.stylecopy),b)));

          const open=document.createElement('button');
          open.className='btn secondary small';
          open.textContent=s.connected?'再接続ページを開く':'接続ページを開く';
          open.onclick=()=>window.open(s.connect_url,'_blank','noopener');
          row.insertBefore(open,del);

          if(s.connected){
            const disconnect=document.createElement('button');
            disconnect.className='btn danger small';
            disconnect.textContent='接続解除';
            disconnect.onclick=async()=>{
              if(!confirm('@'+(s.ig_username||'Instagram')+' の接続を解除しますか？\nホームページのInstagram表示も停止します。'))return;
              disconnect.disabled=true;
              disconnect.textContent='解除中...';
              try{await api('/api/admin/sites/'+s.id+'/disconnect',{method:'POST'});location.reload()}catch(e){alert(e.message);disconnect.disabled=false;disconnect.textContent='接続解除'}
            };
            row.insertBefore(disconnect,del);
          }
        }
      }catch(e){}finally{root.classList.remove('iwas-enhancing')}
    }
    const observer=new MutationObserver(()=>setTimeout(enhance,50));
    const start=()=>{const root=$('#sites');if(root){observer.observe(root,{childList:true,subtree:true});enhance();setInterval(enhance,30000)}else setTimeout(start,100)};
    start();
  })();`;
}
