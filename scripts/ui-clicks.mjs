#!/usr/bin/env node
// CLICK-THROUGH harness for Crew (crm/) and Admin (admin/). Same set-up as scripts/ui-shots.mjs (real CSP, stubbed Supabase client, headless Chrome over CDP, fixtures with placeholders only),
// but instead of photographing screens it PRESSES EVERY ACTIONABLE ELEMENT and records what happened:
//   OK         the stub received a call, or the page changed, or a message (toast) / dialog appeared
//   NO EFFECT  nothing at all happened (no call, no page change, no message)
//   ERROR      an uncaught exception or console error, a message that shows a code error, or a button left disabled for good
// Dialogs that open are filled with plausible fixture values and submitted; the result of that submit is recorded as its own row.
// Usage: node scripts/ui-clicks.mjs --out <dir> [--app crew|admin] [--persona owner|agent|techlead|staff] [--only <substring>] [--chrome <path>]
// Writes <dir>/clicks-<app>-<persona>.json. scripts/ui-clicks-report.mjs turns the JSON files into docs/DESK-ACTION-AUDIT.md.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('out'), ONLY = arg('only', ''), APP = arg('app', 'crew'), PERSONA = arg('persona', 'owner');
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
if (!OUT) { console.error('Usage: node scripts/ui-clicks.mjs --out <dir> [--app crew|admin] [--persona ...]'); process.exit(2); }
if (!existsSync(CHROME)) { console.error('SKIP: Chrome not found at ' + CHROME); process.exit(3); }
mkdirSync(OUT, { recursive: true });

const cspOf = (f) => (readFileSync(join(root, 'scripts', f), 'utf8').match(/Content-Security-Policy: (.*)/) || [])[1];
const CSP = { crm: cspOf('build_crm.sh'), admin: cspOf('build_admin.sh') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const FAKE_CONFIG = "window.MXP = { supabaseUrl: 'https://harness.invalid', supabaseAnonKey: 'harness', whatsapp: '910000000000', callNumber: '910000000000' };";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
  if (p === '/assets/js/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FAKE_CONFIG); }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  const h = { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  const app = p.startsWith('/crm/') ? 'crm' : p.startsWith('/admin/') ? 'admin' : null;
  if (app && f.endsWith('index.html') && CSP[app]) h['content-security-policy'] = CSP[app];
  res.writeHead(200, h); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const profile = mkdtempSync(join(tmpdir(), 'mxp-clicks-'));
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--hide-scrollbars', '--disk-cache-size=1', 'about:blank'], { stdio: 'ignore' });
const cleanup = () => { try { chrome.kill(); } catch (e) { /* gone */ } try { server.close(); } catch (e) { /* gone */ } try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* gone */ } };
process.on('exit', cleanup);
let port = 0;
for (let i = 0; i < 100 && !port; i++) { await new Promise((r) => setTimeout(r, 100)); try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch (e) { /* not yet */ } }
if (!port) { console.error('Chrome did not start'); process.exit(1); }
const targets = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const listeners = [];
ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); } else if (d.method) listeners.forEach((l) => l(d)); });
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };

let errs = [];   // errors since the last mark
listeners.push((d) => {
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') errs.push('console.error: ' + d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 200));
  if (d.method === 'Runtime.exceptionThrown') errs.push('exception: ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).split('\n')[0].slice(0, 200));
  if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error' && !/favicon|status of 404/.test(d.params.entry.text)) errs.push('log: ' + (d.params.entry.text + ' ' + (d.params.entry.url || '')).slice(0, 200));
  if (d.method === 'Fetch.requestPaused') {
    const u = new URL(d.params.request.url); const rid = d.params.requestId;
    if (u.hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId: rid }).catch(() => {});
    if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(d.params.request.url)) return send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(`export * from '${BASE}/tests/ui/supabase-stub.js';`).toString('base64') }).catch(() => {});
    return send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/plain' }], body: '' }).catch(() => {});
  }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });

