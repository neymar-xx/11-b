// Optional browser integration test. Start a separate Chromium with
// --headless --remote-debugging-port=9222 --user-data-dir=/tmp/fond-browser-test
// then run: node --no-warnings tests/browser.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../server.mjs';

const temporary = mkdtempSync(path.join(os.tmpdir(), 'fond-browser-'));
const screenshotDir = path.join(os.tmpdir(), '11-b-fond-previews');
mkdirSync(screenshotDir, { recursive: true });
const password = 'browser-test-password-2026';
const { server } = await createApp({ dataDir: temporary, adminPassword: password });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const origin = `http://127.0.0.1:${server.address().port}`;
const debugOrigin = process.env.CHROME_DEBUG_ORIGIN || 'http://127.0.0.1:9222';
let socket;
let target;
let sequence = 0;
const pending = new Map();
const errors = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)); }, 12000);
    pending.set(id, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(expression, message = expression) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${message}`);
}
const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const input = (selector, value) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const change = (selector, value) => evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); element.value = ${JSON.stringify(value)}; element.dispatchEvent(new Event('change', { bubbles: true })); })()`);
const check = async (expression, message) => assert.equal(await evaluate(expression), true, message);
async function screenshot(name, width, height) {
  await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(150);
  const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(path.join(screenshotDir, name), Buffer.from(shot.data, 'base64'));
}
try {
  const response = await fetch(`${debugOrigin}/json/new?about:blank`, { method: 'PUT' });
  target = await response.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const listener = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) listener?.reject(new Error(message.error.message));
      else listener?.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error' && message.params.entry.source !== 'network') errors.push(message.params.entry);
  });
  await command('Page.enable');
  await command('Runtime.enable');
  await command('Log.enable');
  await command('Network.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin });
  await waitFor('document.querySelectorAll("[data-payment]").length === 225');
  await check('document.querySelectorAll("[data-payment]:disabled").length === 225', 'Guests cannot use any payment control');
  await change('#month-select', '09');
  await click('[data-theme-choice="light"]');
  await screenshot('desktop-light.png', 1440, 1050);
  await check('document.documentElement.scrollWidth <= innerWidth', 'Desktop does not overflow');
  console.log('PASS: visitor mode, all 25 members × 9 months, desktop layout');

  await input('#member-search', 'sunnatilla');
  await check('document.querySelectorAll("#table-body tr").length === 1 && document.querySelector("#table-body").textContent.includes("Суннатилла")', 'Latin search finds Cyrillic name');
  await input('#member-search', 'Суннатилла');
  await check('document.querySelectorAll("[data-payment]").length === 9', 'Cyrillic search works');
  await input('#member-search', '');
  await click('[data-filter="paid"]');
  await check('document.querySelector("#clear-filters") !== null', 'Paid filter handles empty results');
  await click('#clear-filters');
  await check('document.querySelectorAll("[data-payment]").length === 225', 'Clear filters restores all rows');
  console.log('PASS: Latin/Cyrillic search and status filtering');

  await click('[data-theme-choice="dark"]');
  await command('Page.reload');
  await waitFor('document.querySelectorAll("[data-payment]").length === 225');
  await check('document.documentElement.dataset.theme === "dark"', 'Theme persists across reload');
  await screenshot('desktop-dark.png', 1440, 1050);
  await screenshot('mobile-dark.png', 390, 844);
  await check('document.documentElement.scrollWidth <= innerWidth', 'Mobile page does not overflow');
  await evaluate('document.querySelector("#table-scroll").scrollLeft = 900');
  await check('document.querySelector(".member-cell").getBoundingClientRect().left < 100', 'Name column stays visible while scrolling');
  await evaluate('document.querySelector("#table-scroll").scrollLeft = 0');
  await click('[data-theme-choice="light"]');
  await screenshot('mobile-light.png', 390, 844);
  console.log('PASS: persistent light/dark theme, mobile layout and sticky names');

  await click('#admin-button');
  await input('#admin-password', 'wrong');
  await evaluate('document.querySelector("#login-form").requestSubmit()');
  await waitFor('document.querySelector("#login-error").textContent.includes("noto‘g‘ri")');
  await input('#admin-password', password);
  await evaluate('document.querySelector("#login-form").requestSubmit()');
  await waitFor('document.querySelectorAll("[data-payment]:enabled").length === 225');
  await change('#month-select', '09');
  await change('[data-payment="muslima:09"]', 'paid');
  await waitFor('document.querySelector("#paid-count").textContent === "1" && document.querySelectorAll("[data-payment]:enabled").length === 225');
  await command('Page.reload');
  await waitFor('document.querySelectorAll("[data-payment]:enabled").length === 225');
  await change('#month-select', '09');
  await check('document.querySelector("[data-payment=\"muslima:09\"]").value === "paid" && document.querySelector("#paid-count").textContent === "1"', 'Payment and admin session persist on reload');
  const selectedYear = await evaluate('Number(document.querySelector("#year-select").value)');
  await change('#year-select', String(selectedYear + 1));
  await waitFor(`document.querySelector('#school-year-footer').textContent.startsWith('${selectedYear + 1}') && !document.querySelector('#year-select').disabled`);
  await check('document.querySelector("[data-payment=\"muslima:09\"]").value === "unpaid"', 'School years have separate payments');
  await change('#year-select', String(selectedYear));
  await waitFor('document.querySelector("[data-payment=\"muslima:09\"]").value === "paid"');
  await screenshot('admin-mobile.png', 390, 844);
  console.log('PASS: login, payment changes, persisted session and separate school years');

  await command('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: temporary });
  await click('#export-button');
  let csv;
  for (let attempt = 0; attempt < 30; attempt++) {
    csv = readdirSync(temporary).find((file) => file.endsWith('.csv'));
    if (csv) break;
    await sleep(100);
  }
  assert.ok(csv, 'CSV export downloaded');
  const content = readFileSync(path.join(temporary, csv), 'utf8');
  assert.equal(content.charCodeAt(0), 0xfeff);
  assert.equal(content.split('\r\n').length, 26);
  assert.ok(content.includes('Абдуллаев Суннатилла'));
  assert.ok(content.split('\r\n')[1].includes('To‘langan'));
  await command('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1050, deviceScaleFactor: 1, mobile: false });
  await click('#activity-button');
  await check('document.querySelector("#activity-list").textContent.includes("Xaydarova Muslima")', 'Activity includes the edited member');
  await click('#activity-dialog [data-close-dialog]');
  await screenshot('admin-desktop.png', 1440, 1050);
  console.log('PASS: Excel CSV with Cyrillic and full roster, activity history');

  await click('#admin-button');
  await click('#change-password-button');
  await input('#current-password', password);
  await input('#new-password', 'updated-browser-password');
  await input('#confirm-password', 'mismatched-browser-password');
  await evaluate('document.querySelector("#password-form").requestSubmit()');
  await check('document.querySelector("#password-error").textContent.includes("bir xil emas")', 'Password confirmation is validated');
  await input('#confirm-password', 'updated-browser-password');
  await evaluate('document.querySelector("#password-form").requestSubmit()');
  await waitFor('!document.querySelector("#password-dialog").open');
  await click('#admin-button');
  await click('#logout-button');
  await waitFor('document.querySelectorAll("[data-payment]:disabled").length === 225');
  await click('#admin-button');
  await input('#admin-password', 'updated-browser-password');
  await evaluate('document.querySelector("#login-form").requestSubmit()');
  await waitFor('document.querySelectorAll("[data-payment]:enabled").length === 225');
  console.log('PASS: password change, logout and login with the new password');

  await command('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await change('[data-payment="muslima:09"]', 'unpaid');
  await waitFor('document.querySelector("#save-state").classList.contains("is-error") && document.querySelectorAll("[data-payment]:enabled").length === 225');
  await check('document.querySelector("[data-payment=\"muslima:09\"]").value === "paid"', 'Failed request restores saved status');
  await command('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await command('Page.reload');
  await waitFor('document.querySelectorAll("[data-payment]:enabled").length === 225');
  await check('document.querySelector("[data-payment=\"muslima:09\"]").value === "paid"', 'Offline attempt did not alter saved payment');
  assert.deepEqual(errors, [], 'No uncaught JavaScript or CSP errors');
  console.log(`PASS: offline recovery, no JavaScript/CSP errors\nScreenshots: ${screenshotDir}`);
} finally {
  if (target) await fetch(`${debugOrigin}/json/close/${target.id}`).catch(() => {});
  socket?.close();
  await new Promise((resolve) => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
