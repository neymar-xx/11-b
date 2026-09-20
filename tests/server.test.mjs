import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';
import { members, months, schoolYear } from '../lib/roster.mjs';

const password = 'testing-only-password-2026';
async function fixture(t, overrides = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'fond-test-'));
  let instance;
  let base;
  const start = async () => {
    instance = await createApp({ dataDir, adminPassword: password, ...overrides });
    instance.server.listen(0, '127.0.0.1');
    await once(instance.server, 'listening');
    base = `http://127.0.0.1:${instance.server.address().port}`;
  };
  const stop = async () => {
    if (!instance.server.listening) return;
    await new Promise((resolve, reject) => instance.server.close((error) => error ? reject(error) : resolve()));
  };
  await start();
  t.after(async () => { await stop(); rmSync(dataDir, { recursive: true, force: true }); });
  const request = async (url, options = {}) => {
    const { body, headers, ...rest } = options;
    const response = await fetch(`${base}${url}`, {
      ...rest,
      headers: { Origin: base, 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, headers: response.headers, body: result };
  };
  const login = async (candidate = password) => {
    const response = await request('/api/login', { method: 'POST', body: { password: candidate } });
    assert.equal(response.status, 200);
    return response.headers.get('set-cookie').split(';')[0];
  };
  return { request, login, dataDir, restart: async () => { await stop(); await start(); } };
}
const payment = (extra = {}) => ({ year: 2026, memberId: 'muslima', month: '09', paid: true, version: 0, ...extra });

test('roster contains each of the 25 members once and September–May in order', () => {
  assert.equal(members.length, 25);
  assert.equal(new Set(members.map((member) => member.name)).size, 25);
  assert.equal(new Set(members.map((member) => member.id)).size, 25);
  assert.deepEqual(months.map((month) => month.id), ['09', '10', '11', '12', '01', '02', '03', '04', '05']);
  assert.equal(schoolYear(new Date(2026, 7, 31)), 2025);
  assert.equal(schoolYear(new Date(2026, 8, 1)), 2026);
});

test('visitors can read the roster but cannot change payments or passwords', async (t) => {
  const { request } = await fixture(t);
  const state = await request('/api/state?year=2026');
  assert.equal(state.status, 200);
  assert.equal(state.body.members.length, 25);
  assert.deepEqual(state.body.payments, {});
  assert.deepEqual((await request('/api/session')).body, { admin: false });
  assert.equal((await request('/api/payments', { method: 'PATCH', body: payment() })).status, 401);
  assert.equal((await request('/api/password', { method: 'POST', body: { currentPassword: password, newPassword: 'a-different-password' } })).status, 401);
  assert.equal((await request('/.data/admin-password.txt')).status, 404);
  assert.equal((await request('/.data/fond.sqlite')).status, 404);
});

test('all browser assets load with the expected types and security headers', async (t) => {
  const { request } = await fixture(t);
  for (const [url, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css'], ['/favicon.svg', 'image/svg+xml']]) {
    const response = await request(url);
    assert.equal(response.status, 200, url);
    assert.ok(response.headers.get('content-type').startsWith(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
});

test('authenticated edits persist across reloads and restarts, with separate school years', async (t) => {
  const { request, login, restart } = await fixture(t);
  const cookie = await login();
  const first = await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie }, body: payment() });
  assert.equal(first.status, 200);
  assert.equal(first.body.payments['muslima:09'].paid, true);
  assert.equal(first.body.payments['muslima:09'].version, 1);
  assert.equal(first.body.activity.length, 1);
  assert.deepEqual((await request('/api/state?year=2027')).body.payments, {});
  await restart();
  assert.equal((await request('/api/state?year=2026')).body.payments['muslima:09'].paid, true);
  const unpaid = await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie }, body: payment({ paid: false, version: 1 }) });
  assert.equal(unpaid.status, 200);
  assert.equal(unpaid.body.payments['muslima:09'].paid, false);
  assert.equal(unpaid.body.payments['muslima:09'].version, 2);
  assert.equal(unpaid.body.activity.length, 2);
});

test('stale edits are rejected so another tab cannot silently overwrite a payment', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login();
  await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie }, body: payment() });
  const stale = await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie }, body: payment({ paid: false }) });
  assert.equal(stale.status, 409);
  assert.equal((await request('/api/state?year=2026')).body.payments['muslima:09'].paid, true);
});

test('server checks member, month, year, paid flag and version', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login();
  for (const invalid of [{ memberId: 'nobody' }, { month: '06' }, { year: 2026.5 }, { year: 2101 }, { paid: 'true' }, { version: -1 }]) {
    assert.equal((await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie }, body: payment(invalid) })).status, 400);
  }
  assert.equal((await request('/api/state?year=invalid')).status, 400);
});

test('foreign origins are rejected even with an authenticated session', async (t) => {
  const { request, login } = await fixture(t);
  const cookie = await login();
  for (const origin of ['https://another-site.example', 'null', '']) {
    assert.equal((await request('/api/payments', { method: 'PATCH', headers: { Cookie: cookie, Origin: origin }, body: payment() })).status, 403);
  }
});

test('login cookies are HTTP-only, logout invalidates them, and forged cookies fail', async (t) => {
  const { request } = await fixture(t);
  const login = await request('/api/login', { method: 'POST', body: { password } });
  const setCookie = login.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  const cookie = setCookie.split(';')[0];
  assert.equal((await request('/api/session', { headers: { Cookie: cookie } })).body.admin, true);
  await request('/api/logout', { method: 'POST', headers: { Cookie: cookie }, body: {} });
  assert.equal((await request('/api/session', { headers: { Cookie: cookie } })).body.admin, false);
  assert.equal((await request('/api/session', { headers: { Cookie: `fond_session=${'a'.repeat(64)}` } })).body.admin, false);
});

test('password changes validate the current password and revoke other sessions', async (t) => {
  const { request, login } = await fixture(t);
  const first = await login();
  const second = await login();
  const change = (currentPassword, newPassword) => request('/api/password', { method: 'POST', headers: { Cookie: first }, body: { currentPassword, newPassword } });
  assert.equal((await change('wrong', 'new-test-password-2026')).status, 401);
  assert.equal((await change(password, 'short')).status, 400);
  assert.equal((await change(password, 'new-test-password-2026')).status, 200);
  assert.equal((await request('/api/session', { headers: { Cookie: first } })).body.admin, true);
  assert.equal((await request('/api/session', { headers: { Cookie: second } })).body.admin, false);
  assert.equal((await request('/api/login', { method: 'POST', body: { password } })).status, 401);
  await login('new-test-password-2026');
});

test('repeated failed login attempts are rate limited', async (t) => {
  const { request } = await fixture(t);
  for (let index = 0; index < 5; index++) assert.equal((await request('/api/login', { method: 'POST', body: { password: 'wrong' } })).status, 401);
  assert.equal((await request('/api/login', { method: 'POST', body: { password } })).status, 429);
});

test('generated initial password is local and removed after changing it', async (t) => {
  const { request, login, dataDir } = await fixture(t, { adminPassword: undefined });
  const bootstrapPath = path.join(dataDir, 'admin-password.txt');
  assert.ok(existsSync(bootstrapPath));
  const initial = readFileSync(bootstrapPath, 'utf8').split('\n')[2];
  const cookie = await login(initial);
  assert.equal((await request('/api/password', { method: 'POST', headers: { Cookie: cookie }, body: { currentPassword: initial, newPassword: 'replacement-test-password' } })).status, 200);
  assert.equal(existsSync(bootstrapPath), false);
});
