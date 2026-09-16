const TEN_MINUTES = 10 * 60;
const DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * DAY;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") {
        return json({ ok: true, service: "instagram-web-auto-sync" });
      }

      if (url.pathname === "/") {
        return Response.redirect(`${url.origin}/admin`, 302);
      }

      if (url.pathname === "/admin" && request.method === "GET") {
        return html(adminPage());
      }

      if (url.pathname === "/api/admin/login" && request.method === "POST") {
        return adminLogin(request, env);
      }

      if (url.pathname === "/api/admin/logout" && request.method === "POST") {
        return adminLogout();
      }

      if (url.pathname === "/api/admin/sites" && request.method === "GET") {
        await requireAdmin(request, env);
        return listSites(env);
      }

      if (url.pathname === "/api/admin/sites" && request.method === "POST") {
        await requireAdmin(request, env);
        return createSite(request, env);
      }

      const siteSyncMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)\/sync$/);
      if (siteSyncMatch && request.method === "POST") {
        await requireAdmin(request, env);
        return manualSync(siteSyncMatch[1], env);
      }

      const siteDeleteMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)$/);
      if (siteDeleteMatch && request.method === "DELETE") {
        await requireAdmin(request, env);
        return deleteSite(siteDeleteMatch[1], env);
      }

      const connectMatch = url.pathname.match(/^\/connect\/([^/]+)$/);
      if (connectMatch && request.method === "GET") {
        return connectPage(connectMatch[1], env);
      }

      const oauthStartMatch = url.pathname.match(/^\/oauth\/start\/([^/]+)$/);
      if (oauthStartMatch && request.method === "GET") {
        return startOAuth(oauthStartMatch[1], env);
      }

      if (url.pathname === "/oauth/callback" && request.method === "GET") {
        return oauthCallback(request, env);
      }

      const feedMatch = url.pathname.match(/^\/api\/feed\/([^/]+)$/);
      if (feedMatch && (request.method === "GET" || request.method === "OPTIONS")) {
        return publicFeed(request, feedMatch[1], env);
      }

      if (url.pathname === "/embed.js" && request.method === "GET") {
        return embedScript(url.origin);
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("request error", safeError(err));
      if (err instanceof HttpError) {
        return json({ error: err.message }, err.status);
      }
      return json({ error: "Internal Server Error" }, 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(syncConnectedSites(env));
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function safeError(err) {
  return { name: err?.name, message: err?.message };
}

function publicBaseUrl(env, fallback = "") {
  return String(env.PUBLIC_BASE_URL || fallback).replace(/\/$/, "");
}

function graphBase(env) {
  const version = String(env.IG_API_VERSION || "v25.0").replace(/^\/+|\/+$/g, "");
  return `https://graph.instagram.com/${version}`;
}

function assertEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON");
  }
}

function normalizeWebsiteUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new HttpError(400, "ホームページURLが正しくありません");
  }
  if (!/^https?:$/.test(url.protocol)) throw new HttpError(400, "URLはhttpまたはhttpsで入力してください");
  return {
    websiteUrl: url.toString().replace(/\/$/, ""),
    allowedOrigin: url.origin,
  };
}

