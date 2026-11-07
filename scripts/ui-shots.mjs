#!/usr/bin/env node
// Screenshot harness for Crew (crm/) and Admin (admin/). Serves the repo statically with the REAL Content-Security-Policy from scripts/build_crm.sh and
// scripts/build_admin.sh, swaps the Supabase client for tests/ui/supabase-stub.js (fixtures, placeholders only), blocks every other outside request,
// drives headless Chrome over the DevTools protocol (no dependencies) and writes 390px and 1280px PNGs plus console.json (console errors, CSP violations, blocked requests).
// Usage: node scripts/ui-shots.mjs --out <dir> [--only <substring>] [--chrome <path>]
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join, extname, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > -1 ? process.argv[i + 1] : d; };
const OUT = arg('out'), ONLY = arg('only', '');
const CHROME = arg('chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
if (!OUT) { console.error('Usage: node scripts/ui-shots.mjs --out <dir> [--only <substring>]'); process.exit(2); }
mkdirSync(OUT, { recursive: true });

const cspOf = (f) => (readFileSync(join(root, 'scripts', f), 'utf8').match(/Content-Security-Policy: (.*)/) || [])[1];
const CSP = { crm: cspOf('build_crm.sh'), admin: cspOf('build_admin.sh') };
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const FAKE_CONFIG = "window.MXP = { supabaseUrl: 'https://harness.invalid', supabaseAnonKey: 'harness', whatsapp: '910000000000', callNumber: '910000000000' };";

// Harness-only workaround. Until it is fixed in admin/admin.js, flow.bind(...) runs before `const flow = createFlow(...)` (a temporal-dead-zone error that stops the whole module).
// If that is still the case, move those three lines to the end so the page can be photographed. When the source is fixed this is a no-op.
function patchAdmin(src) {
  const lines = src.split('\n'); const at = lines.findIndex((l) => /^flow\.bind\(/.test(l)), def = lines.findIndex((l) => /^const flow = createFlow\(/.test(l));
  if (at < 0 || def < 0 || at > def) return src;
  const moved = lines.splice(at, 3); return lines.join('\n') + '\n' + moved.join('\n') + '\n';
}
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let p = decodeURIComponent(url.pathname);
  if (p === '/assets/js/config.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end(FAKE_CONFIG); }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404); return res.end('not found'); }
  if (p === '/admin/admin.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(patchAdmin(readFileSync(f, 'utf8'))); }
  const h = { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  const app = p.startsWith('/crm/') ? 'crm' : p.startsWith('/admin/') ? 'admin' : null;
  if (app && f.endsWith('index.html') && CSP[app]) h['content-security-policy'] = CSP[app];   // the same policy the live site sends
  res.writeHead(200, h); res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const profile = mkdtempSync(join(tmpdir(), 'mxp-shots-'));
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

let log = []; let blocked = new Set(); let current = '';
listeners.push((d) => {
  if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) log.push({ shot: current, type: d.params.type, text: d.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300) });
  if (d.method === 'Runtime.exceptionThrown') log.push({ shot: current, type: 'exception', text: (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text).slice(0, 300) });
  if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) log.push({ shot: current, type: 'log-' + d.params.entry.level, text: (d.params.entry.text + ' ' + (d.params.entry.url || '')).slice(0, 300) });
  if (d.method === 'Fetch.requestPaused') {
    const u = new URL(d.params.request.url); const rid = d.params.requestId;
    if (u.hostname === '127.0.0.1') return send('Fetch.continueRequest', { requestId: rid }).catch(() => {});
    if (/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/.test(d.params.request.url)) return send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: 'text/javascript' }, { name: 'access-control-allow-origin', value: '*' }], body: Buffer.from(`export * from '${BASE}/tests/ui/supabase-stub.js';`).toString('base64') }).catch(() => {});
    blocked.add(d.params.request.url);
    return send('Fetch.fulfillRequest', { requestId: rid, responseCode: 200, responseHeaders: [{ name: 'content-type', value: u.pathname.endsWith('.css') || /css/.test(u.search) ? 'text/css' : 'text/plain' }], body: '' }).catch(() => {});
  }
});
await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable'); await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });

