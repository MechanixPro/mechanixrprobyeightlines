// Drives the real /mechanic/ page in headless Chrome against a LOCAL fake backend (nothing leaves this machine, no Supabase, no real data).
// The fake mechanic-app endpoint uses the REAL serializers and the REAL dues math (supabase/functions/_shared) on a fake in-memory ledger with placeholder people.
// Takes screenshots at 390 and 1280 wide, checks the privacy rules in every response, clicks through Available/Busy, Pay all, a job's Pay and QR, the date picker, and decodes nothing external.
// Usage: node scripts/mechanic_preview.mjs [outDir]    (default ~/Projects/mx-mech-app-preview/mechanic)
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { signMechanicSession, verifyMechanicSession, mechanicJobItem, duesView, payAmount } from '../supabase/functions/_shared/mechanic.ts';
import { mechanicDues, unsettledRows } from '../supabase/functions/_shared/mech-dues.ts';

const ROOT = new URL('..', import.meta.url).pathname, OUT = process.argv[2] || join(homedir(), 'Projects/mx-mech-app-preview/mechanic');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PHONE = '9000000000', ADDRESS = 'PLACEHOLDER-ADDRESS-LINE 12', EMAIL = 'placeholder.person@example.invalid', PORT = 4174, CDP = 9334, TOK = 'cd34'.repeat(12), PIN = '4821', SECRET = 'preview-secret-0123456789';
mkdirSync(OUT, { recursive: true });
const TODAY = '2026-11-07', MECH = { id: 'M1', name: 'Test Mechanic', payout_rate: 30 };

/* ---------- fake database ---------- */
const L = (n, name, extra = {}) => ({ id: 'L' + n, name, phone: PHONE, email: EMAIL, address: ADDRESS, area: 'HSR Layout', notes: `${PHONE} ${EMAIL}`, booking_id: 'MP-26-27-000' + n, vehicle: 'bike', preferred_date: TODAY, preferred_slot: 'morning', status: 'paid', visit_stage: null, ...extra });
const seed = () => ({
  leads: [L(1, 'Asha Rao', { preferred_slot: 'asap', visit_stage: 'on_the_way' }), L(2, 'Vikram Shah', { status: 'scheduled', preferred_slot: 'afternoon', area: 'Indiranagar' }), L(3, 'Meera Iyer', { status: 'completed', preferred_slot: 'morning' }), L(4, 'Rahul Nair', { preferred_date: '2026-11-08', area: 'Koramangala' })],
  svc: { L1: 'Full bike service', L2: 'Brake and clutch repair', L3: 'Oil change', L4: 'Chain and sprocket change' }, bike: { L1: { brand: 'Honda', model: 'Activa 6G', reg_no: 'KA01AB0001' }, L2: { brand: 'Royal Enfield', model: 'Classic 350', reg_no: 'KA05CD0002' }, L3: { brand: 'Bajaj', model: 'Pulsar 150' }, L4: { brand: 'TVS', model: 'Apache 160' } },
  jobs: [
    { invoice: { lead_id: 'L5', ref: 'R5', issued_at: '2026-10-30T05:00:00Z', total: 1180, taxable: 1000, mechanic_id: 'M1', mechanic_rate: 30 }, entries: [{ id: 'p5', lead_id: 'L5', entry_type: 'customer_payment', amount: 1180, collected_by: 'mechanic' }], name: 'MP-26-27-0005 · Full bike service' },
    { invoice: { lead_id: 'L6', ref: 'R6', issued_at: '2026-11-03T05:00:00Z', total: 1770, taxable: 1500, mechanic_id: 'M1', mechanic_rate: 30 }, entries: [{ id: 'p6', lead_id: 'L6', entry_type: 'customer_payment', amount: 1770, collected_by: 'mechanic' }], name: 'MP-26-27-0006 · Clutch plate change' },
    { invoice: { lead_id: 'L7', ref: 'R7', issued_at: '2026-11-04T05:00:00Z', total: 590, taxable: 500, mechanic_id: 'M1', mechanic_rate: 30 }, entries: [{ id: 'p7', lead_id: 'L7', entry_type: 'customer_payment', amount: 590, collected_by: 'company_portal' }], name: 'MP-26-27-0007 · Oil change' }],
  mine: [], avail: 'available', loc: null });