function randomToken(bytes = 24) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[ch]));
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function js(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
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

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function textToBase64Url(text) {
  return bytesToBase64Url(new TextEncoder().encode(text));
}

function base64UrlToText(value) {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function makeAdminSession(env) {
  assertEnv(env, ["ADMIN_SESSION_SECRET"]);
  const payload = textToBase64Url(JSON.stringify({ exp: nowSec() + 7 * DAY }));
  const sig = await hmac(env.ADMIN_SESSION_SECRET, payload);
  return `${payload}.${sig}`;
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

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function cookieValue(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  for (const part of cookie.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

async function requireAdmin(request, env) {
  const token = cookieValue(request, "iwas_admin");
  if (!(await verifyAdminSession(token, env))) throw new HttpError(401, "Unauthorized");
}

async function adminLogin(request, env) {
  assertEnv(env, ["ADMIN_PASSWORD", "ADMIN_SESSION_SECRET"]);
  const body = await readJson(request);
  if (!timingSafeEqual(String(body.password || ""), String(env.ADMIN_PASSWORD))) {
    return json({ error: "パスワードが違います" }, 401);
  }
  const session = await makeAdminSession(env);
  return json({ ok: true }, 200, {
    "Set-Cookie": `iwas_admin=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${7 * DAY}`,
  });
}

function adminLogout() {
  return json({ ok: true }, 200, {
    "Set-Cookie": "iwas_admin=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
  });
}

async function listSites(env) {
  const { results = [] } = await env.DB.prepare(`
    SELECT id, name, website_url, allowed_origin, connect_token,
           ig_user_id, ig_username, ig_account_type,
           last_sync_at, sync_error, show_posts, show_reels, show_stories,
           post_limit, created_at, updated_at
    FROM sites
    ORDER BY created_at DESC
  `).all();

  const base = publicBaseUrl(env);
  return json({
    sites: results.map((site) => ({
      ...site,
      connected: Boolean(site.ig_user_id),
      connect_url: `${base}/connect/${site.connect_token}`,
      embed_code: `<div data-instagram-auto-sync></div>\n<script src="${base}/embed.js" data-site="${site.id}" defer></script>`,
    })),
  });
}

async function createSite(request, env) {
  const body = await readJson(request);
  const name = String(body.name || "").trim();
  if (!name) throw new HttpError(400, "店舗名・サイト名を入力してください");

  const { websiteUrl, allowedOrigin } = normalizeWebsiteUrl(body.website_url);
  const id = crypto.randomUUID();
  const connectToken = randomToken(24);
  const now = nowSec();
  const postLimit = Math.min(24, Math.max(1, Number(body.post_limit || 9)));

  await env.DB.prepare(`
    INSERT INTO sites (
      id, name, website_url, allowed_origin, connect_token,
      show_posts, show_reels, show_stories, post_limit,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    name,
    websiteUrl,
    allowedOrigin,
    connectToken,
    body.show_posts === false ? 0 : 1,
    body.show_reels === false ? 0 : 1,
    body.show_stories ? 1 : 0,
    postLimit,
    now,
    now,
  ).run();

  const base = publicBaseUrl(env, new URL(request.url).origin);
  return json({
    ok: true,
    site: {
      id,
      name,
      website_url: websiteUrl,
      connect_url: `${base}/connect/${connectToken}`,
      embed_code: `<div data-instagram-auto-sync></div>\n<script src="${base}/embed.js" data-site="${id}" defer></script>`,
    },
  }, 201);
}

async function deleteSite(siteId, env) {
  await env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(siteId).run();
  return json({ ok: true });
}

async function manualSync(siteId, env) {
  const site = await getSiteById(siteId, env);
  if (!site) throw new HttpError(404, "Site not found");
  if (!site.access_token_enc) throw new HttpError(400, "Instagramが未接続です");
  const result = await syncOneSite(site, env, true);
  return json({ ok: true, result });
}

async function getSiteById(id, env) {
  return env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first();
}

async function getSiteByConnectToken(connectToken, env) {
  return env.DB.prepare("SELECT * FROM sites WHERE connect_token = ?").bind(connectToken).first();
}

async function connectPage(connectToken, env) {
  const site = await getSiteByConnectToken(connectToken, env);
  if (!site) return html(simplePage("リンクが無効です", "このInstagram接続リンクは無効です。制作者へお問い合わせください。"), 404);

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
    <a class="button" href="/oauth/start/${encodeURIComponent(connectToken)}">${connected ? "Instagramを再接続する" : "Instagramと接続する"}</a>
    <p class="fine">Instagramのパスワードを制作会社へ伝える必要はありません。パスワードはこのサービスにも保存されません。</p>
  `;
  return html(shell(`${site.name} Instagram連携`, body));
}

async function startOAuth(connectToken, env) {
  assertEnv(env, ["IG_APP_ID", "IG_REDIRECT_URI"]);
  const site = await getSiteByConnectToken(connectToken, env);
  if (!site) throw new HttpError(404, "Site not found");

  const state = randomToken(24);
  const expiry = nowSec() + TEN_MINUTES;
  await env.DB.prepare("INSERT INTO oauth_states (state, site_id, expires_at) VALUES (?, ?, ?)")
    .bind(state, site.id, expiry)
    .run();

  const auth = new URL("https://www.instagram.com/oauth/authorize");
  auth.searchParams.set("client_id", env.IG_APP_ID);
  auth.searchParams.set("redirect_uri", env.IG_REDIRECT_URI);
  auth.searchParams.set("response_type", "code");
  auth.searchParams.set("scope", "instagram_business_basic");
  auth.searchParams.set("state", state);
  auth.searchParams.set("enable_fb_login", "0");

  return Response.redirect(auth.toString(), 302);
}

async function oauthCallback(request, env) {
  assertEnv(env, ["IG_APP_ID", "IG_APP_SECRET", "IG_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"]);
  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    return html(simplePage("Instagram連携を中止しました", "Instagram側で許可されなかったため、変更はありません。"), 400);
  }

  const code = (url.searchParams.get("code") || "").replace(/#_$/, "");
  const state = url.searchParams.get("state") || "";
  if (!code || !state) return html(simplePage("連携できませんでした", "認証情報が不足しています。もう一度接続リンクからお試しください。"), 400);

  const oauthState = await env.DB.prepare("SELECT * FROM oauth_states WHERE state = ?").bind(state).first();
  if (!oauthState || Number(oauthState.expires_at) < nowSec()) {
    return html(simplePage("リンクの有効期限が切れました", "もう一度接続リンクからお試しください。"), 400);
  }
  await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();

  const short = await exchangeAuthorizationCode(code, env);
  const long = await exchangeLongLivedToken(short.access_token, env);
  const token = long.access_token || short.access_token;
  const expiresIn = Number(long.expires_in || 5184000);
  const profile = await fetchInstagramProfile(token, env);
  const encrypted = await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
  const now = nowSec();

  await env.DB.prepare(`
    UPDATE sites
       SET ig_user_id = ?, ig_username = ?, ig_account_type = ?,
           access_token_enc = ?, token_expires_at = ?, token_refreshed_at = ?,
           sync_error = NULL, updated_at = ?
     WHERE id = ?
  `).bind(
    profile.id,
    profile.username || "",
    profile.account_type || "",
    encrypted,
    now + expiresIn,
    now,
    now,
    oauthState.site_id,
  ).run();

  const site = await getSiteById(oauthState.site_id, env);
  try {
    await syncOneSite(site, env, false);
  } catch (err) {
    console.error("initial sync error", safeError(err));
  }

  const body = `
    <div class="badge">CONNECTED</div>
    <h1>Instagram連携が完了しました</h1>
    <div class="success">✓ @${escapeHtml(profile.username || "Instagram")} と正常に接続しました</div>
    <p class="lead">今後はいつも通りInstagramを更新するだけで、ホームページ側にも自動反映されます。</p>
    <p class="fine">この画面は閉じて大丈夫です。</p>
  `;
  return html(shell("Instagram連携完了", body));
}

async function exchangeAuthorizationCode(code, env) {
  const body = new URLSearchParams({
    client_id: env.IG_APP_ID,
    client_secret: env.IG_APP_SECRET,
    grant_type: "authorization_code",
    redirect_uri: env.IG_REDIRECT_URI,
    code,
  });
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  return parseInstagramResponse(res, "Instagram authorization code exchange failed");
}

async function exchangeLongLivedToken(shortToken, env) {
  const url = new URL("https://graph.instagram.com/access_token");
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", env.IG_APP_SECRET);
  url.searchParams.set("access_token", shortToken);
  const res = await fetch(url.toString());
  return parseInstagramResponse(res, "Instagram long-lived token exchange failed");
}

async function refreshLongLivedToken(token) {
  const url = new URL("https://graph.instagram.com/refresh_access_token");
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  return parseInstagramResponse(res, "Instagram token refresh failed");
}

async function fetchInstagramProfile(token, env) {
  const url = new URL(`${graphBase(env)}/me`);
  url.searchParams.set("fields", "id,username,account_type");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  return parseInstagramResponse(res, "Instagram profile request failed");
}

async function fetchInstagramMedia(site, token, env) {
  const fields = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";
  const url = new URL(`${graphBase(env)}/${site.ig_user_id}/media`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", String(Math.max(12, Number(site.post_limit || 9) * 2)));
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  const data = await parseInstagramResponse(res, "Instagram media request failed");
  return Array.isArray(data.data) ? data.data : [];
}

async function fetchInstagramStories(site, token, env) {
  if (!Number(site.show_stories)) return [];
  try {
    const fields = "id,media_type,media_url,thumbnail_url,permalink,timestamp";
    const url = new URL(`${graphBase(env)}/${site.ig_user_id}/stories`);
    url.searchParams.set("fields", fields);
    url.searchParams.set("access_token", token);
    const res = await fetch(url.toString());
    const data = await parseInstagramResponse(res, "Instagram stories request failed");
    return Array.isArray(data.data) ? data.data : [];
  } catch (err) {
    console.warn("stories unavailable", safeError(err));
    return [];
  }
}

async function parseInstagramResponse(res, prefix) {
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok || data?.error) {
    const msg = data?.error?.message || data?.error_message || data?.raw || `HTTP ${res.status}`;
    throw new Error(`${prefix}: ${msg}`);
  }
  return data;
}

async function syncOneSite(site, env, forceRefreshToken = false) {
  if (!site?.access_token_enc || !site?.ig_user_id) throw new Error("Instagram not connected");
  let token = await decryptToken(site.access_token_enc, env.TOKEN_ENCRYPTION_KEY);
  let tokenExpiresAt = Number(site.token_expires_at || 0);
  let tokenRefreshedAt = Number(site.token_refreshed_at || 0);
  const now = nowSec();

  const shouldRefresh = forceRefreshToken || !tokenRefreshedAt || now - tokenRefreshedAt > THIRTY_DAYS || tokenExpiresAt - now < 14 * DAY;
  if (shouldRefresh) {
    try {
      const refreshed = await refreshLongLivedToken(token);
      if (refreshed.access_token) {
        token = refreshed.access_token;
        tokenExpiresAt = now + Number(refreshed.expires_in || 5184000);
        tokenRefreshedAt = now;
        const encrypted = await encryptToken(token, env.TOKEN_ENCRYPTION_KEY);
        await env.DB.prepare(`
          UPDATE sites
             SET access_token_enc = ?, token_expires_at = ?, token_refreshed_at = ?, updated_at = ?
           WHERE id = ?
        `).bind(encrypted, tokenExpiresAt, tokenRefreshedAt, now, site.id).run();
      }
    } catch (err) {
      console.warn("token refresh skipped", safeError(err));
    }
  }

  try {
    const media = await fetchInstagramMedia(site, token, env);
    const stories = await fetchInstagramStories(site, token, env);
    const reels = media.filter((item) => item.media_product_type === "REELS");
    const posts = media.filter((item) => item.media_product_type !== "REELS");
    const limit = Number(site.post_limit || 9);
    const payload = {
      updated_at: new Date().toISOString(),
      username: site.ig_username || "",
      posts: Number(site.show_posts) ? posts.slice(0, limit) : [],
      reels: Number(site.show_reels) ? reels.slice(0, limit) : [],
      stories: Number(site.show_stories) ? stories : [],
    };

    await env.DB.prepare(`
      UPDATE sites
         SET feed_json = ?, last_sync_at = ?, sync_error = NULL, updated_at = ?
       WHERE id = ?
    `).bind(JSON.stringify(payload), now, now, site.id).run();

    return { synced: true, posts: payload.posts.length, reels: payload.reels.length, stories: payload.stories.length };
  } catch (err) {
    await env.DB.prepare("UPDATE sites SET sync_error = ?, updated_at = ? WHERE id = ?")
      .bind(String(err.message || err).slice(0, 1000), now, site.id)
      .run();
    throw err;
  }
}

async function syncConnectedSites(env) {
  if (!env.DB || !env.TOKEN_ENCRYPTION_KEY) return;
  const batchSize = Math.min(100, Math.max(1, Number(env.SYNC_BATCH_SIZE || 25)));
  await env.DB.prepare("DELETE FROM oauth_states WHERE expires_at < ?").bind(nowSec()).run();
  const { results = [] } = await env.DB.prepare(`
    SELECT * FROM sites
     WHERE access_token_enc IS NOT NULL AND ig_user_id IS NOT NULL
     ORDER BY COALESCE(last_sync_at, 0) ASC
     LIMIT ?
  `).bind(batchSize).all();

  for (let i = 0; i < results.length; i += 5) {
    const chunk = results.slice(i, i + 5);
    await Promise.allSettled(chunk.map((site) => syncOneSite(site, env, false)));
  }
}

async function publicFeed(request, siteId, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      },
    });
  }

  const site = await env.DB.prepare(`
    SELECT id, allowed_origin, feed_json, ig_username, last_sync_at, sync_error
      FROM sites WHERE id = ?
  `).bind(siteId).first();
  if (!site) return json({ error: "Site not found" }, 404);

  const origin = request.headers.get("Origin") || "";
  if (origin && origin !== site.allowed_origin) {
    return json({ error: "Origin not allowed" }, 403, { "Access-Control-Allow-Origin": site.allowed_origin });
  }

  let feed = { updated_at: null, username: site.ig_username || "", posts: [], reels: [], stories: [] };
  if (site.feed_json) {
    try { feed = JSON.parse(site.feed_json); } catch {}
  }

  return json(feed, 200, {
    "Cache-Control": "public, max-age=120",
    "Access-Control-Allow-Origin": site.allowed_origin,
    "Vary": "Origin",
  });
}

async function encryptToken(token, hexKey) {
  const keyBytes = hexToBytes(hexKey);
  if (keyBytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token)));
  const joined = new Uint8Array(iv.length + ciphertext.length);
  joined.set(iv, 0);
  joined.set(ciphertext, iv.length);
  return bytesToBase64Url(joined);
}

