import { adminPage, customerConnectPage, oauthSuccessPage, simplePage } from "./ui.js";
import { embedScriptBody } from "./embed.js";

const TEN_MINUTES = 10 * 60;
const DAY = 24 * 60 * 60;
const THIRTY_DAYS = 30 * DAY;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    try {
      if (url.pathname === "/health") return json({ ok: true, service: "instagram-web-auto-sync" });
      if (url.pathname === "/") return Response.redirect(`${url.origin}/admin`, 302);
      if (url.pathname === "/admin" && request.method === "GET") return html(adminPage());
      if (url.pathname === "/api/admin/login" && request.method === "POST") return adminLogin(request, env);
      if (url.pathname === "/api/admin/logout" && request.method === "POST") return adminLogout();

      if (url.pathname === "/api/admin/sites" && request.method === "GET") {
        await requireAdmin(request, env);
        return listSites(env, url.origin);
      }

      if (url.pathname === "/api/admin/sites" && request.method === "POST") {
        await requireAdmin(request, env);
        return createSite(request, env, url.origin);
      }

      const syncMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)\/sync$/);
      if (syncMatch && request.method === "POST") {
        await requireAdmin(request, env);
        return manualSync(syncMatch[1], env);
      }

      const deleteMatch = url.pathname.match(/^\/api\/admin\/sites\/([^/]+)$/);
      if (deleteMatch && request.method === "DELETE") {
        await requireAdmin(request, env);
        return deleteSite(deleteMatch[1], env);
      }

      const connectMatch = url.pathname.match(/^\/connect\/([^/]+)$/);
      if (connectMatch && request.method === "GET") return connectPage(connectMatch[1], env);

      const oauthStartMatch = url.pathname.match(/^\/oauth\/start\/([^/]+)$/);
      if (oauthStartMatch && request.method === "GET") return startOAuth(oauthStartMatch[1], env);

      if (url.pathname === "/oauth/callback" && request.method === "GET") return oauthCallback(request, env);

      const feedMatch = url.pathname.match(/^\/api\/feed\/([^/]+)$/);
      if (feedMatch && (request.method === "GET" || request.method === "OPTIONS")) {
        return publicFeed(request, feedMatch[1], env);
      }

      if (url.pathname === "/embed.js" && request.method === "GET") {
        return javascript(embedScriptBody(url.origin));
      }

      return new Response("Not Found", { status: 404 });
    } catch (err) {
      console.error("request error", safeError(err));
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
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

function safeError(err) {
  return { name: err?.name, message: err?.message };
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function assertEnv(env, names) {
  const missing = names.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(", ")}`);
}

function publicBaseUrl(env, fallback) {
  return String(env.PUBLIC_BASE_URL || fallback || "").replace(/\/$/, "");
}

function graphBase(env) {
  const version = String(env.IG_API_VERSION || "v25.0").replace(/^\/+|\/+$/g, "");
  return `https://graph.instagram.com/${version}`;
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

function javascript(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
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
  if (!timingSafeEqual(body.password, env.ADMIN_PASSWORD)) return json({ error: "パスワードが違います" }, 401);
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

async function listSites(env, fallbackOrigin) {
  const { results = [] } = await env.DB.prepare(`
    SELECT id, name, website_url, allowed_origin, connect_token,
           ig_user_id, ig_username, ig_account_type,
           last_sync_at, sync_error, show_posts, show_reels, show_stories,
           post_limit, created_at, updated_at
      FROM sites
     ORDER BY created_at DESC
  `).all();

  const base = publicBaseUrl(env, fallbackOrigin);
  return json({
    sites: results.map((site) => ({
      ...site,
      connected: Boolean(site.ig_user_id),
      connect_url: `${base}/connect/${site.connect_token}`,
      embed_code: `<div data-instagram-auto-sync></div>\n<script src="${base}/embed.js" data-site="${site.id}" defer></script>`,
    })),
  });
}

async function createSite(request, env, fallbackOrigin) {
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

  const base = publicBaseUrl(env, fallbackOrigin);
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
  await env.DB.prepare("DELETE FROM oauth_states WHERE site_id = ?").bind(siteId).run();
  await env.DB.prepare("DELETE FROM sites WHERE id = ?").bind(siteId).run();
  return json({ ok: true });
}

async function getSiteById(id, env) {
  return env.DB.prepare("SELECT * FROM sites WHERE id = ?").bind(id).first();
}

async function getSiteByConnectToken(token, env) {
  return env.DB.prepare("SELECT * FROM sites WHERE connect_token = ?").bind(token).first();
}

async function manualSync(siteId, env) {
  const site = await getSiteById(siteId, env);
  if (!site) throw new HttpError(404, "Site not found");
  if (!site.access_token_enc) throw new HttpError(400, "Instagramが未接続です");
  const result = await syncOneSite(site, env, true);
  return json({ ok: true, result });
}

async function connectPage(connectToken, env) {
  const site = await getSiteByConnectToken(connectToken, env);
  if (!site) return html(simplePage("リンクが無効です", "このInstagram接続リンクは無効です。制作者へお問い合わせください。"), 404);
  return html(customerConnectPage(site));
}

async function startOAuth(connectToken, env) {
  assertEnv(env, ["IG_APP_ID", "IG_REDIRECT_URI"]);
  const site = await getSiteByConnectToken(connectToken, env);
  if (!site) throw new HttpError(404, "Site not found");

  const state = randomToken(24);
  await env.DB.prepare("INSERT INTO oauth_states (state, site_id, expires_at) VALUES (?, ?, ?)")
    .bind(state, site.id, nowSec() + TEN_MINUTES)
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
  if (url.searchParams.get("error")) {
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

  return html(oauthSuccessPage(profile.username));
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
    await Promise.allSettled(results.slice(i, i + 5).map((site) => syncOneSite(site, env, false)));
  }
}

async function publicFeed(request, siteId, env) {
  const site = await env.DB.prepare(`
    SELECT id, allowed_origin, feed_json, ig_username, last_sync_at, sync_error
      FROM sites WHERE id = ?
  `).bind(siteId).first();
  if (!site) return json({ error: "Site not found" }, 404);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": site.allowed_origin,
        "Access-Control-Allow-Methods": "GET,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
      },
    });
  }

  const origin = request.headers.get("Origin") || "";
  if (origin && origin !== site.allowed_origin) {
    return json({ error: "Origin not allowed" }, 403, {
      "Access-Control-Allow-Origin": site.allowed_origin,
      "Vary": "Origin",
    });
  }

  let feed = { updated_at: null, username: site.ig_username || "", posts: [], reels: [], stories: [] };
  if (site.feed_json) {
    try {
      feed = JSON.parse(site.feed_json);
    } catch {}
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
