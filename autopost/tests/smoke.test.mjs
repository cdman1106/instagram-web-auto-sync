import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { adminPage } from '../src/admin-ui.js';

test('health exposes no secrets and defaults to not live', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/health'), { PUBLISH_ENABLED: 'false' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.live, false);
  assert.equal(JSON.stringify(body).includes('IG_TOKEN_'), false);
});

test('admin dashboard is available without credentials but discloses no posts', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/admin'), {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  const text = await res.text();
  assert.match(text, /タッチCD/);
  assert.match(text, /いっぷく/);
  assert.match(text, /全アカウントを停止/);
});

test('unauthenticated admin endpoints always deny access', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/api/admin/posts'), { ADMIN_API_KEY: 'example-of-a-very-long-secret-key-123456' });
  assert.equal(res.status, 401);
});

test('short or absent API keys cannot authorize admin endpoints', async () => {
  const req = new Request('https://example.invalid/api/admin/posts', { headers: { Authorization: 'Bearer short' } });
  const res = await worker.fetch(req, { ADMIN_API_KEY: 'short' });
  assert.equal(res.status, 401);
});

test('invalid public media paths never query storage', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/media/../../bad.jpg'), {});
  assert.equal(res.status, 404);
});

test('public routes reject unknown operations', async () => {
  const res = await worker.fetch(new Request('https://example.invalid/unrecognized'), {});
  assert.equal(res.status, 404);
});

test('standalone UI response has no external executable scripts', async () => {
  const page = await adminPage().text();
  assert.equal(page.includes('<script src='), false);
  assert.equal(page.includes('<iframe'), false);
});