async function decryptToken(value, hexKey) {
  const keyBytes = hexToBytes(hexKey);
  if (keyBytes.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 64 hex characters");
  const all = base64UrlToBytes(value);
  const iv = all.slice(0, 12);
  const ciphertext = all.slice(12);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(plain);
}

function hexToBytes(hex) {
  const clean = String(hex || "").trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return new Uint8Array();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function shell(title, body) {
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

function simplePage(title, text) {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(text)}</p>`);
}

function adminPage() {
  return `<!doctype html>
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
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(d.error||'Request failed'),{status:r.status});return d}
function showApp(){ $('#login').classList.add('hidden'); $('#app').classList.remove('hidden') }
function showLogin(){ $('#app').classList.add('hidden'); $('#login').classList.remove('hidden') }
async function load(){try{const d=await api('/api/admin/sites');showApp();render(d.sites||[])}catch(e){if(e.status===401)showLogin();else $('#loginMsg').textContent=e.message}}
function render(sites){const root=$('#sites');if(!sites.length){root.innerHTML='<div class="empty">まだサイトがありません</div>';return}root.innerHTML=sites.map(s=>`<article class="site"><div class="siteTop"><div><h3>${esc(s.name)}</h3><div class="url">${esc(s.website_url)}</div></div><span class="status ${s.connected?'ok':'off'}">${s.connected?'接続済み':'未接続'}</span></div>${s.ig_username?`<div class="sub" style="margin-top:8px">Instagram: @${esc(s.ig_username)}</div>`:''}${s.sync_error?`<div class="err">同期エラー: ${esc(s.sync_error)}</div>`:''}<div class="row"><button class="btn small" data-copy="${esc(s.connect_url)}">接続URLをコピー</button><button class="btn secondary small" data-copycode="${encodeURIComponent(s.embed_code)}">埋め込みコードをコピー</button>${s.connected?`<button class="btn secondary small" data-sync="${esc(s.id)}">今すぐ同期</button>`:''}<button class="btn danger small" data-del="${esc(s.id)}">削除</button></div><div class="code">${esc(s.embed_code)}</div></article>`).join('')}
$('#loginBtn').onclick=async()=>{try{$('#loginMsg').textContent='';await api('/api/admin/login',{method:'POST',body:JSON.stringify({password:$('#password').value})});$('#password').value='';await load()}catch(e){ $('#loginMsg').textContent=e.message }};
$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')$('#loginBtn').click()});
$('#logoutBtn').onclick=async()=>{await api('/api/admin/logout',{method:'POST'}).catch(()=>{});showLogin()};
$('#addBtn').onclick=async()=>{try{$('#addMsg').textContent='登録中...';await api('/api/admin/sites',{method:'POST',body:JSON.stringify({name:$('#siteName').value,website_url:$('#siteUrl').value,post_limit:Number($('#postLimit').value||9),show_posts:$('#showPosts').checked,show_reels:$('#showReels').checked,show_stories:$('#showStories').checked})});$('#siteName').value='';$('#siteUrl').value='';$('#addMsg').textContent='追加しました';await load()}catch(e){$('#addMsg').textContent=e.message}};
document.addEventListener('click',async e=>{const t=e.target;if(t.dataset.copy){await navigator.clipboard.writeText(t.dataset.copy);t.textContent='コピー済み';setTimeout(()=>t.textContent='接続URLをコピー',1200)}if(t.dataset.copycode){await navigator.clipboard.writeText(decodeURIComponent(t.dataset.copycode));t.textContent='コピー済み';setTimeout(()=>t.textContent='埋め込みコードをコピー',1200)}if(t.dataset.sync){t.textContent='同期中...';try{await api('/api/admin/sites/'+t.dataset.sync+'/sync',{method:'POST'});await load()}catch(err){alert(err.message)}}if(t.dataset.del&&confirm('このサイトを削除しますか？')){await api('/api/admin/sites/'+t.dataset.del,{method:'DELETE'});await load()}});
load();
</script>
</body>
</html>`;
}

function embedScript(apiOrigin) {
  return js(`(()=>{\n  const script=document.currentScript;\n  if(!script)return;\n  const site=script.dataset.site;\n  if(!site)return;\n  const mount=script.previousElementSibling&&script.previousElementSibling.hasAttribute('data-instagram-auto-sync')?script.previousElementSibling:(()=>{const d=document.createElement('div');d.setAttribute('data-instagram-auto-sync','');script.parentNode.insertBefore(d,script);return d})();\n  const origin=${JSON.stringify(apiOrigin)};\n  const esc=s=>String(s??'').replace(/[&<>\"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#039;'}[c]));\n  if(!document.getElementById('iwas-style')){const st=document.createElement('style');st.id='iwas-style';st.textContent='[data-instagram-auto-sync]{--iwas-gap:10px;font-family:inherit}.iwas-stories{display:flex;gap:10px;overflow:auto;padding:3px 0 12px}.iwas-story{width:70px;flex:0 0 70px;text-decoration:none;color:inherit}.iwas-story img,.iwas-story video{width:64px;height:64px;border-radius:50%;object-fit:cover;border:3px solid #fff;outline:2px solid #d14f8f}.iwas-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:var(--iwas-gap)}.iwas-item{position:relative;display:block;aspect-ratio:1/1;overflow:hidden;border-radius:10px;background:#eee}.iwas-item img,.iwas-item video{width:100%;height:100%;object-fit:cover;display:block}.iwas-play{position:absolute;inset:auto 8px 8px auto;background:rgba(0,0,0,.62);color:#fff;border-radius:999px;padding:5px 8px;font:700 11px/1 sans-serif}.iwas-empty{padding:18px;color:#777;text-align:center;font-size:13px}@media(max-width:520px){.iwas-grid{gap:6px}.iwas-item{border-radius:5px}}';document.head.appendChild(st)}\n  const mediaHtml=(m,isReel=false)=>{const src=esc(m.thumbnail_url||m.media_url||'');const href=esc(m.permalink||'#');if(!src)return '';return '<a class=\"iwas-item\" href=\"'+href+'\" target=\"_blank\" rel=\"noopener noreferrer\"><img src=\"'+src+'\" loading=\"lazy\" alt=\"Instagram投稿\">'+(isReel?'<span class=\"iwas-play\">▶ Reel</span>':'')+'</a>'};\n  fetch(origin+'/api/feed/'+encodeURIComponent(site),{mode:'cors'}).then(r=>{if(!r.ok)throw new Error('feed');return r.json()}).then(d=>{const stories=(d.stories||[]).map(s=>{const src=esc(s.thumbnail_url||s.media_url||'');const href=esc(s.permalink||'#');return src?'<a class=\"iwas-story\" href=\"'+href+'\" target=\"_blank\" rel=\"noopener noreferrer\"><img src=\"'+src+'\" loading=\"lazy\" alt=\"Instagram Story\"></a>':''}).join('');const items=[...(d.posts||[]).map(x=>mediaHtml(x,false)),...(d.reels||[]).map(x=>mediaHtml(x,true))].join('');mount.innerHTML=(stories?'<div class=\"iwas-stories\">'+stories+'</div>':'')+(items?'<div class=\"iwas-grid\">'+items+'</div>':'<div class=\"iwas-empty\">Instagramの投稿を準備中です</div>')}).catch(()=>{mount.innerHTML='<div class=\"iwas-empty\">Instagramを読み込めませんでした</div>'});\n})();`);
}
