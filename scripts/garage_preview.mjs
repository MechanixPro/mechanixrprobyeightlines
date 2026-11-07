// Drives the real /garage/ page in headless Chrome against a LOCAL fake backend (nothing leaves this machine, no Supabase, no real data).
// - serves the repo with the real CSP from _headers (plus the strict /garage/* one), rewrites config.js to point at itself;
// - the fake garage-app endpoint uses the REAL serializers from supabase/functions/_shared/garage.ts and a fake in-memory database (leads carry placeholder phone, address and email);
// - takes screenshots at 390 and 1280 wide for every screen and state, and checks that the customer's address and email never appear in any response, the DOM or the screenshots' page text,
//   and that the phone appears only in the detail of an open job.
// Usage: node scripts/garage_preview.mjs [outDir]    (default ~/Projects/garage-app-preview)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { garageJobListItem, garageJobDetail, garageStatement, garageDashboard, cleanLocation, isOpen, cleanEstimate, signSession, verifySession } from '../supabase/functions/_shared/garage.ts';

const ROOT = new URL('..', import.meta.url).pathname, OUT = process.argv[2] || join(homedir(), 'Projects/garage-app-preview');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '9000000000', ADDRESS = 'PLACEHOLDER-ADDRESS-LINE 12', EMAIL = 'placeholder.person@example.invalid', PORT = 4173, CDP = 9333, TOK = 'ab12'.repeat(12), PIN = '4821', SECRET = 'preview-secret-0123456789';
mkdirSync(OUT, { recursive: true });