let DB = seed(), MODE = {}, wrong = 0; const LOG = [], ALL = [], PAYS = [], STATUS = [];
const reset = (m = {}) => { DB = seed(); MODE = m; wrong = 0; LOG.length = 0; PAYS.length = 0; STATUS.length = 0; };
const send = (res, status, body) => { const s = JSON.stringify(body); LOG.push({ status, body: s }); ALL.push({ status, body: s }); res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }); res.end(s); };
const account = () => { const d = mechanicDues({ mechanic: MECH, jobs: DB.jobs.map((j) => ({ invoice: j.invoice, entries: j.entries })), entries: DB.mine }); const names = new Map(DB.jobs.map((j) => [j.invoice.lead_id, { booking_id: j.name.split(' · ')[0], service: j.name.split(' · ')[1] }])); return { d, rows: unsettledRows(d), names }; };
async function api(b, res) {
  const a = b.action;
  if (MODE.delay) await new Promise((r) => setTimeout(r, MODE.delay));
  if (a === 'login') {
    if (b.token !== TOK) return send(res, 404, { error: 'This link is not valid. Ask Mechanix Pro for a new one.', code: 'link' });
    if (MODE.off) return send(res, 403, { error: 'Your app access is switched off. Please contact Mechanix Pro.', code: 'off' });
    if (MODE.locked || wrong >= 5) return send(res, 423, { error: 'Too many wrong PINs. Try again in 15 minutes.', code: 'locked' });
    if (b.pin !== PIN) { wrong++; return send(res, 401, { error: 'That PIN is not right.', code: 'pin', left: 5 - wrong }); }
    const s = await signMechanicSession(SECRET, { access: 'A1', mechanic: 'M1', version: 1 });
    return send(res, 200, { ok: true, session: s.token, expires_at: s.expires_at, mechanic: { name: 'Test Mechanic', area: 'HSR Layout' } });
  }
  if (!(await verifyMechanicSession(SECRET, b.session)) || MODE.ended) return send(res, 401, { error: 'Your session has ended. Enter your PIN again.', code: 'session' });
  if (a === 'team_contact') return send(res, 200, { ok: true, whatsapp: null, call: null });
  const day = (date) => DB.leads.filter((l) => l.preferred_date === date).map((l) => mechanicJobItem({ lead: l, service: DB.svc['L' + l.id.slice(1)], bike: DB.bike['L' + l.id.slice(1)] }));
  if (a === 'jobs') { if (MODE.jobsFail) return send(res, 500, { error: 'x' }); return send(res, 200, { ok: true, date: b.date || TODAY, jobs: day(b.date || TODAY) }); }
  if (a === 'dues') { const x = account(); return send(res, 200, { ok: true, dues: duesView(x.d, x.rows, x.names) }); }
  if (a === 'dashboard') {
    if (MODE.dashFail) { MODE.dashFail--; return send(res, 500, { error: 'Could not load your dashboard. Please try again.' }); }
    const x = account(), v = duesView(x.d, x.rows, x.names), date = b.date || TODAY;
    return send(res, 200, { ok: true, mechanic: { name: 'Test Mechanic', area: 'HSR Layout', availability: DB.avail }, date, today: TODAY, bookings_count: day(date).length, open_count: 2, month: { bookings: 9, completions: 6, avg_ticket: 1180 }, cash: { total_due: v.total_due, company_owes: v.company_owes, unsettled_count: v.unsettled.length } });
  }
  if (a === 'status_set') { STATUS.push(b); DB.avail = b.status; if (b.lat != null) DB.loc = [b.lat, b.lng]; return send(res, 200, { ok: true, availability: b.status, located: b.status === 'available' && b.lat != null }); }
  if (a === 'job_link') { if (b.id === 'L9') return send(res, 409, { error: 'This job is already reported.', code: 'reported' }); return send(res, 200, { ok: true, url: '/job/?t=' + 'f'.repeat(64) }); }
  if (a === 'pay_link') {
    if (MODE.payFail) return send(res, 502, { error: 'The payment link could not be made. Try again, or ask the desk.' });
    const x = account(), target = b.all ? x.rows[0] : x.rows.find((r) => r.lead_id === b.id); if (!target) return send(res, 404, { error: 'Nothing is due here.' });
    const amt = payAmount(b.all ? x.d.remitRemaining : target.due_to_platform); PAYS.push({ all: !!b.all, amount: amt.amount });
    return send(res, 200, { ok: true, url: 'https://rzp.io/i/PrevW' + PAYS.length + 'xYz', amount: amt.amount, all: !!b.all });
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
  if (p === '/functions/v1/mechanic-app') { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => api(JSON.parse(s || '{}'), res)); return; }
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
const prof = join(tmpdir(), 'mxm-chrome-' + process.pid);
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
  await ev(`localStorage.clear(); ${store ? `localStorage.setItem('mxp_mech_link','${TOK}')` : ''}; 0`);
  await cdp('Page.navigate', { url: `http://localhost:${PORT}${path}` }); await until(`!!document.getElementById('gmain')`, 'the app shell');
  if (session) { await login(); }
}
const setPin = (pin) => ev(`(() => { const i = document.getElementById('gpin'); i.value = '${pin}'; document.querySelector('form').requestSubmit(); return true })()`);
async function login() { await setPin(PIN); await until(`!!document.getElementById('dGet')`, 'the home screen'); await sleep(250); }
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) throw new Error('no ${sel.replace(/'/g, '')}'); e.click(); return true })()`);
const clickText = (sel, text) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)})); if (!e) throw new Error('no ${text}'); e.click(); return true })()`);
const domText = () => ev('document.documentElement.outerHTML');

/* ---------- scenarios ---------- */
const shots = []; let W = 390, H = 844, tag = '390';
async function snap(name) {
  await sleep(200);
  const html = await domText();
  if (html.includes(ADDRESS) || html.includes(EMAIL)) throw new Error(`address or email in the DOM at ${name}`);
  const full = await cdp('Page.getLayoutMetrics'), h = Math.min(5000, Math.ceil(full.cssContentSize?.height || full.contentSize.height));
  const r = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: W, height: Math.max(H, h), scale: 1 } });
  writeFileSync(join(OUT, `${tag}-${name}.png`), Buffer.from(r.data, 'base64')); shots.push(`${tag}-${name}`);
}
const text = () => ev('document.body.innerText');
async function run() {
  await cdp('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  reset(); await open('/mechanic/', { store: false }); await snap('01-no-link');
  reset(); await open('/mechanic/'); await snap('02-pin');
  await setPin('1111'); await until(`document.querySelector('.g-note-err')`, 'wrong pin'); await snap('03-pin-wrong');
  reset({ locked: true }); await open('/mechanic/'); await setPin(PIN); await until(`document.querySelector('.g-note-err')`, 'locked'); await snap('04-pin-locked');
  reset({ off: true }); await open('/mechanic/'); await setPin(PIN); await until(`document.querySelector('.g-note-err')`, 'off'); await snap('05-pin-off');
  reset({ delay: 900 }); await open('/mechanic/'); await setPin(PIN); await until(`document.querySelector('.g-loading')`, 'loading'); await snap('06-home-loading'); await until(`!!document.getElementById('dGet')`, 'home', 8000);
  reset({ dashFail: 1 }); await open('/mechanic/'); await setPin(PIN); await until(`[...document.querySelectorAll('.g-card button')].some((b) => b.textContent === 'Retry')`, 'retry'); await snap('07-home-error');
  await clickText('.g-card button', 'Retry'); await until(`!!document.getElementById('dGet')`, 'home after retry');
  // the home screen
  reset(); await open('/mechanic/'); await login(); await snap('08-home');
  const t = await text(); for (const w of ['Hello, Test Mechanic', 'HSR Layout', 'Logout', 'CASH DUES', '₹2,200', 'Pay all', 'QR code', 'Get my bookings', 'CURRENT STATUS', 'Available', 'Busy', 'MY MONTHLY STATS', 'Total bookings', 'Completions', 'Average ticket', 'Previous unsettled (2)', 'BOOKING DATE']) if (!t.toUpperCase().includes(w.toUpperCase())) throw new Error('home is missing ' + w + '\n' + t.slice(0, 300));
  if (/Bronze|Scan Spare/i.test(t)) throw new Error('skipped items are present');
  if (await ev(`document.getElementById('dCount').textContent`) !== '3') throw new Error('today count wrong');
  // bookings: phone only on open jobs, completed has none, no address
  if (t.includes('90000 00000') === false) throw new Error('open job call button missing');
  const calls = await ev(`document.querySelectorAll('[data-call-customer]').length`); if (calls !== 2) throw new Error('call buttons: ' + calls);
  // unsettled list
  await ev(`(() => { document.getElementById('dUnsettled').open = true; return true })()`); await until(`document.querySelectorAll('[data-due]').length === 2`, 'unsettled rows'); await snap('09-unsettled-open');
  const ut = await text(); for (const w of ['Total collected', 'Your payout (labour)', 'Due to platform', '₹880', '₹300', '₹1,180']) if (!ut.includes(w)) throw new Error('unsettled row missing ' + w);
  // pay one job: link, QR drawn as SVG, amount from the server
  await click('[data-pay="L5"]'); await until(`!!document.querySelector('#dPay svg path')`, 'pay panel with QR'); await snap('10-pay-job');
  if (PAYS.length !== 1 || PAYS[0].amount !== 880 || PAYS[0].all) throw new Error('job pay amount: ' + JSON.stringify(PAYS));
  const href = await ev(`document.getElementById('dPayGo').getAttribute('href')`); if (!/^https:\/\/rzp\.io\/i\//.test(href) || (await ev(`document.getElementById('dPayGo').rel`)) !== 'noopener') throw new Error('pay link wrong ' + href);
  if ((await ev(`document.querySelector('#dPay svg').getAttribute('viewBox')`)) !== '0 0 33 33') throw new Error('QR size unexpected');
  await click('#dCopy'); await sleep(200);
  // pay all, QR only
  await click('#dQrAll'); await until(`PAYS_OK = !!document.querySelector('#dPay svg path') && !document.getElementById('dPayGo')`.replace('PAYS_OK = ', ''), 'QR only panel'); await snap('11-pay-qr-only');
  if (PAYS.at(-1).amount !== 2200 || !PAYS.at(-1).all) throw new Error('pay all amount ' + JSON.stringify(PAYS));
  await click('#dPayAll'); await until(`!!document.getElementById('dPayGo')`, 'pay all panel'); await snap('12-pay-all');
  // after payment: remittance recorded, due drops
  DB.mine.push({ id: 'r1', lead_id: 'L5', mechanic_id: 'M1', entry_type: 'remittance', amount: 2200 }); await click('#dPaid'); await until(`document.getElementById('dTotalDue') && document.getElementById('dTotalDue').textContent === '₹0'`, 'due cleared'); await snap('13-all-settled');
  reset({ payFail: true }); await open('/mechanic/'); await login(); await click('#dPayAll'); await until(`document.querySelector('#dPay .g-note-err')`, 'pay error'); await snap('14-pay-error');
  // status: Available asks for the location, Busy does not
  reset(); await open('/mechanic/'); await login(); await click('#dBusy'); await until(`document.getElementById('dBusy').getAttribute('aria-pressed') === 'true'`, 'busy'); await snap('15-busy');
  if (STATUS.at(-1).status !== 'busy' || STATUS.at(-1).lat != null) throw new Error('Busy must not send a location');
  await click('#dAvail'); await until(`document.getElementById('dAvail').getAttribute('aria-pressed') === 'true' && /saved/.test(document.body.innerText)`, 'available with location'); await snap('16-available-located');
  if (STATUS.at(-1).status !== 'available' || Math.abs(STATUS.at(-1).lat - 12.9716) > 1e-6) throw new Error('Available did not send the location: ' + JSON.stringify(STATUS.at(-1)));
  await cdp('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: `http://localhost:${PORT}` });
  await click('#dBusy'); await until(`document.getElementById('dBusy').getAttribute('aria-pressed') === 'true'`, 'busy again'); await click('#dAvail'); await until(`document.getElementById('dAvail').getAttribute('aria-pressed') === 'true' && /not shared/.test(document.body.innerText)`, 'available without location'); await snap('17-available-refused');
  if (STATUS.at(-1).lat != null) throw new Error('location sent after refusing');
  await cdp('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'granted', origin: `http://localhost:${PORT}` });
  // date picker
  await ev(`(() => { const i = document.getElementById('dDate'); i.value = '2026-11-08'; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`); await until(`/Rahul|Chain/.test(document.body.innerText) && !/Brake and clutch/.test(document.body.innerText)`, 'next day bookings'); await snap('18-other-day');
  await ev(`(() => { const i = document.getElementById('dDate'); i.value = '2026-11-20'; i.dispatchEvent(new Event('change', { bubbles: true })); return true })()`); await until(`/No bookings for this day/.test(document.body.innerText)`, 'empty day'); await snap('19-empty-day');
  await click('#dGet'); await until(`document.getElementById('dBookings').textContent.includes('Today')`, 'back to today');
  // job opens on /job/ with a fresh token
  await click('[data-open="L1"]'); await until(`/^\\/job\\/$/.test(location.pathname) && /^\\?t=[0-9a-f]{64}$/.test(location.search)`, 'navigated to /job/'); 
  // help, logout, session end
  reset(); await open('/mechanic/'); await login(); await click('.g-tab:nth-child(2)'); await until(`document.querySelector('.g-bul')`, 'help'); await snap('20-help');
  const hl = await ev(`[...document.querySelectorAll('a[data-wa],a[data-call]')].map((a) => a.getAttribute('href'))`); if (!hl.some((h) => h.startsWith('https://wa.me/910000000001')) || !hl.some((h) => h === 'tel:+910000000002')) throw new Error('team buttons: ' + hl);
  reset(); await open('/mechanic/'); await login(); await click('#dLogout'); await until(`document.getElementById('gpin')`, 'logout'); if (await ev(`localStorage.getItem('mxp_mech_session')`)) throw new Error('session kept after logout'); await snap('21-logged-out');
  reset(); await open('/mechanic/'); await login(); MODE.ended = true; await click('#dGet'); await until(`document.getElementById('gpin')`, 'pin after session end'); await snap('22-session-ended');
  reset(); await cdp('Page.navigate', { url: `http://localhost:${PORT}/offline.html` }); await sleep(200); await ev(`localStorage.clear()`);
  await cdp('Page.navigate', { url: `http://localhost:${PORT}/mechanic/?m=${TOK}` }); await until(`!!document.getElementById('gpin')`, 'pin from link');
  const after = await ev(`({ href: location.href, saved: localStorage.getItem('mxp_mech_link') })`); if (/m=/.test(after.href) || after.saved !== TOK) throw new Error('link not saved or not removed: ' + JSON.stringify(after));
}
let failed = null;
try { for (const [w, h] of [[390, 844], [1280, 800]]) { W = w; H = h; tag = String(w); await run(); } } catch (e) { failed = e; }
ws.close(); chrome.kill(); server.close(); try { rmSync(prof, { recursive: true, force: true }); } catch {}
const bodies = ALL.map((l) => l.body);
console.log(`screenshots: ${shots.length} in ${OUT}`);
console.log(`responses: ${bodies.length}; address or email in any: ${bodies.filter((b) => b.includes(ADDRESS) || b.includes(EMAIL)).length}`);
const ph = ALL.filter((l) => l.body.includes(PHONE)); console.log(`responses holding the phone: ${ph.length}; only as customer_phone on open jobs: ${ph.every((l) => (l.body.match(new RegExp(PHONE, 'g')) || []).length === (l.body.match(/"customer_phone"/g) || []).length)}`);
console.log(`page errors: ${consoleErrors.length} ${consoleErrors.slice(0, 3).join(' | ')}; CSP violations: ${cspViolations.length} ${cspViolations.slice(0, 3).join(' | ')}`);
if (failed) { console.error('LOG', LOG.map((l) => l.status + ' ' + l.body.slice(0, 60)).join('\n')); console.error('FAILED:', failed.message.slice(0, 400)); process.exit(1); }
process.exit(consoleErrors.length || cspViolations.length ? 2 : 0);