/* ---------- the screens ---------- */
const clickTab = (t) => `(async()=>{const b=document.querySelector('#side [data-tab="${t}"]'); const g=b&&b.closest('[data-sub]'); if(g&&g.hidden){document.querySelector('[data-group="'+g.dataset.sub+'"]').click();} await new Promise(r=>setTimeout(r,60)); b.click();})()`;
const crew = (name, hash, o = {}) => ({ name: 'crew-' + name, app: 'crm', url: '/crm/#' + hash, wait: '#view > div > *, #view .alert, #view .err', ...o });
const adm = (name, tab, o = {}) => ({ name: 'admin-' + name, app: 'admin', url: '/admin/', wait: '#view:not([hidden]) > *, #view .err', step: tab ? clickTab(tab) : null, ...o });
const SHOTS = [
  crew('dashboard', 'dashboard'), crew('myday', 'mine'), crew('callnow', 'callnow'), crew('leads', 'leads'), crew('dispatch', 'dispatch'), crew('issues', 'issues'),
  crew('leadsheet', 'mine', { step: `document.querySelector('.lead-card[data-id="lead-5"] [data-act="open"]').click()`, after: '#sheetPanel .flow-card', noFull: true }),
  crew('myday-scrolled', 'mine', { scroll: 420, only390: true }),
  crew('myday-empty', 'mine', { scenario: 'empty' }), crew('callnow-empty', 'callnow', { scenario: 'empty' }), crew('leads-empty', 'leads', { scenario: 'empty' }), crew('dispatch-empty', 'dispatch', { scenario: 'empty' }), crew('issues-empty', 'issues', { scenario: 'empty' }), crew('dashboard-empty', 'dashboard', { scenario: 'empty' }),
  crew('dispatch-loading', 'dispatch', { scenario: 'loading', wait: '#view .skel, #view .mx-skeleton', hold: 300 }), crew('issues-loading', 'issues', { scenario: 'loading', wait: '#view .skel, #view .mx-skeleton', hold: 300 }),
  crew('dispatch-error', 'dispatch', { scenario: 'error' }), crew('dashboard-error', 'dashboard', { scenario: 'error' }),
  crew('leadsheet-card', 'mine', { step: `document.querySelector('.lead-card[data-id="lead-5"] [data-act="open"]').click()`, after: '#sheetPanel .flow-card', reveal: '#sheetPanel .flow-card', noFull: true }),
  crew('leadsheet-card-flowerror', 'mine', { fail: ['crm_confirmation', 'crm_quote_get'], step: `document.querySelector('.lead-card[data-id="lead-5"] [data-act="open"]').click()`, after: '#sheetPanel .flow-card', reveal: '#sheetPanel .flow-card', noFull: true }),
  crew('leadsheet-flowerror', 'mine', { fail: ['crm_confirmation', 'crm_quote_get'], step: `document.querySelector('.lead-card[data-id="lead-5"] [data-act="open"]').click()`, after: '#sheetPanel .flow-card', noFull: true }),
  adm('dashboard', null), adm('bookings', 'leads'), adm('dispatch', 'dispatch'), adm('issues', 'issues'), adm('money-sales', 'sales'), adm('money-prices', 'prices'),
  adm('bookings-empty', 'leads', { scenario: 'empty' }), adm('dispatch-empty', 'dispatch', { scenario: 'empty' }), adm('issues-empty', 'issues', { scenario: 'empty' }),
  adm('boot-error', null, { fail: ['leads'], wait: '#view .load-err, #view .mx-error', hold: 500 }), adm('boot-partial', null, { fail: ['ledger_entries'], hold: 300 }), adm('boot-loading', null, { hang: ['leads'], wait: '#view .skel, #view .mx-skeleton', hold: 400 }),
  adm('dispatch-error', 'dispatch', { fail: ['crm_dispatch_list'] }),
  adm('board-dense', 'board', { scenario: 'dense' }), adm('customers-dense', 'customers', { scenario: 'dense' }), adm('custbook-dense', 'custbook', { scenario: 'dense' }), adm('bookings-dense', 'leads', { scenario: 'dense' }),
  adm('conversion', 'conversion', { wait: '#fnBody .fn-table' }), adm('conversion-empty', 'conversion', { scenario: 'empty', wait: '#fnBody .mx-empty, #fnBody .fn-table' }), adm('conversion-error', 'conversion', { fail: ['crm_funnel'], wait: '#fnBody .mx-error' }),
  adm('quote-page', 'leads', { step: clickTab('leads') + `;(async()=>{const w=(f)=>new Promise(async r=>{for(let i=0;i<80&&!f();i++)await new Promise(x=>setTimeout(x,100));r()});await w(()=>document.getElementById('fs'));const fs=document.getElementById('fs');fs.value='all';fs.dispatchEvent(new Event('change',{bubbles:true}));await w(()=>document.querySelector('[data-lead="lead-5"]'));document.querySelector('[data-lead="lead-5"]').click();await w(()=>document.querySelector('[data-flow="quoteDoc"]'));document.querySelector('[data-flow="quoteDoc"]').click();})()`, wait: '#inv .qd', noFull: true }),
  adm('invoices-missing', 'invoices'), adm('invoices-missing-dialog', 'invoices', { step: clickTab('invoices') + `;(async()=>{for(let i=0;i<60&&!document.querySelector('[data-act="invMissingOpen"]');i++)await new Promise(r=>setTimeout(r,100));document.querySelector('[data-act="invMissingOpen"]').click()})()`, after: '#imiss .imiss-row', noFull: true }),
  ...['inbox', 'unassigned', 'web', 'rsa', 'tickets', 'visits', 'garages', 'garageapp', 'mechanics', 'knowledge', 'team'].map((v) => crew('tab-' + v, v, { wait: '#view > *' })),
  ...['dash', 'board', 'dispatch', 'leads', 'customers', 'custbook', 'issues', 'sales', 'mechledger', 'invoices', 'conversion', 'reports', 'coupons', 'prices', 'mechanics', 'garageapp', 'pins', 'offers', 'waitlist', 'homeimgs', 'settings', 'activity'].map((t) => adm('tab-' + t, t)),
];
SHOTS.push(...['sales', 'mechledger', 'invoices', 'reports'].map((t) => adm('mt-' + t, t, { money: true })));
SHOTS.push(adm('mt-sales-right', 'sales', { money: true, step: `(async()=>{await ${clickTab('sales')};await new Promise(r=>setTimeout(r,600));const s=document.querySelector('.mt-scroll');if(s)s.scrollLeft=99999})()` }));
SHOTS.push(adm('mt-mlopen', 'mechledger', { money: true, step: `(async()=>{await ${clickTab('mechledger')};await new Promise(r=>setTimeout(r,500));const b=document.querySelector('[data-act="mlOpen"]');if(b)b.click()})()` }));
const SIZES = [{ w: 390, h: 844, dpr: 2, mobile: true }, { w: 1280, h: 800, dpr: 1, mobile: false }];