/* ---------- fake database ---------- */
const lead = (n, name, vehicle) => ({ id: 'L' + n, name, phone: PHONE, email: EMAIL, address: ADDRESS, area: ADDRESS, notes: `${PHONE} ${EMAIL}`, booking_id: 'MP-26-27-000' + n, vehicle: vehicle || 'bike', confirm_fee: 49 });
const A = (n, status, extra = {}) => ({ id: `00000000-0000-0000-0000-00000000000${n}`, lead_id: 'L' + n, status, eta: '2026-11-09T09:30:00Z', notes: 'Front brake pads worn, chain loose.', assigned_at: '2026-11-07T04:00:00Z', ...extra });
function seed() {
  return {
    jobs: [
      { assignment: A(1, 'sent'), lead: lead(1, 'Asha Rao'), service: 'Full bike service', vehicle: { brand: 'Honda', model: 'Activa 6G', reg_no: 'KA01AB0001' }, quote: { status: 'approved' }, issue: 'Makes a noise when braking. Call me on 90000 00000.', pickup: { note: 'Scratch on the left mirror. Key handed over.', photos: ['/ph/1.svg', '/ph/2.svg'] }, progress: [], estimates: [] },
      { assignment: A(2, 'received'), lead: lead(2, 'Vikram Shah'), service: 'Brake and clutch repair', vehicle: { brand: 'Royal Enfield', model: 'Classic 350', reg_no: 'KA05CD0002' }, quote: { status: 'sent' }, issue: 'Clutch slips on the hill.', pickup: { note: null, photos: [] },
        progress: [{ event: 'received', at: '2026-11-07T05:10:00Z', note: 'Received with all mirrors', photos: ['/ph/1.svg'] }], estimates: [] },
      { assignment: A(3, 'in_work'), lead: lead(3, 'Meera Iyer'), service: 'Chain and sprocket change', vehicle: { brand: 'TVS', model: 'Apache RTR 160', reg_no: null }, quote: { status: 'approved' }, issue: null, pickup: null,
        progress: [{ event: 'received', at: '2026-11-07T05:10:00Z', note: null, photos: [] }, { event: 'work_started', at: '2026-11-07T06:00:00Z', note: 'Parts arrived', photos: ['/ph/2.svg'] }],
        estimates: [{ id: 'e1', status: 'rejected', lines: [{ kind: 'parts', name: 'Chain kit', amount: 2400 }, { kind: 'labour', name: 'Fit and align', amount: 600 }], notes: 'Genuine kit', hours: 5, review_note: 'Please quote the standard kit.' }, { id: 'e2', status: 'converted', lines: [{ kind: 'parts', name: 'Chain kit standard', amount: 1500 }, { kind: 'labour', name: 'Fit and align', amount: 500 }], hours: 4 }] },
      { assignment: A(4, 'ready', { ready_at: '2026-11-07T09:00:00Z' }), lead: lead(4, 'Rahul Nair'), service: 'Oil change', vehicle: { brand: 'Bajaj', model: 'Pulsar 150', reg_no: 'KA03EF0004' }, quote: { status: 'approved' }, issue: null, pickup: null, progress: [{ event: 'ready', at: '2026-11-07T09:00:00Z', note: null, photos: [] }], estimates: [] },
      { assignment: A(5, 'returned', { returned_at: '2026-11-06T12:00:00Z' }), lead: lead(5, 'Sana Khan', 'car'), service: 'Car service', vehicle: { brand: 'Maruti', model: 'Swift' }, quote: { status: 'approved' }, issue: null, pickup: null, progress: [], estimates: [] },
      { assignment: A(6, 'returned', { returned_at: '2026-11-05T12:00:00Z' }), lead: lead(6, 'Arun Pillai'), service: 'Brake pads', vehicle: { brand: 'Yamaha', model: 'FZ-S' }, quote: { status: 'approved' }, issue: null, pickup: null, progress: [], estimates: [] },
    ],
    garage: { name: 'Test Garage Koramangala', city: 'Bengaluru', is_open: true, shop_loc_at: null },
    settlements: { '00000000-0000-0000-0000-000000000005': { amount: 1850, settled: true, settled_at: '2026-11-08T05:00:00Z', note: 'Paid by bank transfer' }, '00000000-0000-0000-0000-000000000004': { amount: 640, settled: false } },
  };
}
let DB = seed(), MODE = {}, wrong = 0; const LOCS = []; const LOG = [], ALL = [];
const reset = (m = {}) => { DB = seed(); MODE = m; wrong = 0; LOG.length = 0; LOCS.length = 0; };
const send = (res, status, body) => { const s = JSON.stringify(body); LOG.push({ status, body: s }); ALL.push({ status, body: s }); res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(s); };
async function api(b, res) {
  const a = b.action;
  if (MODE.delay) await new Promise((r) => setTimeout(r, MODE.delay));
  if (a === 'login') {
    if (b.token !== TOK) return send(res, 404, { error: 'This link is not valid. Ask Mechanix Pro for a new one.', code: 'link' });
    if (MODE.off) return send(res, 403, { error: 'This garage access is switched off. Please contact Mechanix Pro.', code: 'off' });
    if (MODE.locked || wrong >= 5) return send(res, 423, { error: 'Too many wrong PINs. Try again in 15 minutes.', code: 'locked' });
    if (b.pin !== PIN) { wrong++; return send(res, 401, { error: 'That PIN is not right.', code: 'pin', left: 5 - wrong }); }
    const s = await signSession(SECRET, { access: 'A1', garage: 'G1', version: 1 });
    return send(res, 200, { ok: true, session: s.token, expires_at: s.expires_at, garage: { name: 'Test Garage Koramangala', label: 'Owner' } });
  }
  if (!(await verifySession(SECRET, b.session)) || MODE.ended) return send(res, 401, { error: 'Your session has ended. Enter your PIN again.', code: 'session' });
  if (a === 'team_contact') return send(res, 200, { ok: true, whatsapp: null, call: null });
  if (a === 'dashboard') {
    if (MODE.dashFail) { MODE.dashFail--; return send(res, 500, { error: 'Could not load your dashboard. Please try again.' }); }
    return send(res, 200, { ok: true, dashboard: garageDashboard({ today: '2026-11-07', garage: DB.garage, rows: DB.jobs.map((j) => ({ assignment: j.assignment, lead: j.lead, vehicle: j.vehicle, settlement: DB.settlements[j.assignment.id] ?? null })) }) });
  }
  if (a === 'location_set') { const v = cleanLocation(b); if (!v.ok) return send(res, 400, { error: 'That location does not look right.' }); DB.garage.shop_loc_at = '2026-11-07T10:00:00Z'; LOCS.push(v); return send(res, 200, { ok: true, at: DB.garage.shop_loc_at }); }
  if (a === 'open_set') { DB.garage.is_open = b.open === true; return send(res, 200, { ok: true, open: DB.garage.is_open }); }
  if (a === 'jobs') {
    if (MODE.jobsFail) { MODE.jobsFail--; return send(res, 500, { error: 'Could not load your jobs. Please try again.' }); }
    if (MODE.empty) return send(res, 200, { ok: true, garage: { name: 'Test Garage Koramangala' }, jobs: [] });
    return send(res, 200, { ok: true, garage: { name: 'Test Garage Koramangala' }, jobs: DB.jobs.map(garageJobListItem) });
  }
  if (a === 'statement') {
    if (MODE.stFail) return send(res, 500, { error: 'x' });
    return send(res, 200, { ok: true, statement: garageStatement(DB.jobs.filter((j) => ['ready', 'returned'].includes(j.assignment.status)).map((j) => ({ assignment: j.assignment, lead: j.lead, vehicle: j.vehicle, settlement: DB.settlements[j.assignment.id] ?? null }))) });
  }
  const j = DB.jobs.find((x) => x.assignment.id === b.id);
  if (!j) return send(res, 404, { error: 'This job is not available.' });
  if (a === 'job') {
    if (MODE.jobFail) { MODE.jobFail--; return send(res, 500, { error: 'Could not load the job.' }); }
    const contact = isOpen(j.assignment.status) && !MODE.limited;
    return send(res, 200, { ok: true, job: { ...garageJobDetail(j, contact), contact_limited: !!MODE.limited && isOpen(j.assignment.status) } });
  }
  if (a === 'photo_upload_url') return send(res, 200, { ok: true, uploads: b.types.map((t, i) => ({ path: `G1/${j.assignment.id}/aaaaaaaa-aaaa-aaaa-aaaa-00000000000${i}.jpg`, url: `http://localhost:${PORT}/upload/${i}` })) });
  if (a === 'progress') {
    const st = j.assignment.status, to = { received: 'received', work_started: 'in_work', ready: 'ready' }[b.event];
    if (b.event === 'work_started' && j.quote?.status !== 'approved') return send(res, 409, { error: 'The customer has not approved the quote yet. Send your estimate. Work can start once the customer approves.', blocked: 'quote' });
    j.assignment.status = to; j.progress.push({ event: b.event, at: new Date().toISOString(), note: b.note, photos: b.photos.length ? ['/ph/1.svg'] : [] }); void st;
    return send(res, 200, { ok: true, status: to });
  }
  if (a === 'estimate_submit') {
    const v = cleanEstimate(b); if (!v.ok) return send(res, 400, { error: v.error });
    j.estimates.unshift({ id: 'e' + Date.now(), status: 'submitted', lines: v.value.lines, notes: v.value.notes, hours: v.value.hours, return_day: v.value.day, submitted_at: new Date().toISOString() });
    return send(res, 200, { ok: true, submitted: true });
  }
  return send(res, 400, { error: 'Unknown action' });
}