/* ---------- in-page helpers, installed after every load ---------- */
const PAGE_JS = `(() => {
  if (window.__H) return; const H = window.__H = {};
  // Stand-ins so a click never leaves the page: external links and window.open are recorded, not followed. Confirm dialogs say yes.
  H.opened = []; window.open = (u) => { H.opened.push(String(u)); return { location: { set href(v) { H.opened.push(String(v)); } }, close() {}, opener: null, addEventListener() {}, document: { write() {}, close() {} }, focus() {}, print() {} }; };
  window.confirm = () => true; window.alert = () => {}; window.prompt = () => 'Test value';
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a[href]'); if (a && !a.getAttribute('href').startsWith('#')) { H.opened.push(a.getAttribute('href')); e.preventDefault(); } }, true);
  H.visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden]'); };
  H.sel = '[data-act],[data-flow],[data-dispatch],[data-issue],[data-q],[data-view],[data-tab],[data-group],[data-f],[data-dt],[data-retry],[data-lead],[data-cust],[data-mech],[data-coupon],[data-pin],[data-wl],[data-wi],[data-cb],[data-ci],button,a[href],summary,select,[role=tab],input[type=checkbox],input[type=radio]';
  H.list = (scope) => { const root = document.querySelector(scope) || document; const out = []; const seen = new Set(); for (const el of root.querySelectorAll(H.sel)) { if (seen.has(el) || !H.visible(el)) continue; if (el.closest('.modal-back,.flow-modal,#inv')) continue; if (scope === '#view' && el.closest('#sheet')) continue; seen.add(el); out.push(el); } return out; };
  H.desc = (el) => { const d = {}; for (const a of el.attributes) if (/^(data-|id$|name$|type$|href$|aria-label$)/.test(a.name)) d[a.name] = a.value.slice(0, 40); return { tag: el.tagName.toLowerCase(), attrs: d, text: (el.getAttribute('aria-label') || el.textContent || el.value || '').replace(/\\s+/g, ' ').trim().slice(0, 48), disabled: !!el.disabled, ariaDisabled: el.getAttribute('aria-disabled') === 'true' }; };
  H.snap = () => JSON.stringify([location.hash, [...document.body.children].filter((e) => !e.classList.contains('toast')).map((e) => e.outerHTML.slice(0, e.outerHTML.indexOf('>')) + e.innerHTML.length + ':' + e.innerHTML.slice(0, 4000) + e.innerHTML.slice(-2000)), [...document.querySelectorAll('input,select,textarea')].map((i) => i.value + (i.checked ? '1' : '') + (i.disabled ? 'd' : ''))]);
  H.toasts = () => [...document.querySelectorAll('.toast')].map((t) => ({ text: t.textContent, bad: t.classList.contains('bad') }));
  H.modals = () => [...document.querySelectorAll('.modal-back form, .flow-modal form, #inv')];
  H.fill = (form) => { const day = new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10);
    for (const el of form.elements) { if (!el.name && !el.id) continue; if (el.disabled || el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
      const nm = (el.name || el.id || '').toLowerCase(); let v = null;
      if (el.tagName === 'SELECT') { const o = [...el.options].find((x) => x.value); if (o && !el.value) v = o.value; }
      else if (el.type === 'checkbox' || el.type === 'radio') continue;
      else if (el.type === 'email') v = 'name@example.com'; else if (el.type === 'tel' || /phone|mobile/.test(nm)) v = '9000000001'; else if (el.type === 'number') v = el.min && Number(el.min) > 1 ? el.min : '100';
      else if (el.type === 'date') v = day; else if (el.type === 'datetime-local') v = day + 'T10:00'; else if (el.type === 'time') v = '10:00'; else if (el.type === 'url') v = 'https://example.invalid/x'; else if (/pin|pincode/.test(nm)) v = '560038'; else if (/ifsc/.test(nm)) v = 'HDFC0000001'; else if (/last4/.test(nm)) v = '1234'; else if (nm === 'eh') v = '4'; else if (nm === 'a' || /amount|price/.test(nm)) v = '500'; else if (el.tagName === 'TEXTAREA' || el.type === 'text' || el.type === 'search' || !el.type) v = 'Test value ok';
      if (v !== null && !el.readOnly && el.type !== 'file') { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); } } };
  H.closeAll = () => { document.querySelectorAll('.modal-back,.flow-modal,#inv').forEach((m) => m.remove()); document.querySelectorAll('.toast').forEach((t) => t.remove()); };
})()`;