const summary = [];
for (const s of SHOTS) {
  if (ONLY && !s.name.includes(ONLY)) continue;
  for (const z of SIZES) {
    if (s.only390 && z.w !== 390) continue;
    current = s.name + '@' + z.w;
    await send('Emulation.setDeviceMetricsOverride', { width: z.w, height: z.h, deviceScaleFactor: z.dpr, mobile: z.mobile });
    await send('Emulation.setEmulatedMedia', { media: 'screen', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }, { name: 'prefers-color-scheme', value: 'light' }] });
    await send('Page.navigate', { url: 'about:blank' }); await sleep(50);
    const { identifier } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__UI=${JSON.stringify({ scenario: s.scenario || 'ok', fail: s.fail || [], hang: s.hang || [], money: !!s.money })};try{sessionStorage.clear();localStorage.clear()}catch(e){}` });
    await send('Page.navigate', { url: BASE + s.url });
    let ok = false;
    for (let i = 0; i < 60 && !ok; i++) { await sleep(150); ok = await ev(`!!document.querySelector(${JSON.stringify(s.wait)})`).catch(() => false); }
    await sleep(350);
    if (s.step) {
      try { await ev(s.step); } catch (e) { log.push({ shot: current, type: 'step-failed', text: e.message.slice(0, 200) }); }
      if (s.after) { let got = false; for (let i = 0; i < 40 && !got; i++) { await sleep(150); got = await ev(`!!document.querySelector(${JSON.stringify(s.after)})`).catch(() => false); } if (!got) ok = false; }
      if (s.reveal) await ev(`(document.querySelector(${JSON.stringify(s.reveal)})||document.body).scrollIntoView({block:'start'})`).catch(() => {});
      await sleep(450);
    }
    if (s.hold) await sleep(s.hold);
    if (s.scroll) { await ev(`window.scrollTo(0,${s.scroll})`); await sleep(200); }
    const dims = await ev('({h:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),sw:document.documentElement.scrollWidth,cw:document.documentElement.clientWidth})');
    const full = !s.scroll && !s.noFull; const h = full ? Math.min(dims.h, 2600) : z.h;
    const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: full, clip: full ? { x: 0, y: 0, width: z.w, height: Math.max(h, z.h), scale: 1 } : undefined });
    const file = `${s.name}-${z.w}.png`; writeFileSync(join(OUT, file), Buffer.from(shot.data, 'base64'));
    summary.push({ file, overflowX: dims.sw > dims.cw, ready: ok });
    console.log((ok ? 'ok   ' : 'WAIT ') + file + (dims.sw > dims.cw ? '  (horizontal overflow ' + dims.sw + '>' + dims.cw + ')' : ''));
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
}
const seen = new Set(); const uniq = log.filter((l) => { const k = l.type + l.text; if (seen.has(k)) return false; seen.add(k); return true; });
writeFileSync(join(OUT, 'console.json'), JSON.stringify({ errors: uniq, blockedExternalRequests: [...blocked], shots: summary }, null, 2));
console.log(`\n${summary.length} screenshots in ${OUT}\nconsole entries (unique): ${uniq.length}${uniq.length ? '  see console.json' : ''}\nblocked external requests: ${[...blocked].join(', ') || 'none'}`);
cleanup(); process.exit(0);