/* ---------- static server with the real headers ---------- */
function headersFor(path) {
  const txt = readFileSync(join(ROOT, '_headers'), 'utf8'), out = []; let cur = null;
  for (const line of txt.split('\n')) { if (/^\S/.test(line)) cur = { pat: line.trim(), h: [] }, out.push(cur); else if (cur && line.trim()) { const i = line.indexOf(':'); cur.h.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); } }
  const hs = [];
  for (const b of out) { const re = new RegExp('^' + b.pat.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); if (re.test(path)) hs.push(...b.h); }
  return hs;
}
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const PH = (n) => `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="${n === '1' ? '#c9d3e6' : '#e9d3bd'}"/><text x="80" y="88" font-size="22" text-anchor="middle" fill="#334">photo ${n}</text></svg>`;
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p = u.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' }); return res.end(); }
  if (p === '/functions/v1/garage-app') { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => api(JSON.parse(s || '{}'), res)); return; }
  if (p.startsWith('/upload/')) { req.resume(); res.writeHead(200, { 'Access-Control-Allow-Origin': '*' }); return res.end('{}'); }
  const ph = /^\/ph\/(\d)\.svg$/.exec(p); if (ph) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(PH(ph[1])); }
  if (p.endsWith('/')) p += 'index.html'; let f = join(ROOT, p);
  if (!f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  let body = readFileSync(f);
  if (p === '/assets/js/config.js') body = Buffer.from(String(body).replace(/supabaseUrl: '[^']*'/, `supabaseUrl: 'http://localhost:${PORT}'`).replace(/whatsapp: '\d+'/, "whatsapp: '910000000001'").replace(/callNumber: '\d+'/, "callNumber: '910000000002'").replace(/phoneDisplay: '[^']*'/, "phoneDisplay: '+91 00000 00002'"));
  const h = headersFor(u.pathname); const csps = h.filter(([k]) => /^content-security-policy$/i.test(k)).map(([, v]) => v.replace('https://mejdxsbpyscujpvbwvmg.supabase.co', `http://localhost:${PORT}`).replace(/wss:\/\/mejdxsbpyscujpvbwvmg\.supabase\.co/g, ''));
  res.setHeader('Content-Type', TYPES[extname(f)] || 'application/octet-stream');
  for (const [k, v] of h) if (!/^content-security-policy$/i.test(k) && !/^strict-transport/i.test(k)) res.setHeader(k, v);
  if (csps.length) res.setHeader('Content-Security-Policy', csps);   // several policies are all enforced, like Cloudflare does
  res.end(body);
});
await new Promise((r) => server.listen(PORT, r));

