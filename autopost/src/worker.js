import { adminPage } from './admin-ui.js';
// Independent Instagram AI autoposter. No existing Instagram-to-website code is modified.
// Safe defaults: publishing disabled; café requires verified, owner-provided photos.
const PROFILES = {
  touchcd: {
    label: "タッチCD",
    days: [0, 1, 3, 5],
    hour: 18,
    topics: ["音楽グッズの魅力", "ファンと音楽をつなぐ体験", "アーティスト向けグッズ企画", "ライブの記念品"],
    rules: "NFC搭載のオリジナルCD型キーホルダーについて、インディーズアーティストへ向けた投稿。音楽ページへアクセスできる商品。未確認の価格、納期、販売数、実績や顧客の声を作らない。実物が写っていないAI画像を実物写真と説明しない。"
  },
  ippuku: {
    label: "いっぷく",
    days: [2, 4, 6],
    hour: 12,
    topics: ["落ち着くカフェ時間", "カフェの居心地", "店内の小さな発見", "静かな午後"],
    rules: "北九州市のカフェとして、喫茶店の雰囲気やドリンクを紹介。たばこ、ニコチン、喫煙具、喫煙シーン、銘柄、購入誘導、割引、年齢制限対象商品への誘導は禁止。未確認のメニュー、価格、営業時間、イベント、実店舗の様子を創作しない。"
  }
};
const DAY = 86400000;
const JAPAN_OFFSET = 9 * 3600000;
const GRAPH_BASE = "https://graph.instagram.com/";
const ART_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function japan(ms) {
  const d = new Date(ms + JAPAN_OFFSET);
  return { date: d.toISOString().slice(0, 10), dow: d.getUTCDay(), hour: d.getUTCHours() };
}
function responseJson(data, code = 200) {
  return new Response(JSON.stringify(data), {
    status: code,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
function cleanError(e) {
  return String(e && e.message || e).replace(/access_token=[^\s&]+/gi, "access_token=[REDACTED]").slice(0, 350);
}
function safeEqual(a, b) {
  a = String(a || ""); b = String(b || "");
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function authorized(req, env) {
  const secret = String(env.ADMIN_API_KEY || "");
  return secret.length >= 32 && safeEqual(req.headers.get("Authorization"), "Bearer " + secret);
}
function profileFor(key) {
  if (!Object.prototype.hasOwnProperty.call(PROFILES, key)) throw new Error("Unknown account");
  return PROFILES[key];
}
function imagePublicUrl(env, key) {
  if (!env.PUBLIC_BASE_URL || !String(env.PUBLIC_BASE_URL).startsWith("https://")) throw new Error("PUBLIC_BASE_URL must use HTTPS");
  return String(env.PUBLIC_BASE_URL).replace(/\/$/, "") + "/media/" + key.split("/").map(encodeURIComponent).join("/");
}
function hexBytes(hex) {
  if (!/^[a-f0-9]{64}$/i.test(String(hex || ""))) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  return Uint8Array.from(hex.match(/.{2}/g), x => parseInt(x, 16));
}
async function cryptoKey(env) {
  return crypto.subtle.importKey("raw", hexBytes(env.TOKEN_ENCRYPTION_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}
function b64(bytes) {
  let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s);
}
function unb64(s) {
  return Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
}
async function protect(env, secret) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cryptoKey(env), new TextEncoder().encode(secret));
  return { cipher: b64(new Uint8Array(ciphertext)), nonce: b64(iv) };
}
async function unprotect(env, cipher, nonce) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(nonce) }, await cryptoKey(env), unb64(cipher));
  return new TextDecoder().decode(plain);
}
async function accessToken(env, account) {
  profileFor(account);
  const row = await env.DB.prepare("SELECT * FROM ig_tokens WHERE account = ?").bind(account).first();
  if (row) return unprotect(env, row.cipher, row.nonce);
  const initial = env["IG_TOKEN_" + account.toUpperCase()];
  if (!initial) throw new Error("Instagram token not configured for " + account);
  const sealed = await protect(env, initial);
  await env.DB.prepare("INSERT OR IGNORE INTO ig_tokens (account, cipher, nonce, updated_at) VALUES (?, ?, ?, ?)")
    .bind(account, sealed.cipher, sealed.nonce, Date.now()).run();
  return initial;
}
function igAccountId(env, account) {
  profileFor(account);
  const val = String(env["IG_ACCOUNT_ID_" + account.toUpperCase()] || "");
  if (!/^\d+$/.test(val)) throw new Error("Instagram account ID not configured for " + account);
  return val;
}
async function graph(env, account, method, resource, data = null) {
  const token = await accessToken(env, account);
  const version = String(env.IG_API_VERSION || "v25.0");
  if (!/^v\d+\.\d+$/.test(version)) throw new Error("Invalid Graph API version");
  const url = new URL(GRAPH_BASE + version + "/" + resource.replace(/^\/+/, ""));
  const options = { method, headers: { "Authorization": "Bearer " + token } };
  if (method === "POST") {
    const form = new URLSearchParams();
    for (const [key, value] of Object.entries(data || {})) form.set(key, String(value));
    options.body = form;
  }
  const res = await fetch(url.toString(), options);
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error("Instagram API " + res.status + ": " + (body.error && body.error.message || "request failed"));
  return body;
}
async function refreshTokens(env) {
  for (const account of Object.keys(PROFILES)) {
    try {
      const token = await accessToken(env, account);
      const state = await env.DB.prepare("SELECT updated_at FROM ig_tokens WHERE account = ?").bind(account).first();
      if (!state || Date.now() - Number(state.updated_at) < 27 * DAY) continue;
      const u = new URL("https://graph.instagram.com/refresh_access_token");
      u.searchParams.set("grant_type", "ig_refresh_token");
      u.searchParams.set("access_token", token);
      const res = await fetch(u.toString(), { headers: { "Cache-Control": "no-store" } });
      const result = await res.json();
      if (!res.ok || !result.access_token) throw new Error("Token refresh failed: " + res.status);
      const sealed = await protect(env, result.access_token);
      await env.DB.prepare("UPDATE ig_tokens SET cipher = ?, nonce = ?, updated_at = ? WHERE account = ?")
        .bind(sealed.cipher, sealed.nonce, Date.now(), account).run();
    } catch (e) { console.error("token-refresh", account, cleanError(e)); }
  }
}
async function previousResults(env, account) {
  const rows = await env.DB.prepare(
    "SELECT theme, metrics_json FROM posts WHERE account = ? AND status = 'published' AND metrics_json IS NOT NULL ORDER BY created_at DESC LIMIT 12"
  ).bind(account).all();
  return (rows.results || []).map(r => {
    let metrics = {}; try { metrics = JSON.parse(r.metrics_json || "{}"); } catch (_) {}
    return { theme: r.theme, likes: metrics.like_count || 0, comments: metrics.comments_count || 0, reach: metrics.reach || null };
  }).slice(0, 8);
}
async function planPost(env, account, date) {
  if (!env.AI) throw new Error("Workers AI binding missing");
  const config = profileFor(account);
  const topics = config.topics;
  const topic = topics[(Math.floor(Date.parse(date + "T00:00:00Z") / DAY) + (account === "ippuku" ? 2 : 0)) % topics.length];
  const stats = await previousResults(env, account);
  const messages = [
    { role: "system", content: "あなたは日本語のInstagram編集者。返答はJSONオブジェクトだけ。必須キーは theme, caption, visual_prompt。captionは100〜300字、日本語、自然で読みやすく、誇張や架空の事実なし。ハッシュタグは最大5個。根拠のない実績、価格、セール、営業時間、店内写真、購入者の声、製品仕様を断言しない。競合を調査したふりをしない。visual_promptは抽象的なオリジナルの英語イラスト案で、実在の商品や店内を写実的に再現しない。Markdownなし。" },
    { role: "user", content: "ブランド: " + config.label + "\n運用規則: " + config.rules + "\n今日の企画テーマ: " + topic + "\n過去投稿の測定値（欠損値は無視）: " + JSON.stringify(stats) + "\nDMや予約など架空の窓口を作らない。簡潔な行動呼びかけを含むJSONを生成。" }
  ];
  const out = await env.AI.run(TEXT_MODEL, { messages, max_tokens: 800, temperature: 0.6 });
  const raw = typeof out === "string" ? out : String(out && out.response || "");
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("AI did not return JSON");
  const data = JSON.parse(match[0]);
  if (!data.theme || !data.caption || !data.visual_prompt) throw new Error("AI response missing fields");
  const caption = String(data.caption).slice(0, 1800);
  if (account === "ippuku" && /(たばこ|タバコ|煙草|煙|ニコチン|喫煙|手巻き|紙巻|葉巻|シャグ|ジッポ|zippo|ライター|灰皿|販売|購入|割引|通販|キャンペーン|プレゼント)/i.test(caption)) {
    throw new Error("Café policy guard: sensitive promotional terms");
  }
  return { theme: String(data.theme).slice(0, 100), caption, visual: String(data.visual_prompt).slice(0, 600) };
}
async function chooseImage(env, account, date, visual) {
  const assets = await env.DB.prepare(
    "SELECT id, r2_key FROM assets WHERE account = ? AND approved = 1 ORDER BY COALESCE(last_used_at, 0) ASC, created_at ASC LIMIT 1"
  ).bind(account).all();
  const asset = (assets.results || [])[0];
  if (asset) {
    await env.DB.prepare("UPDATE assets SET last_used_at = ? WHERE id = ?").bind(Date.now(), asset.id).run();
    return { key: asset.r2_key, source: "owner_photo" };
  }
  if (account !== "touchcd" || env.ENABLE_TOUCHCD_CONCEPT_ART !== "true") {
    throw new Error("No approved real photo available; automated publishing blocked");
  }
  const prompt = "Premium editorial abstract music artwork, vinyl and compact disc inspired circular geometry, dark navy and subtle iridescent highlights, flat graphic illustration, no photograph, no real products, no logo, no typography, no people. " + visual;
  const ai = await env.AI.run(ART_MODEL, { prompt: prompt.slice(0, 1900), steps: 4 });
  if (!ai || !ai.image) throw new Error("AI image generation returned no image");
  const bytes = unb64(ai.image);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("AI image too large");
  const key = "art/" + account + "/" + date + ".jpg";
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
  return { key, source: "ai_concept" };
}
async function createDraft(env, account, localDate) {
  const config = profileFor(account);
  const id = crypto.randomUUID();
  const now = Date.now();
  const plannedAt = Date.parse(localDate + "T00:00:00Z") - JAPAN_OFFSET + config.hour * 3600000;
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO posts (id, account, local_date, status, publish_after, created_at, updated_at) VALUES (?, ?, ?, 'planning', ?, ?, ?)"
  ).bind(id, account, localDate, plannedAt, now, now).run();
  if (!(inserted.meta && inserted.meta.changes)) return;
  try {
    const plan = await planPost(env, account, localDate);
    const image = await chooseImage(env, account, localDate, plan.visual);
    const isConcept = image.source === "ai_concept";
    const caption = plan.caption + (isConcept ? "\n\n※画像はイメージイラストです。" : "");
    const canAutoApprove = (account === "touchcd" && env.AUTO_APPROVE_TOUCHCD === "true") || (account === "ippuku" && env.AUTO_APPROVE_IPPUKU === "true" && image.source === "owner_photo");
    const status = canAutoApprove ? "approved" : "draft";
    await env.DB.prepare(
      "UPDATE posts SET status=?, theme=?, caption=?, image_key=?, image_source=?, error_text=NULL, updated_at=? WHERE id=?"
    ).bind(status, plan.theme, caption, image.key, image.source, Date.now(), id).run();
  } catch (e) {
    const reason = cleanError(e);
    const status = /No approved real photo/.test(reason) ? "blocked_assets" : /policy guard/.test(reason) ? "blocked_policy" : "failed_generation";
    await env.DB.prepare("UPDATE posts SET status = ?, error_text = ?, updated_at = ? WHERE id = ?")
      .bind(status, reason, Date.now(), id).run();
    console.error("draft", account, reason);
  }
}
async function isPaused(env) {
  const row = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'paused'").first();
  return !row || row.value !== '0';
}
async function startPublishing(env) {
  if (env.PUBLISH_ENABLED !== "true" || await isPaused(env)) return;
  const rows = await env.DB.prepare(
    "SELECT * FROM posts WHERE status = 'approved' AND publish_after <= ? ORDER BY publish_after ASC LIMIT 2"
  ).bind(Date.now()).all();
  for (const post of rows.results || []) {
    const claim = await env.DB.prepare("UPDATE posts SET status = 'creating_container', updated_at = ? WHERE id = ? AND status = 'approved'")
      .bind(Date.now(), post.id).run();
    if (!claim.meta || claim.meta.changes !== 1) continue;
    try {
      const id = igAccountId(env, post.account);
      const media = await graph(env, post.account, "POST", id + "/media", {
        image_url: imagePublicUrl(env, post.image_key), caption: post.caption
      });
      if (!media.id) throw new Error("No container returned");
      await env.DB.prepare(
        "UPDATE posts SET status = 'processing', container_id = ?, error_text=NULL, updated_at=? WHERE id=?"
      ).bind(String(media.id), Date.now(), post.id).run();
    } catch (e) {
      // API ambiguity: never silently retry creating a container.
      await env.DB.prepare("UPDATE posts SET status = 'container_unknown', error_text=?, updated_at=? WHERE id=?")
        .bind(cleanError(e), Date.now(), post.id).run();
    }
  }
}
async function finishPublishing(env) {
  if (env.PUBLISH_ENABLED !== "true" || await isPaused(env)) return;
  const rows = await env.DB.prepare(
    "SELECT * FROM posts WHERE status = 'processing' ORDER BY updated_at ASC LIMIT 3"
  ).all();
  for (const post of rows.results || []) {
    try {
      const status = await graph(env, post.account, "GET", post.container_id + "?fields=status_code,status");
      if (status.status_code === "ERROR" || status.status_code === "EXPIRED") {
        await env.DB.prepare("UPDATE posts SET status = 'failed_processing', error_text=?, updated_at=? WHERE id=?")
          .bind(String(status.status || status.status_code).slice(0, 350), Date.now(), post.id).run();
        continue;
      }
      if (status.status_code !== "FINISHED") continue;
      const claim = await env.DB.prepare(
        "UPDATE posts SET status='publishing', updated_at=? WHERE id=? AND status='processing'"
      ).bind(Date.now(), post.id).run();
      if (!claim.meta || claim.meta.changes !== 1) continue;
      let result;
      try {
        result = await graph(env, post.account, "POST", igAccountId(env, post.account) + "/media_publish", { creation_id: post.container_id });
      } catch (e) {
        // Meta may have published although the response was lost. Pause for human reconciliation.
        await env.DB.prepare("UPDATE posts SET status='publish_unknown', error_text=?, updated_at=? WHERE id=?")
          .bind(cleanError(e), Date.now(), post.id).run();
        continue;
      }
      if (!result.id) throw new Error("Publish response missing media ID");
      await env.DB.prepare(
        "UPDATE posts SET status='published', instagram_media_id=?, error_text=NULL, updated_at=? WHERE id=?"
      ).bind(String(result.id), Date.now(), post.id).run();
    } catch (e) { console.error("finish-publish", post.account, cleanError(e)); }
  }
}
async function updateMetrics(env) {
  for (const account of Object.keys(PROFILES)) {
    const rows = await env.DB.prepare(
      "SELECT id, instagram_media_id FROM posts WHERE status='published' AND account=? AND (metrics_at IS NULL OR metrics_at < ?) ORDER BY COALESCE(metrics_at,0) ASC LIMIT 4"
    ).bind(account, Date.now() - DAY).all();
    for (const post of rows.results || []) {
      try {
        const media = await graph(env, account, "GET", post.instagram_media_id + "?fields=like_count,comments_count,permalink");
        const metrics = { like_count: media.like_count || 0, comments_count: media.comments_count || 0, permalink: media.permalink || null };
        try {
          const insights = await graph(env, account, "GET", post.instagram_media_id + "/insights?metric=reach,saved,shares");
          for (const item of insights.data || []) metrics[item.name] = item.values ? item.values[0]?.value : item.total_value?.value;
        } catch (_) { /* Insights permission may be unavailable. Keep public counters. */ }
        await env.DB.prepare("UPDATE posts SET metrics_json=?, metrics_at=?, updated_at=? WHERE id=?")
          .bind(JSON.stringify(metrics), Date.now(), Date.now(), post.id).run();
      } catch (e) { console.error("metrics", account, cleanError(e)); }
    }
  }
}
async function adminRequest(req, env, path) {
  if (!authorized(req, env)) return responseJson({ error: "Unauthorized" }, 401);
  if (path === "/api/admin/status" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT account, status, COUNT(*) count FROM posts GROUP BY account,status").all();
    return responseJson({
      publishing_enabled: env.PUBLISH_ENABLED === "true",
      paused: await isPaused(env),
      touchcd: { account_id_configured: !!env.IG_ACCOUNT_ID_TOUCHCD, token_configured: !!env.IG_TOKEN_TOUCHCD, art_enabled: env.ENABLE_TOUCHCD_CONCEPT_ART === "true", auto_approve: env.AUTO_APPROVE_TOUCHCD === "true" },
      ippuku: { account_id_configured: !!env.IG_ACCOUNT_ID_IPPUKU, token_configured: !!env.IG_TOKEN_IPPUKU, real_photos_only: true, auto_approve: env.AUTO_APPROVE_IPPUKU === 'true' },
      post_counts: rows.results || []
    });
  }
  if (path === '/api/admin/pause' && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    if (typeof body.paused !== 'boolean') return responseJson({ error: 'paused must be boolean' }, 400);
    await env.DB.prepare("INSERT INTO app_settings (key,value,updated_at) VALUES ('paused',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at")
      .bind(body.paused ? '1' : '0', Date.now()).run();
    return responseJson({ paused: body.paused });
  }
  if (path === "/api/admin/posts" && req.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT id,account,local_date,status,theme,caption,image_key,image_source,publish_after,instagram_media_id,error_text,metrics_json,created_at FROM posts ORDER BY created_at DESC LIMIT 80"
    ).all();
    return responseJson({ posts: (rows.results || []).map(p => ({ ...p, image_url: p.image_key ? imagePublicUrl(env, p.image_key) : null })) });
  }
  const action = path.match(/^\/api\/admin\/posts\/([0-9a-f-]+)\/(approve|reject)$/);
  if (action && req.method === "POST") {
    const status = action[2] === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare(
      "UPDATE posts SET status=?, updated_at=? WHERE id=? AND status='draft'"
    ).bind(status, Date.now(), action[1]).run();
    return responseJson({ updated: !!(result.meta && result.meta.changes) });
  }
  if (path === "/api/admin/assets" && req.method === "GET") {
    const rows = await env.DB.prepare("SELECT id,account,r2_key,approved,created_at,last_used_at FROM assets ORDER BY created_at DESC LIMIT 100").all();
    return responseJson({ assets: (rows.results || []).map(a => ({ ...a, url: imagePublicUrl(env, a.r2_key) })) });
  }
  if (path === "/api/admin/assets" && req.method === "POST") {
    const url = new URL(req.url);
    const account = url.searchParams.get("account");
    profileFor(account);
    const type = req.headers.get("Content-Type") || "";
    if (!/^image\/jpeg(?:;|$)/i.test(type)) return responseJson({ error: "JPEG images only" }, 415);
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > 5 * 1024 * 1024) return responseJson({ error: "Image must be 1 B to 5 MB" }, 413);
    const bytes = new Uint8Array(buf);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return responseJson({ error: "Invalid JPEG signature" }, 415);
    const id = crypto.randomUUID();
    const key = "assets/" + account + "/" + id + ".jpg";
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "image/jpeg" } });
    await env.DB.prepare(
      "INSERT INTO assets (id,account,r2_key,approved,created_at) VALUES (?,?,?,?,?)"
    ).bind(id, account, key, 1, Date.now()).run();
    return responseJson({ id, account, url: imagePublicUrl(env, key) }, 201);
  }
  return responseJson({ error: "Not found" }, 404);
}
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/admin' && req.method === 'GET') return adminPage();
    if (url.pathname === "/health" && req.method === "GET") {
      return responseJson({ ok: true, service: "two-account-instagram-ai-autoposter", live: env.PUBLISH_ENABLED === "true" });
    }
    if (url.pathname.startsWith("/media/") && req.method === "GET") {
      const key = url.pathname.slice("/media/".length);
      if (!/^(art|assets)\/[a-z0-9-]+\/[a-z0-9-]+\.jpg$/i.test(key)) return new Response("Not found", { status: 404 });
      const object = await env.MEDIA.get(key);
      if (!object) return new Response("Not found", { status: 404 });
      return new Response(object.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public,max-age=86400", "X-Content-Type-Options": "nosniff" } });
    }
    if (url.pathname.startsWith("/api/admin/")) {
      try { return await adminRequest(req, env, url.pathname); }
      catch (e) { return responseJson({ error: cleanError(e) }, 400); }
    }
    return responseJson({ error: "Not found" }, 404);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil((async () => {
      if (!env.DB || !env.MEDIA || !env.AI) { console.error("Missing DB, MEDIA or AI binding"); return; }
      const current = japan(Date.now());
      if (current.hour === 10) {
        for (const account of Object.keys(PROFILES)) {
          if (PROFILES[account].days.includes(current.dow)) await createDraft(env, account, current.date);
        }
      }
      await finishPublishing(env);
      await startPublishing(env);
      if (current.hour === 3) await updateMetrics(env);
      if (current.hour === 4) await refreshTokens(env);
    })());
  }
};