/* ---------- loading a screen ---------- */
const crewUrl = (v) => '/crm/#' + v, ADMIN = '/admin/';
const idle = async (max = 4000) => { const t0 = Date.now(); let quiet = 0; while (Date.now() - t0 < max && quiet < 3) { const p = await ev('window.__UI_PENDING||0').catch(() => 0); quiet = p === 0 ? quiet + 1 : 0; await sleep(60); } };
async function load(url, o = {}) {
  await send('Page.navigate', { url: 'about:blank' }); await sleep(30);
  const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__UI=${JSON.stringify({ scenario: 'ok', persona: PERSONA, extra: !!o.extra, ...(o.ui || {}) })};try{sessionStorage.clear();localStorage.clear()}catch(e){}` });
  await send('Page.navigate', { url: BASE + url });
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { await sleep(120); ok = await ev(`!!document.querySelector(${JSON.stringify(o.wait || '#view > *')})`).catch(() => false); }
  await ev(PAGE_JS).catch(() => {});
  await idle(); await sleep(120);
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  return ok;
}
const logLen = () => ev('(window.__UI_LOG||[]).length').catch(() => 0);
const logSince = (n) => ev(`(window.__UI_LOG||[]).slice(${n})`).catch(() => []);

/* ---------- press one element and describe the outcome ---------- */
const BAD_TEXT = /TypeError|ReferenceError|is not a function|is not defined|undefined|Cannot read|\[object|NaN/i;
async function press(clickJs) {
  const before = await ev('window.__H.snap()'), n0 = await logLen(); errs = [];
  await ev('document.querySelectorAll(".toast").forEach(t=>t.remove())');
  let thrown = null; try { await ev(clickJs); } catch (e) { thrown = e.message.split('\n')[0].slice(0, 160); }
  await sleep(80); await idle(); await sleep(260); await idle(1500);
  const after = await ev('window.__H.snap()'), log = await logSince(n0), toasts = await ev('window.__H.toasts()'), modal = await ev('window.__H.modals().length'), opened = await ev('window.__H.opened.splice(0)');
  return { changed: before !== after, log, toasts, modal, opened, errs: [...errs], thrown };
}
const callNames = (log) => log.map((l) => (l.k === 'rpc' ? '' : l.k + ':') + l.n);
function classify(r, extra = {}) {
  const notes = [];
  if (r.thrown) notes.push('click threw: ' + r.thrown);
  if (r.errs.length) notes.push(...r.errs.slice(0, 2));
  const badToast = r.toasts.find((t) => BAD_TEXT.test(t.text)); if (badToast) notes.push('message shows a code error: ' + badToast.text.slice(0, 80));
  if (extra.stuck) notes.push('button left disabled');
  if (extra.errText && BAD_TEXT.test(extra.errText)) notes.push('dialog shows a code error: ' + extra.errText.slice(0, 80));
  let result = 'OK';
  if (notes.length) result = 'ERROR';
  else if (!r.log.length && !r.changed && !r.toasts.length && !r.modal && !r.opened.length) result = 'NO EFFECT';
  return { result, notes };
}
const summarize = (r) => ({ calls: callNames(r.log).join(', '), args: r.log.slice(0, 3).map((l) => JSON.stringify(l.a || {}).slice(0, 90)).join(' | '), toast: r.toasts.map((t) => (t.bad ? '[bad] ' : '') + t.text).join(' / ').slice(0, 120), dom: r.changed ? 'changed' : 'same', dialog: r.modal ? 'opened' : '', opened: r.opened.join(', ').slice(0, 60) });
const nameOf = (d) => d.tag + (d.attrs['data-act'] ? '[act=' + d.attrs['data-act'] + ']' : d.attrs['data-flow'] ? '[flow=' + d.attrs['data-flow'] + ']' : d.attrs['data-dispatch'] ? '[dispatch=' + d.attrs['data-dispatch'] + ']' : d.attrs['data-issue'] ? '[issue=' + d.attrs['data-issue'] + ']' : d.attrs['data-view'] ? '[view=' + d.attrs['data-view'] + ']' : d.attrs['data-tab'] ? '[tab=' + d.attrs['data-tab'] + ']' : d.attrs.id ? '#' + d.attrs.id : '');

const rows = [];
function add(scope, d, r, extra = {}) {
  const c = classify(r, extra);
  rows.push({ app: APP, persona: PERSONA, scope, element: nameOf(d), label: d.text || d.attrs['aria-label'] || '', ...summarize(r), result: c.result, notes: c.notes.join('; ') });
}

// Press every actionable element of a screen. reset() brings the screen back; scope is the CSS root to scan.
async function sweep(name, reset, scope, opts = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  if (!(await reset())) { rows.push({ app: APP, persona: PERSONA, scope: name, element: '(screen)', label: 'screen did not load', result: 'ERROR', notes: 'the wait selector never appeared', calls: '', args: '', toast: '', dom: '', dialog: '', opened: '' }); return; }
  const list = await ev(`window.__H.list(${JSON.stringify(scope)}).map((el, i) => Object.assign(window.__H.desc(el), { i }))`);
  const skip = opts.skip || (() => false);
  console.log(`${name}: ${list.length} elements`);
  for (const d of list) {
    if (skip(d)) continue;
    const pick = `(window.__H.list(${JSON.stringify(scope)})[${d.i}])`;
    let cur = await ev(`(()=>{const e=${pick};return e?JSON.stringify(window.__H.desc(e)):null})()`).catch(() => null);
    if (!cur || JSON.parse(cur).text !== d.text || JSON.parse(cur).tag !== d.tag) { if (!(await reset())) continue; cur = await ev(`(()=>{const e=${pick};return e?JSON.stringify(window.__H.desc(e)):null})()`).catch(() => null); if (!cur) continue; }
    const isSelect = d.tag === 'select';
    const js = isSelect ? `(()=>{const e=${pick};const o=[...e.options].find(x=>x.value&&x.value!==e.value)||e.options[e.options.length-1];e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));})()` : `${pick}.click()`;
    const r = await press(js);
    const extra = {};
    if (!isSelect && !r.modal) { const st = await ev(`(()=>{const e=${pick};return !!(e&&e.disabled&&window.__H.visible(e)&&e.type!=='radio'&&e.type!=='checkbox')})()`).catch(() => false); if (st && !d.disabled) extra.stuck = true; }
    add(name, d, r, extra);
    if (r.modal) await dialogs(name, d);
    await ev('window.__H.closeAll()').catch(() => {});
    if (r.changed || r.modal) await reset();
  }
}
// Fill and submit the open dialog; record the submit as its own row, then press the buttons of a result panel.
async function dialogs(name, d) {
  const n = await ev('window.__H.modals().length'); if (!n) return;
  const title = await ev(`(()=>{const f=window.__H.modals()[0];return f?((f.querySelector('h2,h3')||{}).textContent||'dialog'):''})()`);
  const hasSubmit = await ev(`!!(window.__H.modals()[0]&&window.__H.modals()[0].querySelector('button[type=submit]'))`);
  const label = 'via ' + (d.text || d.attrs['data-act'] || '');
  if (!hasSubmit) { await ev('window.__H.closeAll()'); return; }
  await ev('window.__H.fill(window.__H.modals()[0])');
  const before = await ev('window.__H.snap()'), n0 = await logLen(); errs = [];
  let thrown = null; try { await ev(`(()=>{const f=window.__H.modals()[0];f.requestSubmit?f.requestSubmit():f.dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}))})()`); } catch (e) { thrown = e.message.split('\n')[0]; }
  await sleep(80); await idle(); await sleep(300); await idle(1500);
  const after = await ev('window.__H.snap()'), log = await logSince(n0), toasts = await ev('window.__H.toasts()'), still = await ev('window.__H.modals().length'), opened = await ev('window.__H.opened.splice(0)');
  const errText = await ev(`(()=>{const f=window.__H.modals()[0];const e=f&&f.querySelector('.err,.flow-err');return e?e.textContent:''})()`);
  const stuck = await ev(`(()=>{const f=window.__H.modals()[0];const b=f&&f.querySelector('button[type=submit]');return !!(b&&b.disabled&&window.__H.visible(b))})()`);
  const r = { changed: before !== after, log, toasts, modal: 0, opened, errs: [...errs], thrown };
  const c = classify(r, { stuck, errText });
  let result = c.result; if (result === 'NO EFFECT' && errText) result = 'OK';   // a dialog that stays open with a plain-words reason is a visible, correct refusal
  rows.push({ app: APP, persona: PERSONA, scope: name, element: 'dialog "' + String(title).slice(0, 40) + '" submit', label, ...summarize(r), dialog: still ? 'stays open' + (errText ? ': ' + errText.slice(0, 70) : '') : 'closed', result, notes: c.notes.join('; ') });
  if (!still) return;
  const inner = await ev(`[...window.__H.modals()[0].querySelectorAll('button[type=button]:not([data-close])')].map(b=>b.textContent.trim().slice(0,30))`).catch(() => []);
  for (let i = 0; i < inner.length; i++) {
    const r2 = await press(`(window.__H.modals()[0].querySelectorAll('button[type=button]:not([data-close])')[${i}]).click()`);
    const c2 = classify(r2); rows.push({ app: APP, persona: PERSONA, scope: name, element: 'dialog "' + String(title).slice(0, 40) + '" button', label: inner[i], ...summarize(r2), result: c2.result, notes: c2.notes.join('; ') });
  }
}

/* ---------- Crew ---------- */
const CREW_SCREENS = ['dashboard', 'inbox', 'callnow', 'mine', 'dispatch', 'issues', 'unassigned', 'leads', 'web', 'rsa', 'tickets', 'visits', 'garages', 'mechanics', 'knowledge', 'team'];
const LEADS = [['lead-1', 'new, mine'], ['lead-2', 'contacted, overdue'], ['lead-3', 'quoted'], ['lead-4', 'advance link sent'], ['lead-5', 'paid'], ['lead-9', 'scheduled'], ['lead-10', 'completed'], ['lead-8', 'junk'], ['lead-15', 'new, unassigned']];
async function crew() {
  await sweep('crew shell', () => load(crewUrl('mine')), '.top, #tabs', { skip: (d) => d.attrs.id === 'signOut' });
  const allowed = await (async () => { await load(crewUrl('mine')); return ev(`[...document.querySelectorAll('#tabs [data-view]')].map(b=>b.dataset.view)`); })();
  rows.push({ app: APP, persona: PERSONA, scope: 'crew shell', element: 'tabs shown', label: allowed.join(', '), calls: '', args: '', toast: '', dom: '', dialog: '', opened: '', result: 'OK', notes: '' });
  for (const v of CREW_SCREENS) {
    if (!allowed.includes(v)) { rows.push({ app: APP, persona: PERSONA, scope: 'crew ' + v, element: '(screen)', label: 'hidden for this person', calls: '', args: '', toast: '', dom: '', dialog: '', opened: '', result: 'HIDDEN', notes: 'tab not shown by permission' }); continue; }
    await sweep('crew ' + v, () => load(crewUrl(v), { extra: true, wait: '#view > *:not(.mx-skeleton-group)' }), '#view');
  }
  for (const [lid, what] of LEADS) {
    const reset = async () => { const ok = await load(crewUrl('mine'), { extra: true, wait: `.lead-card[data-id="${lid}"]` }); if (!ok) return false; await ev(`document.querySelector('.lead-card[data-id="${lid}"] [data-act="open"]').click()`); for (let i = 0; i < 30; i++) { await sleep(120); if (await ev('!!document.querySelector("#sheetPanel .facts")')) break; } await idle(); await sleep(150); return true; };
    await sweep(`crew lead sheet ${lid} (${what})`, reset, '#sheetPanel');
    await sheetForms(lid, what, reset);
  }
}
// The "What happened?" form and the Won/Lost box, filled in each way a person would.
async function sheetForms(lid, what, reset) {
  const name = `crew lead sheet ${lid} (${what})`; if (ONLY && !name.includes(ONLY)) return;
  if (!(await reset())) return;
  const scen = [
    ['note only', `f.querySelector('[name=kind][value=note]').checked=true; f.body.value='Test note';`],
    ['I called + follow-up preset', `f.querySelector('[name=kind][value=call]').checked=true; f.body.value='Spoke to customer'; document.querySelector('[data-act=preset]').click();`],
    ['move to Quote sent', `f.status.value='quoted'; f.status.dispatchEvent(new Event('change',{bubbles:true})); f.body.value='Quote shared';`],
    ['move to Lost with reason', `f.status.value='lost'; f.status.dispatchEvent(new Event('change',{bubbles:true})); f.lost.value=f.lost.options[1].value;`],
    ['Schedule: technician, date, slot', `f.status.value='confirm'; f.status.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,500)); f.lfTech.value=f.lfTech.options[1]&&f.lfTech.options[1].value; f.lfDate.value=new Date(Date.now()+864e5*2).toISOString().slice(0,10); f.lfSlot.value='morning';`],
    ['Technician assigned (sub disposition)', `f.disp.value='Interested'; f.disp.dispatchEvent(new Event('change',{bubbles:true})); await new Promise(r=>setTimeout(r,100));`],
  ];
  const has = await ev('!!document.querySelector("#logForm")');
  if (has) for (const [nm, fill] of scen) {
    if (!(await reset())) continue;
    const r = await press(`(async()=>{const f=document.querySelector('#logForm'); if(!f) return; ${fill} f.requestSubmit();})()`);
    const err = await ev(`(document.querySelector('#logErr')||{}).textContent||''`);
    const stuck = await ev(`!!(document.querySelector('#logSave')&&document.querySelector('#logSave').disabled&&window.__H.visible(document.querySelector('#logSave')))`);
    const c = classify(r, { stuck, errText: err }); let result = c.result; if (result === 'NO EFFECT' && err) result = 'OK';
    rows.push({ app: APP, persona: PERSONA, scope: name, element: 'form#logForm submit', label: nm, ...summarize(r), dialog: err ? 'error line: ' + err.slice(0, 80) : '', result, notes: c.notes.join('; ') });
    if (r.modal) await dialogs(name, { text: nm, attrs: {} });
  }
  if (!(await reset())) return;
  if (await ev('!!document.querySelector("#outcomeBox")')) {
    for (const [nm, js] of [['Won', `document.querySelector('[data-act=won]').click()`], ['Lost with reason', `(async()=>{document.querySelector('[data-act=lostOpen]').click(); const s=document.querySelector('#oLost'); s.value=s.options[1].value; document.querySelector('[data-act=lostSave]').click();})()`]]) {
      if (!(await reset())) continue;
      const r = await press(js); if (r.modal) await dialogs(name, { text: nm, attrs: {} });
      const c = classify(r); rows.push({ app: APP, persona: PERSONA, scope: name, element: 'outcome box', label: nm, ...summarize(r), result: c.result, notes: c.notes.join('; ') });
    }
  }
  if (await reset() && await ev('!!document.querySelector("#replyForm")')) {
    const r = await press(`(()=>{document.querySelector('#replyText').value='Test reply'; document.querySelector('#replyForm').requestSubmit();})()`);
    const c = classify(r); rows.push({ app: APP, persona: PERSONA, scope: name, element: 'form#replyForm submit', label: 'Reply on WhatsApp', ...summarize(r), result: c.result, notes: c.notes.join('; ') });
  }
}

/* ---------- Admin ---------- */
const ADMIN_TABS = ['dash', 'board', 'dispatch', 'leads', 'customers', 'custbook', 'issues', 'sales', 'mechledger', 'invoices', 'reports', 'coupons', 'prices', 'mechanics', 'pins', 'offers', 'waitlist', 'homeimgs', 'settings', 'activity'];
const clickTab = (t) => `(async()=>{const b=document.querySelector('#side [data-tab="${t}"]'); if(!b) return; const g=b.closest('[data-sub]'); if(g&&g.hidden){const gb=document.querySelector('[data-group="'+g.dataset.sub+'"]'); if(gb) gb.click();} await new Promise(r=>setTimeout(r,60)); b.click();})()`;
const adminLoad = (tab) => async () => { const ok = await load(ADMIN, { wait: '#view:not([hidden]) > *', extra: true }); if (tab && tab !== 'dash') { await ev(clickTab(tab)); await idle(); await sleep(250); await idle(); } return ok; };
async function admin() {
  await sweep('admin shell', adminLoad(null), '#side, .top', { skip: (d) => /signOut|forgot/.test(d.attrs.id || '') });
  for (const t of ADMIN_TABS) await sweep('admin ' + t, adminLoad(t), '#view');
  for (const [lid, what] of LEADS.slice(0, 5)) {
    const reset = async () => { const ok = await adminLoad('leads')(); if (!ok) return false; await ev(`(()=>{const s=document.querySelector('#fs'); if(s){s.value='all'; s.dispatchEvent(new Event('change',{bubbles:true}));}})()`); await idle(); await sleep(200); if (!(await ev(`!!document.querySelector('[data-lead="${lid}"]')`))) return false; await ev(`document.querySelector('[data-lead="${lid}"]').click()`); for (let i = 0; i < 30; i++) { await sleep(120); if (await ev('!!document.querySelector("#sheetPanel .card")')) break; } await idle(); await sleep(250); await idle(); return true; };
    await sweep(`admin booking sheet ${lid} (${what})`, reset, '#sheetPanel');
  }
}

try { if (APP === 'crew') await crew(); else await admin(); } catch (e) { rows.push({ app: APP, persona: PERSONA, scope: 'harness', element: '(run)', label: 'harness stopped', result: 'ERROR', notes: String(e.message).slice(0, 200), calls: '', args: '', toast: '', dom: '', dialog: '', opened: '' }); }
const count = (r) => rows.filter((x) => x.result === r).length;
writeFileSync(join(OUT, `clicks-${APP}-${PERSONA}.json`), JSON.stringify({ app: APP, persona: PERSONA, total: rows.length, ok: count('OK'), noEffect: count('NO EFFECT'), error: count('ERROR'), hidden: count('HIDDEN'), rows }, null, 1));
console.log(`\n${APP}/${PERSONA}: ${rows.length} rows. OK ${count('OK')}, NO EFFECT ${count('NO EFFECT')}, ERROR ${count('ERROR')}, hidden screens ${count('HIDDEN')}`);
cleanup(); process.exit(0);