/* ---------- Chrome over CDP ---------- */
const prof = join(tmpdir(), 'mxg-chrome-' + process.pid);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${CDP}`, `--user-data-dir=${prof}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--allow-insecure-localhost', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let wsUrl; for (let i = 0; i < 60 && !wsUrl; i++) { try { const l = await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json(); wsUrl = l.find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch { await sleep(250); } }
if (!wsUrl) throw new Error('Chrome did not start');
const ws = new WebSocket(wsUrl); await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(), consoleErrors = [], cspViolations = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(d.error.message)) : res(d.result); }
  else if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text);
  else if (d.method === 'Log.entryAdded' && /Content Security Policy|Refused/i.test(d.params.entry.text)) cspViolations.push(d.params.entry.text.slice(0, 200)); };
const cdp = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error('page: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text)); return r.result.value; };
const until = async (expr, what, ms = 6000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr).catch(() => false)) return; await sleep(60); } throw new Error('timeout waiting for ' + what + '\n' + (await ev('document.body.innerText').catch(() => '')).slice(0, 400)); };
await cdp('Browser.grantPermissions', { permissions: ['geolocation'], origin: `http://localhost:${PORT}` }).catch(() => {}); await cdp('Emulation.setGeolocationOverride', { latitude: 12.9716, longitude: 77.5946, accuracy: 25 }); await cdp('Page.enable'); await cdp('Runtime.enable'); await cdp('Log.enable');
const page = { cur: null };
async function open(path, { store = true, session = false } = {}) {
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/offline.html` }); await sleep(200);   // a same-origin page that is not the app: clear the phone's storage before the app can read it
  await ev(`localStorage.clear(); ${store ? `localStorage.setItem('mxp_garage_link','${TOK}')` : ''}; 0`);
  await cdp('Page.navigate', { url: `http://localhost:${PORT}${path}` }); await until(`!!document.querySelector('.g-top')`, 'the app shell');
  if (session) { await login(); }
}
const setPin = (pin) => ev(`(() => { const i = document.getElementById('gpin'); i.value = '${pin}'; document.querySelector('form').requestSubmit(); return true })()`);
async function login() { await setPin(PIN); await until(`!!document.getElementById('dGet')`, 'the home screen'); await sleep(200); await click('#dGet'); await until(`!!document.querySelector('.g-seg')`, 'the jobs list'); }
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ${sel.replace(/'/g, '')}'); e.click(); return true })()`);
const clickText = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!e) throw new Error('no ${text}'); e.click(); return true })()`);
const openJobBy = async (text) => { await clickText('.g-row-job', text); await until(`!!document.querySelector('.g-jh')`, 'the job'); };
const domText = () => ev('document.documentElement.outerHTML');

/* ---------- scenarios ---------- */
const shots = []; let W = 390, H = 844, tag = '390';
async function snap(name) {
  await sleep(150);
  const html = await domText();
  if (html.includes(ADDRESS) || html.includes(EMAIL)) throw new Error(`address or email in the DOM at ${name}`);
  const full = await cdp('Page.getLayoutMetrics'), h = Math.min(4000, Math.ceil(full.cssContentSize?.height || full.contentSize.height));
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.max(H, h), scale: 1 } });
  writeFileSync(join(OUT, `${tag}-${name}.png`), Buffer.from(r.data, 'base64')); shots.push(`${tag}-${name}`);
}
async function run() {
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  reset(); await open('/garage/', { store: false }); await snap('01-no-link');
  reset(); await open('/garage/'); await snap('02-pin');
  await setPin('1111'); await until(`document.querySelector('.g-note-err')`, 'wrong pin message'); await snap('03-pin-wrong');
  reset({ locked: true }); await open('/garage/'); await setPin(PIN); await until(`document.querySelector('.g-note-err')`, 'locked'); await snap('04-pin-locked');
  reset({ off: true }); await open('/garage/'); await setPin(PIN); await until(`document.querySelector('.g-note-err')`, 'off'); await snap('05-pin-off');
  reset({ delay: 900 }); await open('/garage/'); await setPin(PIN); await until(`document.querySelector('.g-loading')`, 'loading'); await snap('06-home-loading'); await until(`!!document.getElementById('dGet')`, 'home', 8000);
  reset({ dashFail: 1 }); await open('/garage/'); await setPin(PIN); await until(`[...document.querySelectorAll('.g-card button')].some((b) => b.textContent === 'Retry')`, 'retry card'); await snap('07-home-error');
  await clickText('.g-card button', 'Retry'); await until(`!!document.getElementById('dGet')`, 'home after retry');
  reset({ empty: true }); await open('/garage/'); await login(); await snap('08-jobs-empty');
  reset(); await open('/garage/'); await login(); await snap('09-jobs-open');
  await clickText('.g-seg-b', 'Ready'); await snap('10-jobs-ready'); await clickText('.g-seg-b', 'Done'); await snap('11-jobs-done');
  // job screens
  await clickText('.g-seg-b', 'Open');
  await openJobBy('Activa'); await snap('12-job-new'); const t = await ev(`document.body.innerText`); if (!t.includes('+91 90000 00000') || !(await ev(`document.getElementById('gCallCustomer').getAttribute('href')`)).startsWith('tel:+9190000')) throw new Error('call customer missing on an open job');
  await click('#gProgress'); await until(`document.querySelector('.g-chip-received')`, 'received'); await snap('13-job-received-after-tap');
  await click('.g-back'); await until(`!!document.querySelector('.g-seg')`, 'list'); await openJobBy('Classic'); await until(`document.getElementById('gProgress') && document.getElementById('gProgress').disabled`, 'blocked'); await snap('14-job-blocked-quote');
  await click('.g-back'); await until(`!!document.querySelector('.g-seg')`, 'list'); await openJobBy('Apache'); await snap('15-job-in-work-estimates');
  await click('#gProgress'); await until(`document.getElementById('gConfirmYes')`, 'confirm'); await snap('16-job-ready-confirm');
  await click('#gConfirmYes'); await until(`document.querySelector('.g-chip-ready')`, 'ready chip'); await snap('17-job-ready-done');
  // estimate form
  await click('.g-back'); await until(`!!document.querySelector('.g-seg')`, 'list'); await openJobBy('Classic');
  await ev(`(() => { const f = document.getElementById('gEstForm'); const ins = f.querySelectorAll('.g-line input'); const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set(ins[0], 'Clutch plates (set)'); set(ins[1], '1850'); return true })()`);
  await click('#gAddLine'); await ev(`(() => { const rows = document.querySelectorAll('.g-line'); const r = rows[rows.length - 1]; const sel = r.querySelector('select'); sel.value = 'labour'; sel.dispatchEvent(new Event('change', { bubbles: true })); const ins = r.querySelectorAll('input'); const set = (e, v) => { e.value = v; e.dispatchEvent(new Event('input', { bubbles: true })); }; set(ins[0], 'Fit and test ride'); set(ins[1], '650'); const h = document.querySelector('#gEstForm input[type=number][aria-label="Estimated hours"]'); set(h, '6'); const n = document.getElementById('gEstNotes'); n.value = 'Plates are glazed. Cable also frayed.'; n.dispatchEvent(new Event('input', { bubbles: true })); return true })()`);
  await snap('18-estimate-form'); const tot = await ev(`document.querySelector('#gEstTot').innerText.replace(/\\s+/g, ' ')`); if (!/2,500/.test(tot) || !/450/.test(tot) || !/2,950/.test(tot)) throw new Error('totals wrong: ' + tot);
  await ev(`document.getElementById('gEstForm').requestSubmit()`); await until(`document.querySelector('.g-est-submitted')`, 'submitted estimate'); await snap('19-estimate-sent');
  // estimate error
  await click('.g-back'); await until(`!!document.querySelector('.g-seg')`, 'list'); await openJobBy('Activa');
  await ev(`(() => { document.querySelector('#gEstForm .g-line input[type=text]').value = ''; document.getElementById('gEstForm').requestSubmit(); return true })()`); await until(`document.querySelector('#gEstMsg .g-note-err')`, 'estimate error'); await snap('20-estimate-error');
  // closed jobs: no number
  await click('.g-back'); await until(`!!document.querySelector('.g-seg')`, 'list'); await clickText('.g-seg-b', 'Done'); await openJobBy('Swift'); const closed = await ev(`document.body.innerText`); if (/90000 00000/.test(closed) || await ev(`!!document.getElementById('gCallCustomer')`)) throw new Error('number shown on a closed job'); await snap('21-job-closed');
  reset({ limited: true }); await open('/garage/'); await login(); await openJobBy('Activa'); await snap('22-job-contact-limited');
  reset({ jobFail: 1 }); await open('/garage/'); await login(); await clickText('.g-row-job', 'Activa'); await until(`[...document.querySelectorAll('.g-card button')].some((b) => b.textContent === 'Retry')`, 'job retry'); await snap('23-job-error');
  // other tabs
  reset(); await open('/garage/'); await login(); await click('.g-tab:nth-child(3)'); await until(`document.querySelector('.g-sum')`, 'statement'); await snap('24-statement');
  reset({ stFail: true }); await open('/garage/'); await login(); await click('.g-tab:nth-child(3)'); await until(`[...document.querySelectorAll('.g-card button')].some((b) => b.textContent === 'Retry')`, 'st retry'); await snap('25-statement-error');
  reset(); await open('/garage/'); await login(); await click('.g-tab:nth-child(4)'); await until(`document.querySelector('.g-bul')`, 'help'); await snap('26-help');
  const helpLinks = await ev(`[...document.querySelectorAll('a[data-wa],a[data-call]')].map((a) => a.getAttribute('href'))`); if (!helpLinks.some((h) => h.startsWith('https://wa.me/910000000001')) || !helpLinks.some((h) => h === 'tel:+910000000002')) throw new Error('team buttons missing: ' + helpLinks);
  // home dashboard, status, location
  reset(); await open('/garage/', { session: false }); await setPin(PIN); await until(`!!document.getElementById('dLocText') && /Saved/.test(document.getElementById('dLocText').textContent)`, 'location saved on first login'); await snap('28-home-first-login-location');
  if (LOCS.length !== 1 || LOCS[0].lat !== 12.9716) throw new Error('first login did not send the location: ' + JSON.stringify(LOCS));
  const homeT = await ev(`document.body.innerText`); for (const w of ['Hello, Test Garage Koramangala', 'TODAY’S JOBS', 'QUICK ACTIONS', 'CURRENT STATUS', 'MY MONTHLY STATS', 'Previous unsettled (1)', 'Get my jobs', 'Update shop location']) if (!homeT.toUpperCase().includes(w.toUpperCase())) throw new Error('home is missing ' + w);
  await click('#dClosed'); await until(`document.getElementById('dClosed').getAttribute('aria-pressed') === 'true'`, 'closed'); if (DB.garage.is_open !== false) throw new Error('Closed not saved'); await snap('29-home-closed');
  await click('#dOpen'); await until(`document.getElementById('dOpen').getAttribute('aria-pressed') === 'true'`, 'open again');
  await ev(`(() => { document.getElementById('dUnsettled').open = true; return true })()`); await snap('30-home-unsettled-open');
  await click('#dLogout'); await until(`document.getElementById('gpin')`, 'logout to pin');
  // permission refused: the app carries on and says so
  reset(); await cdp('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: `http://localhost:${PORT}` }); await open('/garage/'); await setPin(PIN); await until(`!!document.getElementById('dGet') && document.querySelector('.g-note-info')`, 'refused note'); await snap('31-home-location-refused');
  if (LOCS.length) throw new Error('a location was sent after refusing'); await click('#dGet'); await until(`!!document.querySelector('.g-seg')`, 'jobs still open after refusing');
  await cdp('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'granted', origin: `http://localhost:${PORT}` });
  // session end
  reset(); await open('/garage/'); await login(); MODE.ended = true; await click('.g-tab:nth-child(3)'); await until(`document.getElementById('gpin')`, 'pin after session end'); await snap('27-session-ended');
  // private link in the URL is saved and removed
  reset(); await cdp("Page.navigate", { url: `http://localhost:${PORT}/offline.html` }); await sleep(200); await ev(`localStorage.clear()`);
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/garage/?g=${TOK}` }); await until(`!!document.getElementById('gpin')`, 'pin from link');
  const after = await ev(`({ href: location.href, saved: localStorage.getItem('mxp_garage_link') })`); if (/g=/.test(after.href) || after.saved !== TOK) throw new Error('link not saved or not removed from the address bar: ' + JSON.stringify(after));
}
let failed = null;
try {
  for (const [w, h] of [[390, 844], [1280, 800]]) { W = w; H = h; tag = String(w); await run(); }
  // network payload checks over everything the fake server returned in the last run, plus a full sweep
  reset(); const bodies = [];
  for (const j of DB.jobs) { bodies.push(JSON.stringify(garageJobListItem(j))); bodies.push(JSON.stringify(garageJobDetail(j, true))); }
  for (const b of bodies) if (b.includes(ADDRESS) || b.includes(EMAIL)) throw new Error('address or email in a response');
} catch (e) { failed = e; }
ws.close(); chrome.kill(); server.close(); try { rmSync(prof, { recursive: true, force: true }); } catch {}
const allBodies = ALL.map((l) => l.body);
console.log(`screenshots: ${shots.length} in ${OUT}`);
console.log(`responses logged in the whole run: ${allBodies.length}; address or email in any: ${allBodies.filter((b) => b.includes(ADDRESS) || b.includes(EMAIL)).length}`);
const listBodies = ALL.filter((l) => /"jobs":\[/.test(l.body)).map((l) => l.body); console.log(`job-list responses: ${listBodies.length}; with the phone: ${listBodies.filter((b) => b.includes(PHONE)).length}`);
const phoneBodies = ALL.filter((l) => l.body.includes(PHONE)); console.log(`responses holding the phone: ${phoneBodies.length}, all job details of open jobs: ${phoneBodies.every((l) => /"customer_phone":"9000000000"/.test(l.body) && /"open":true/.test(l.body))}`);
console.log(`page errors: ${consoleErrors.length} ${consoleErrors.slice(0, 3).join(' | ')}; CSP violations: ${cspViolations.length} ${cspViolations.slice(0, 3).join(' | ')}`);
if (failed) { console.error('LOG', LOG.map((l) => l.status + ' ' + l.body.slice(0, 60)).join('\n')); console.error('FAILED:', failed.message.slice(0, 300)); process.exit(1); }
process.exit(consoleErrors.length || cspViolations.length ? 2 : 0);
