// Mechanix Pro admin panel — Supabase Auth + Row Level Security. All data access is checked in the database.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { leadDetailRows, sourceReport } from './lead-view.js';
import { customerRows, searchCustomers, mechanicStats, cleanCustomerEdit, cleanBikeEdit } from './people.js';
import { couponRows } from './coupon-view.js';
import { rangeFor, buildReport, reportCsv, payoutReport } from './report.js';
import { splitJob } from './split.js';
import { pinRows, validPin, cleanPin, cleanPinName } from './pins-view.js';
import { interestCounts, waitlistRows, interestLabel } from './waitlist-view.js';
import { buildInvoice } from './invoice.js';
import { buildNewBooking } from './new-booking.js';
import { buildServiceEdit } from './booking-edit.js';
import { groupOf, firstTab, navBadges } from './nav.js';
import { boardGroups, nextStep } from './board.js';
import { mechanicCut, snapshotRow, sameFigures, filterRegister, registerTotals, byMechanic, gstSummary, registerCsv } from './invoice-register.js';
import { jobAccount, mechanicAccount, summaryCards } from './ledger.js';
import { buildEntry } from './ledger-forms.js';
import { filterAccounts, salesCsv, ledgerCsv, entryLabel } from './sales-view.js';
import { effectiveRate, jobSplit, cleanCommission, payoutShareText, statementShareText, PLACES } from './commission.js';
import { customerList, bookingRows, summarize } from './customer-bookings.js';
import { adsConversions } from './ads-export.js';
import { issueRows, openIssueCount, warrantyInfo, KIND_LABEL, STATUS_LABEL } from './issue-view.js';

const C = window.MXP || {};
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const STATUSES = ['new', 'contacted', 'quoted', 'payment_sent', 'paid', 'scheduled', 'completed', 'lost'];
const LABEL = { new: 'New', contacted: 'Contacted', quoted: 'Quoted', payment_sent: 'Payment sent', paid: 'Paid', scheduled: 'Scheduled', completed: 'Completed', lost: 'Lost' };
const SLOT = { morning: 'Morning 9–12', afternoon: 'Afternoon 12–4', evening: 'Evening 4–8', asap: 'ASAP (SOS)' };

if (!C.supabaseUrl || !C.supabaseAnonKey) {
  $('#login').innerHTML = '<h1 style="font-size:24px">Admin not connected yet</h1><p class="muted">Add your Supabase URL and anon key to <code>/assets/js/config.js</code>, then reload.</p>';
  throw new Error('Supabase not configured');
}
const sb = createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const S = { me: null, tab: 'dash', lastTab: {}, invoices: [], invoicesAll: [], cb: { q: '', id: null }, ledger: [], sf: { period: 'month', mechanic: '', status: '', q: '', channel: '', gst: '', from: '', to: '' }, finJob: null, finKind: 'payment', mlOpen: null, ifl: { gst: '', rate: '', mechanic: '', period: 'month', q: '' }, leads: [], services: [], settings: {}, customers: [], bikes: [], mechanics: [], coupons: [], homeimgs: [], issues: [], pins: [], pq: '', waitlist: [], wi: '', wq: '', ifilter: 'open', selMode: false, sel: new Set(), range: '30d', cq: '', q: '', status: 'open', open: null, openCust: null, channel: null };

function toast(m) { const t = document.createElement('div'); t.className = 'toast fade'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
async function audit(action, details) { try { await sb.from('audit_log').insert({ action, details, actor: S.me.user_id }); } catch (e) {} }
const basis = () => 'before_gst'; // payouts are always worked out on the amount before GST
const fee = (id, d) => S.services.find((x) => x.id === id)?.price ?? d;
// New customers pay the small slot fee; a phone with an earlier completed job pays the checkup and quote fee.
const slotFeeFor = (l) => (S.leads.some((x) => x.phone === l.phone && x.id !== l.id && x.status === 'completed') ? fee('advance', 349) : fee('newfee', 99));
const isOwner = () => S.me?.role === 'owner';

/* ---------- auth ---------- */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
  if (error) { $('#loginErr').textContent = 'Wrong email or password.'; return; }
  boot();
});
// No login codes and no magic links: the admin signs in with a password. "Forgot password" emails a one-time link that opens the "choose a new password" form below.
let recovering = /type=recovery/.test(location.hash) || /type=recovery/.test(location.search);
const showReset = () => { recovering = true; $('#loginForm').hidden = true; $('#resetForm').hidden = false; $('#np1').focus(); };
sb.auth.onAuthStateChange((ev) => { if (ev === 'PASSWORD_RECOVERY') showReset(); });
if (recovering) showReset();
$('#forgot').addEventListener('click', async () => {
  const email = $('#em').value.trim(); $('#loginErr').textContent = ''; $('#loginInfo').textContent = '';
  if (!/^\S+@\S+\.\S+$/.test(email)) { $('#loginErr').textContent = 'Type your email above, then press Forgot password.'; return; }
  $('#forgot').disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + '/' });
  setTimeout(() => { $('#forgot').disabled = false; }, 4000);
  if (error && /rate|seconds|too many/i.test(error.message)) { $('#loginErr').textContent = 'Please wait a minute before asking again.'; return; }
  // The same message whether or not the email belongs to an admin, so nobody can use this page to find out who is one.
  $('#loginInfo').textContent = 'If that email belongs to an admin, a link to choose a new password is on its way. It works for an hour.';
});
$('#resetForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#resetErr').textContent = '';
  const a = $('#np1').value, b = $('#np2').value;
  if (a.length < 10) { $('#resetErr').textContent = 'Use at least 10 characters.'; return; }
  if (a !== b) { $('#resetErr').textContent = 'The two passwords are not the same.'; return; }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { $('#resetErr').textContent = /same|different/i.test(error.message) ? 'Choose a password you have not used before.' : 'Could not save the password. Ask for a new link and try again.'; return; }
  recovering = false; try { history.replaceState(null, '', location.pathname); } catch (x) {}
  $('#resetForm').hidden = true; $('#loginForm').hidden = false; toast('Password saved'); boot();
});
$('#signOut').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: me } = await sb.from('admins').select('user_id,name,role').eq('user_id', user.id).maybeSingle();
  if (!me) { $('#loginErr').textContent = 'This account is not an admin. Ask the owner to add you.'; await sb.auth.signOut(); return; }
  S.me = me;
  $('#login').hidden = true; $('#view').hidden = false; $('#tabs').hidden = false; $('#subtabs').hidden = false; $('#signOut').hidden = false;
  await Promise.all([loadLeads(), loadServices(), loadSettings(), loadPeople(), loadHome(), loadIssues(), loadPins(), loadWaitlist(), loadInvoices(), loadLedger()]);
  render();
  S.channel = sb.channel('mxp-admin')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async (p) => { if (p.eventType === 'INSERT') toast('New booking ' + (p.new?.ref ?? '')); await loadLeads(); if (!['prices', 'settings', 'offers', 'homeimgs'].includes(S.tab)) render(); if (S.open) openLead(S.open, true); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ledger_entries' }, async () => { await Promise.all([loadLedger(), loadLeads()]); if (['sales', 'mechledger'].includes(S.tab)) render(); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => { if (S.open && p.new?.lead_id === S.open) openLead(S.open, true); })
    .subscribe();
}

/* The engine size lives on the bike. An invoice needs it, so bring it onto the booking before billing. */
function withBike(l) { const b = S.bikes.find((x) => x.id === l.bike_id); return b ? { ...l, big_bike: !!b.big_bike, engine_class: b.engine_class || null } : l; }

/* Engine size: bikes of 150 to 250cc and above have their own prices. Without those price rows the form keeps the old single "above 180cc" box. */
function hasTiers() { return S.services.some((x) => x.id === 'basic250' && x.active); }
function hasBig() { return S.services.some((x) => x.id === 'basic500' && x.active); }
function engineOf(bike) { return bike.engine_class || (bike.big_bike ? 'big' : 'std'); }
function engineField(prefix, bike, enabled) {
  if (!hasTiers()) return `<label class="check"><input type="checkbox" id="${prefix}-big"${bike?.big_bike ? ' checked' : ''}${enabled ? '' : ' disabled'}><span>Above 180cc (adds the big-bike surcharge to Basic, General and Full)${enabled ? '' : ' (no bike saved on this booking)'}</span></label>`;
  const cur = bike ? engineOf(bike) : 'std';
  return `<label class="label" for="${prefix}-engine">Engine size</label><select id="${prefix}-engine"${enabled ? '' : ' disabled'}>${[['std', 'Up to 149cc'], ['mid', '150 to 250cc'], ['big', hasBig() ? '251 to 500cc' : 'Above 250cc (adds the surcharge)']].map(([v, t]) => `<option value="${v}"${cur === v ? ' selected' : ''}>${t}</option>`).join('')}</select>${enabled ? '' : '<p class="muted tiny">No bike saved on this booking.</p>'}`;
}
function engineRead(prefix) { const s = $('#' + prefix + '-engine'); return s ? { engine: s.value } : { bigBike: !!$('#' + prefix + '-big')?.checked }; }

/* ---------- data ---------- */
async function loadLeads() {
  const { data, error } = await sb.from('leads').select('*').is('deleted_at', null).order('created_at', { ascending: false }).limit(500);
  if (error) toast('Could not load bookings'); else S.leads = data;
}
async function loadInvoices() {
  const { data, error } = await sb.from('invoices').select('*').order('issued_at', { ascending: false }).limit(3000);
  if (error) toast('Could not load invoices: ' + error.message); else { S.invoicesAll = data ?? []; S.invoices = S.invoicesAll.filter((r) => !r.voided_at); }
}
async function loadLedger() {
  const { data, error } = await sb.from('ledger_entries').select('*').order('created_at', { ascending: false }).limit(5000);
  if (error) toast('Could not load the money ledger: ' + error.message); else S.ledger = data ?? [];
}
async function loadPeople() {
  const [c, b, m, cp] = await Promise.all([sb.from('customers').select('*').order('created_at', { ascending: false }).limit(1000), sb.from('bikes').select('*').limit(2000), sb.from('mechanics').select('*').order('name'), sb.from('coupons').select('*').order('code')]);
  S.customers = c.data ?? []; S.bikes = b.data ?? []; S.mechanics = m.data ?? []; S.coupons = cp.data ?? [];
  if (c.error || b.error || m.error || cp.error) toast('Could not load customers or mechanics');
}
async function loadHome() { const { data } = await sb.from('home_images').select('*').order('position').order('created_at'); S.homeimgs = data ?? []; }
async function loadIssues() { const { data } = await sb.from('issues').select('*').order('created_at', { ascending: false }).limit(500); S.issues = data ?? []; }
async function loadPins() { const { data } = await sb.from('service_pincodes').select('*').order('pin').limit(2000); S.pins = data ?? []; }
async function loadWaitlist() { const { data } = await sb.from('waitlist').select('*').order('created_at', { ascending: false }).limit(2000); S.waitlist = data ?? []; }
async function loadServices() { const { data } = await sb.from('services').select('*').order('sort'); S.services = data ?? []; }
async function loadSettings() { const { data } = await sb.from('settings').select('*'); S.settings = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])); }
const svcName = (id) => S.services.find((s) => s.id === id)?.name ?? id ?? '—';

/* ---------- views ---------- */
document.addEventListener('click', (e) => {
  const dt = e.target.closest('[data-dt]'); if (dt) { S.dt = dt.dataset.dt; document.querySelectorAll('.dpanel').forEach((p) => { p.hidden = p.id !== 'dt-' + S.dt; }); document.querySelectorAll('[data-dt]').forEach((b) => b.setAttribute('aria-selected', b.dataset.dt === S.dt)); return; }
  const gb = e.target.closest('[data-group]'); if (gb) { const g = gb.dataset.group; S.tab = S.lastTab[g] || firstTab(g); syncNav(); render(); return; }
  const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; syncNav(); render(); return; }
  const r = e.target.closest('[data-lead]'); if (r) { if (S.selMode) { const id = r.dataset.lead; if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); render(); } else openLead(r.dataset.lead); return; }
  const cu = e.target.closest('[data-cust]'); if (cu) { openCustomer(cu.dataset.cust); return; }
  const cbr = e.target.closest('[data-cb]'); if (cbr) { S.cb.id = cbr.dataset.cb; render(); return; }
  const is = e.target.closest('[data-issue]'); if (is) { openIssue(is.dataset.issue); return; }
  const wb = e.target.closest('[data-wi]'); if (wb) { S.wi = S.wi === wb.dataset.wi ? '' : wb.dataset.wi; render(); return; }
  const wl = e.target.closest('[data-wl]'); if (wl) { openWaitlist(wl.dataset.wl); return; }
  const pn = e.target.closest('[data-pin]'); if (pn) { openPin(pn.dataset.pin); return; }
  const me = e.target.closest('[data-mech]'); if (me) { openMechanic(me.dataset.mech); return; }
  const co = e.target.closest('[data-coupon]'); if (co) { openCoupon(co.dataset.coupon); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'cb-q') { S.cb.q = e.target.value; clearTimeout(S.cbT); S.cbT = setTimeout(() => { render(); const q = $('#cb-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); return; }
  if (e.target.id === 'cc-q') { const n = e.target.value.trim().toLowerCase(), res = $('#cc-res'); if (!res) return; const lead = S.leads.find((x) => x.id === S.open); res.innerHTML = n.length < 2 ? '' : S.customers.filter((c) => (!lead || c.id !== lead.customer_id) && (String(c.name).toLowerCase().includes(n) || String(c.phone).includes(n))).slice(0, 6).map((c) => `<button class="row" type="button" data-act="moveBooking" data-id="${c.id}" style="border-radius:10px;width:100%;margin-bottom:6px"><span>${esc(c.name)}</span><span class="meta">+91 ${esc(c.phone)}</span></button>`).join('') || '<p class="tiny muted">No customer found. Add them under Customers first.</p>'; return; } if (e.target.id === 'mr-range' || e.target.id === 'mr') { const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)); if (e.target.id === 'mr-range') $('#mr').value = v; else $('#mr-range').value = v; updateSplitPreview(); }  if (e.target.id === 'q') { S.q = e.target.value; renderList(); } if (e.target.id === 'wq') { S.wq = e.target.value; render(); const again = $('#wq'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } } if (e.target.id === 'pq') { S.pq = e.target.value; const l = $('#pinlist'); if (l) { const keep = e.target; render(); const again = $('#pq'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } } } if (e.target.id === 'cq') { S.cq = e.target.value; renderCustomers(); } });
document.addEventListener('change', (e) => { if (e.target.id === 'il') { const l = S.leads.find((x) => x.id === e.target.value), w = warrantyInfo(l, WARRANTY_DAYS); $('#iw').textContent = l ? (w.active ? `Warranty is active until ${w.endsOn} (${w.daysLeft} days left).` : 'No active warranty on this booking (needs a completed job within 30 days).') : ''; } if (e.target.id === 'hf') ACT.uploadHome(e.target); if (e.target.id === 'ifs') { S.ifilter = e.target.value; render(); } if (e.target.id === 'fs') { S.status = e.target.value; renderList(); } if (e.target.id === 'rr') { S.range = e.target.value; render(); } });
document.addEventListener('change', (e) => { if (e.target.matches && e.target.matches('[data-board-mech]')) { ACT.boardMech(e.target); return; } const m = { 'if-period': 'period', 'if-gst': 'gst', 'if-rate': 'rate', 'if-mech': 'mechanic' }[e.target.id]; if (m) { S.ifl[m] = e.target.value; render(); } });
document.addEventListener('input', (e) => { if (e.target.id === 'if-q') { S.ifl.q = e.target.value; const pos = e.target.selectionStart; render(); const q = $('#if-q'); if (q) { q.focus(); q.setSelectionRange(pos, pos); } } });
document.addEventListener('click', (e) => { const r = e.target.closest('.inv-tr'); if (r) openLead(r.dataset.lead); const f = e.target.closest('.fin-tr'); if (f) ACT.finOpen(f); });
document.addEventListener('change', (e) => { const id = e.target.id; if (id === 'fin-by') { const p = $('#fin-portal'); if (p) p.hidden = e.target.value !== 'company_portal'; return; } if (id === 'fin-kind') { S.finKind = e.target.value; render(); return; } const m = { 'sf-period': 'period', 'sf-mech': 'mechanic', 'sf-status': 'status', 'sf-channel': 'channel', 'sf-gst': 'gst', 'sf-from': 'from', 'sf-to': 'to' }[id]; if (m) { S.sf[m] = e.target.value; render(); } });
document.addEventListener('input', (e) => { if (e.target.id === 'sf-q') { S.sf.q = e.target.value; clearTimeout(S.sfT); S.sfT = setTimeout(() => { render(); const q = $('#sf-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }, 250); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#inv')) $('#inv').remove(); else if (!$('#sheet').hidden) closeSheet(); } });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });


// The top bar shows five sections; the row under it shows the pages of the section you are in. The last page used in each section is remembered.
function syncNav() {
  const g = groupOf(S.tab); S.lastTab[g] = S.tab;
  document.querySelectorAll('[data-group]').forEach((b) => (b.dataset.group === g ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  document.querySelectorAll('[data-sub]').forEach((d) => { d.hidden = d.dataset.sub !== g; });
  document.querySelectorAll('#subtabs [data-tab]').forEach((b) => (b.dataset.tab === S.tab ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
  const bd = navBadges({ leads: S.leads, issues: S.issues });
  document.querySelectorAll('[data-badge]').forEach((el) => { const n = bd[el.dataset.badge] || 0; el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; });
}
function render() { syncNav(); const v = $('#view'); v.innerHTML = ({ dash, board, leads, customers, mechanics, coupons, issues, pins, waitlist, offers, reports, invoices, sales, mechledger, custbook, prices, homeimgs, settings, activity })[S.tab](); if (S.tab === 'leads') renderList(); if (S.tab === 'customers') renderCustomers(); if (S.tab === 'activity') loadActivity(); }

function dash() {
  const L = S.leads, dayAgo = Date.now() - 864e5, weekAgo = Date.now() - 7 * 864e5;
  const today = L.filter((l) => new Date(l.created_at) > new Date(new Date().setHours(0, 0, 0, 0)));
  const week = L.filter((l) => new Date(l.created_at) > weekAgo);
  const paidWeek = L.filter((l) => l.paid_at && new Date(l.paid_at) > weekAgo);
  const conv = week.length ? Math.round((week.filter((l) => ['paid', 'scheduled', 'completed'].includes(l.status)).length / week.length) * 100) : 0;
  const waiting = L.filter((l) => l.status === 'new' && Date.now() - new Date(l.created_at) > 30 * 6e4 && new Date(l.created_at) > dayAgo);
  const by = (k) => { const m = {}; week.forEach((l) => { const v = (k === 'utm' ? l.utm?.utm_source : l[k]) || (k === 'utm' ? 'direct' : '—'); m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 8); };
  const bars = (rows) => { const mx = Math.max(1, ...rows.map((r) => r[1])); return '<div class="bars">' + rows.map(([k, v]) => `<div class="b"><span>${esc(LABEL[k] ?? k)}</span><span class="t"><i style="width:${Math.round((v / mx) * 100)}%"></i></span><b>${v}</b></div>`).join('') + '</div>'; };
  const funnel = STATUSES.map((s) => [s, week.filter((l) => l.status === s).length]);
  return `<h1 style="font-size:34px">Good ${new Date().getHours() < 12 ? 'morning' : new Date().getHours() < 17 ? 'afternoon' : 'evening'}, ${esc(S.me.name)}</h1>
  <div class="kpis">
    <div class="kpi"><b>${today.length}</b><span>Bookings today</span></div>
    <div class="kpi"><b>${openIssueCount(S.issues)}</b><span>Open issues</span></div>
    <div class="kpi"><b>${week.length}</b><span>Last 7 days</span></div>
    <div class="kpi"><b>${conv}%</b><span>Paid conversion (7 days)</span></div>
    <div class="kpi"><b>${rupee(paidWeek.reduce((s, l) => s + (l.paid_amount || 0), 0))}</b><span>Collected online (7 days)</span></div>
    <div class="kpi"><b>${L.filter((l) => l.status === 'payment_sent').length}</b><span>Waiting for payment</span></div>
  </div>
  ${waiting.length ? `<div class="card" style="margin-bottom:16px;border:1.5px solid var(--ember)"><h3>Needs a reply (${waiting.length})</h3>${waiting.slice(0, 6).map((l) => `<button class="row" data-lead="${l.id}"><span class="ref">${esc(l.ref)}</span><span>${esc(l.name)}<br><span class="meta">${esc(svcName(l.service_id))} · ${esc(l.area || '')}</span></span><span class="meta">${when(l.created_at)}</span></button>`).join('')}</div>` : ''}
  <div class="split2"><div class="card"><h3>Pipeline (7 days)</h3>${bars(funnel)}</div><div class="card"><h3>Where bookings come from</h3>${bars(by('utm'))}<h3 style="margin-top:14px">Top areas</h3>${bars(by('area'))}</div></div>
  ${sourcesCard(week)}`;
}
function sourcesCard(week) {
  const r = sourceReport(week);
  const rows = (a) => (a.length ? a.map(([k, v]) => `<div class="b"><span>${esc(k)}</span><b>${v}</b></div>`).join('') : '<p class="small muted">None yet</p>');
  return `<div class="card" style="margin-top:16px"><h3>Sources (7 days)</h3><div class="split2"><div><h4>Source</h4>${rows(r.source)}</div><div><h4>Campaign</h4>${rows(r.campaign)}</div><div><h4>Referrer</h4>${rows(r.referrer)}</div></div></div>`;
}

function leads() {
  return `<div class="toolbar"><input id="q" type="search" placeholder="Search name, phone or MP-ref" value="${esc(S.q)}" aria-label="Search bookings">
  <select id="fs" aria-label="Filter by status"><option value="open"${S.status === 'open' ? ' selected' : ''}>Open (needs action)</option><option value="all"${S.status === 'all' ? ' selected' : ''}>All</option>${STATUSES.map((s) => `<option value="${s}"${S.status === s ? ' selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
  <button class="btn btn-ghost btn-sm" type="button" data-act="csv">Export CSV</button><button class="btn btn-primary btn-sm" type="button" data-act="newLead">Add booking</button>${isOwner() ? '<button class="btn btn-ghost btn-sm" type="button" data-act="showDeleted">Deleted bookings</button>' : ''}
  ${isOwner() ? (S.selMode ? `<button class="btn btn-ghost btn-sm" type="button" data-act="selectAll">Select all shown</button><button class="btn btn-dark btn-sm" type="button" data-act="deleteSelected"${S.sel.size ? '' : ' disabled'}>Delete selected (${S.sel.size})</button><button class="btn btn-ghost btn-sm" type="button" data-act="selectDone">Done</button>` : '<button class="btn btn-ghost btn-sm" type="button" data-act="selectMode">Select to delete</button>') : ''}</div><div class="list" id="list"></div>`;
}

/* ---------- customers ---------- */
function customers() {
  return `<div class="toolbar"><input id="cq" type="search" placeholder="Search name, phone or bike" value="${esc(S.cq)}" aria-label="Search customers"></div><div class="list" id="clist"></div>`;
}
function renderCustomers() {
  const el = $('#clist'); if (!el) return;
  const rows = searchCustomers(customerRows(S.customers, S.bikes, S.leads), S.cq);
  el.innerHTML = rows.length ? rows.map((r) => `<button class="row crow" data-cust="${r.id}"><span>${esc(r.name)} ${r.blocked ? '<span class="pill lost">Blocked</span>' : ''}<br><span class="meta">+91 ${esc(r.phone)}</span></span><span class="meta">${esc(r.bikes.join(', ') || 'No bike saved')}</span><span class="meta">${r.bookings} booking${r.bookings === 1 ? '' : 's'}${r.paidTotal ? ' · ' + rupee(r.paidTotal) : ''}</span></button>`).join('') : '<p class="muted" style="padding:16px">No customers yet. They appear when someone books on the website.</p>';
}
function openCustomer(id) {
  const r = customerRows(S.customers, S.bikes, S.leads).find((x) => x.id === id); if (!r) return;
  S.openCust = id; S.open = null;
  const mine = S.leads.filter((l) => l.customer_id === id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${esc(r.name)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p>${r.blocked ? '<span class="pill lost">Blocked</span>' : ''}</p>
  <div class="card"><dl class="kv"><dt>Phone</dt><dd><a href="tel:+91${esc(r.phone)}">+91 ${esc(r.phone)}</a></dd><dt>Bikes</dt><dd>${esc(r.bikes.join(', ') || 'None saved')}</dd><dt>Bookings</dt><dd>${r.bookings}</dd><dt>Paid so far</dt><dd>${rupee(r.paidTotal)}</dd></dl>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><a class="btn btn-wa btn-sm" href="https://wa.me/91${esc(r.phone)}" target="_blank" rel="noopener">Open WhatsApp chat</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(r.phone)}">Call</a></div></div>
  <div class="card" style="margin-top:12px"><h3>Edit details</h3><p class="tiny muted" style="margin:0 0 6px">Changes also update this customer's bookings and invoices.</p>
    <label class="label" for="cd-name">Name</label><input id="cd-name" maxlength="80" value="${esc(r.name)}">
    <label class="label" for="cd-phone">Mobile number</label><input id="cd-phone" inputmode="numeric" maxlength="14" value="${esc(r.phone)}">
    <label class="label" for="cd-email">Email</label><input id="cd-email" type="email" inputmode="email" maxlength="254" value="${esc(r.email || '')}">
    <label class="label" for="cd-area">Area</label><input id="cd-area" maxlength="60" value="${esc(r.area || '')}" placeholder="For example: HSR Layout">
    <label class="label" for="cd-address">Address</label><textarea id="cd-address" rows="2" maxlength="160">${esc(r.address || '')}</textarea>
    <label class="label" for="cd-company">Company name <span class="muted" style="font-weight:400">(for a GST invoice)</span></label><input id="cd-company" maxlength="80" value="${esc(r.company || '')}">
    <label class="label" for="cd-gstin">GSTIN <span class="muted" style="font-weight:400">(15 characters)</span></label><input id="cd-gstin" maxlength="15" autocapitalize="characters" value="${esc(r.gstin || '')}">
    <button class="btn btn-primary" style="margin-top:14px" type="button" data-act="saveCustomerDetails">Save details</button> <button class="btn btn-dark" style="margin-top:14px" type="button" data-act="newBookingForCustomer">New booking for this customer</button></div>
  ${S.bikes.filter((b) => b.customer_id === id).length ? `<div class="card" style="margin-top:12px"><h3>Bikes</h3>${S.bikes.filter((b) => b.customer_id === id).map((b) => `<div class="bike-edit" data-bike-row="${b.id}" style="border-top:1px solid var(--line);padding-top:10px;margin-top:10px">
    <label class="label" for="bk-brand-${b.id}">Brand</label><input id="bk-brand-${b.id}" maxlength="30" value="${esc(b.brand || '')}">
    <label class="label" for="bk-model-${b.id}">Model</label><input id="bk-model-${b.id}" maxlength="40" value="${esc(b.model || '')}">
    <label class="label" for="bk-reg-${b.id}">Registration number</label><input id="bk-reg-${b.id}" maxlength="14" autocapitalize="characters" value="${esc(b.reg_no || '')}">
    <button class="btn btn-ghost btn-sm" style="margin-top:10px" type="button" data-act="saveBike" data-id="${b.id}">Save bike</button></div>`).join('')}</div>` : ''}
  <div class="card" style="margin-top:12px"><h3>Notes and blocking</h3>
    <label class="label" for="cn">Notes</label><textarea id="cn" rows="3" maxlength="1000">${esc(r.notes || '')}</textarea>
    <label class="check"><input type="checkbox" id="cb"${r.blocked ? ' checked' : ''}><span>Block this customer. New website bookings from this number are not saved. They can still message you on WhatsApp.</span></label>
    <label class="label" for="cr">Reason (private)</label><input id="cr" maxlength="200" value="${esc(r.blockedReason || '')}">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn btn-primary" type="button" data-act="saveCustomer">Save</button>${isOwner() ? '<button class="btn btn-ghost" type="button" data-act="deleteCustomer">Delete customer</button>' : ''}</div></div>
  <div class="card" style="margin-top:12px"><h3>Booking history</h3>${mine.length ? mine.map((l) => `<button class="row" data-lead="${l.id}" style="border-radius:12px"><span class="ref">${esc(l.ref)}</span><span>${esc(svcName(l.service_id))}<br><span class="meta">${when(l.created_at)}</span></span><span class="pill ${l.status}">${LABEL[l.status]}</span></button>`).join('') : '<p class="small muted">No bookings yet.</p>'}</div>`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}

/* ---------- mechanics ---------- */
function mechanics() {
  const rows = mechanicStats(S.mechanics, S.leads, { basis: basis() }), led = new Map(salesModel().mechAccts.map((a) => [a.mechanic.id, a]));
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">Assign a mechanic from a booking. Open a mechanic to see every job's split, correct a commission and share the statement on WhatsApp.</p>${isOwner() ? '<button class="btn btn-primary btn-sm" type="button" data-act="newMechanic">Add mechanic</button>' : ''}</div>
  <div class="list">${rows.length ? rows.map((m) => `<button class="row mrow" data-mech="${m.id}"><span>${esc(m.name)} ${m.active ? '' : '<span class="pill off">Inactive</span>'}<br><span class="meta">${esc(m.city)} · ${m.years} yr · Mechanic ${m.rate}% · Company ${m.companyRate}%${m.certified ? ' · Certified' : ''}<br><span class="splitbar" role="img" aria-label="Mechanic ${m.rate} percent, company ${m.companyRate} percent"><i style="width:${m.rate}%"></i></span>${m.specialties ? '<br>' + esc(m.specialties) : ''}</span></span><span class="meta">${m.open} open · ${m.completed} done<br>Earned ${rupee2((led.get(m.id) || {}).earnings || 0)}</span><span class="meta">${(led.get(m.id) || {}).remitRemaining > 0.005 ? 'Owes us ' + rupee2(led.get(m.id).remitRemaining) : ''}${(led.get(m.id) || {}).remitRemaining > 0.005 && (led.get(m.id) || {}).payoutRemaining > 0.005 ? '<br>' : ''}${(led.get(m.id) || {}).payoutRemaining > 0.005 ? 'We owe ' + rupee2(led.get(m.id).payoutRemaining) : ''}</span><b>${(led.get(m.id) || {}).net ? rupee2(Math.abs(led.get(m.id).net)) : ''}</b></button>`).join('') : '<p class="muted" style="padding:16px">No mechanics yet. Add your first one to start assigning jobs.</p>'}</div>`;
}
/* The revenue split picture: a two-colour bar and a sample job, so the percentage is never just a number. */
function updateSplitPreview() {
  const n = $('#mr'); if (!n) return;
  const rate = Math.min(100, Math.max(0, parseInt(n.value, 10) || 0)), sp = splitJob(1000, rate, basis());
  const bar = $('#split-bar'), sample = $('#split-sample');
  if (bar) { bar.setAttribute('aria-label', `Mechanic ${rate} percent, company ${100 - rate} percent`); bar.innerHTML = `<span class="sb-mech" style="width:${rate}%">${rate >= 14 ? 'Mechanic ' + rate + '%' : ''}</span><span class="sb-co" style="width:${100 - rate}%">${100 - rate >= 14 ? 'Company ' + (100 - rate) + '%' : ''}</span>`; }
  if (sample) sample.textContent = `On a ${rupee(1000)} job: the mechanic gets ${rupee(sp.mechanic)} and the company keeps ${rupee(sp.company)}.` + (sp.gst ? ` (${rupee(sp.gst)} is GST.)` : '');
}
function openNewBooking(c) {
  const svcs = S.services.filter((x) => x.kind === 'service' && x.active && !/(250|500)$/.test(x.id)), adds = S.services.filter((x) => x.kind === 'addon' && x.active);
  const sel = (id, opts, d) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === d ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  S.open = null; S.openCust = null; S.openMech = null;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">Add booking</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p class="small muted" style="margin:8px 0 0">Name and mobile number are all you need. Add the rest if you have it, so the mechanic and the invoice have the details.</p>
  <div class="card" style="margin-top:12px"><h3>Customer</h3><div class="inline-form">
    <label class="label" for="nb-name">Name *</label><input id="nb-name" maxlength="60" autocomplete="off">
    <label class="label" for="nb-phone">Mobile number *</label><input id="nb-phone" inputmode="numeric" maxlength="14" placeholder="10 digits" autocomplete="off">
    <label class="label" for="nb-email">Email (for the confirmation and invoice)</label><input id="nb-email" type="email" maxlength="120" autocomplete="off">
    <label class="label" for="nb-ref">Ad ref code <span class="muted" style="font-weight:400">(at the end of their WhatsApp message, links the booking to the Google ad)</span></label><input id="nb-ref" maxlength="5" autocapitalize="characters" placeholder="For example K7P2M" autocomplete="off">
    <label class="label" for="nb-source">How did they reach us?</label>${sel('nb-source', [['phone', 'Phone call'], ['whatsapp', 'WhatsApp'], ['walk_in', 'Walk-in or referral']], 'phone')}
    <label class="check"><input type="checkbox" id="nb-wa"><span>The customer agreed to WhatsApp updates</span></label></div></div>
  <div class="card" style="margin-top:12px"><h3>Bike</h3><div class="inline-form">
    <label class="label" for="nb-brand">Brand</label><input id="nb-brand" maxlength="30" placeholder="Honda, Royal Enfield…">
    <label class="label" for="nb-model">Model</label><input id="nb-model" maxlength="40" placeholder="Activa 6G, Classic 350…">
    <label class="label" for="nb-nick">Nickname (optional)</label><input id="nb-nick" maxlength="24">
    <label class="label" for="nb-reg">Registration number (optional)</label><input id="nb-reg" maxlength="14" placeholder="KA 03 AB 1234">
    ${engineField('nb', null, true)}</div></div>
  <div class="card" style="margin-top:12px"><h3>Service</h3><div class="inline-form">
    <label class="label" for="nb-service">Package</label>${sel('nb-service', [['', 'Not decided yet'], ...svcs.map((x) => [x.id, `${x.name} · ${rupee(x.price)}`])], '')}
    <div><span class="label">Add-ons</span>${adds.map((a) => `<label class="check"><input type="checkbox" data-nb-addon="${esc(a.id)}"><span>${esc(a.name)} · ${rupee(a.price)}</span></label>`).join('')}</div>
    <label class="label" for="nb-km">Since the last service</label>${sel('nb-km', [['', 'Not known'], ['new', 'New bike'], ['lt3', 'Under 3,000 km'], ['mid', '3,000–6,000 km'], ['gt6', 'Over 6,000 km'], ['unsure', 'Not sure']], '')}
    <label class="label" for="nb-note">Problems or notes</label><textarea id="nb-note" rows="3" maxlength="1000"></textarea></div></div>
  <div class="card" style="margin-top:12px"><h3>Where and when</h3><div class="inline-form">
    <label class="label" for="nb-place">Where is the bike?</label>${sel('nb-place', [['home', 'At home or office'], ['road', 'Stuck on the road'], ['pickup', 'Needs pickup'], ['unsure', 'Not sure']], 'home')}
    <label class="label" for="nb-area">Area</label><input id="nb-area" maxlength="40" placeholder="HSR Layout">
    <label class="label" for="nb-pin">PIN code</label><input id="nb-pin" inputmode="numeric" maxlength="6" placeholder="560102">
    <label class="label" for="nb-addr">Address or landmark</label><input id="nb-addr" maxlength="200">
    <label class="label" for="nb-date">Day</label><input id="nb-date" type="date">
    <label class="label" for="nb-slot">Time slot</label>${sel('nb-slot', [['', 'Pick a slot'], ['morning', 'Morning 9–12'], ['afternoon', 'Afternoon 12–4'], ['evening', 'Evening 4–8'], ['asap', 'ASAP']], '')}
    <label class="label" for="nb-time">Exact time (optional)</label><input id="nb-time" maxlength="30" placeholder="10:30 AM">
    <label class="label" for="nb-status">Status</label>${sel('nb-status', [['contacted', 'Contacted'], ['quoted', 'Quoted'], ['payment_sent', 'Payment sent'], ['paid', 'Paid'], ['scheduled', 'Scheduled'], ['new', 'New']], 'contacted')}
    <label class="check"><input type="checkbox" id="nb-rem"><span>Remind them when the next service is due</span></label>
    <button class="btn btn-primary" style="margin-top:8px" type="button" data-act="saveNewBooking">Save booking</button></div></div>`;
  if (c) {
    const set = (id, v) => { const el = $('#' + id); if (el && v) el.value = v; };
    set('nb-name', c.name); set('nb-phone', c.phone); set('nb-email', c.email); set('nb-area', c.area); set('nb-addr', c.address);
    const b = S.bikes.filter((x) => x.customer_id === c.id)[0]; if (b) { set('nb-brand', b.brand); set('nb-model', b.model); set('nb-nick', b.nickname); set('nb-reg', b.reg_no); }
  }
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0; $((c ? '#nb-service' : '#nb-name')).focus();
}
function openMechanic(id) {
  const m = id === 'new' ? { id: 'new', name: '', phone: '', area: '', active: true, payout_rate: 0, city: 'Bengaluru', specialties: '', experience_years: 0, certified: true, notes: '' } : S.mechanics.find((x) => x.id === id); if (!m) return;
  const st = id === 'new' ? null : mechanicStats(S.mechanics, S.leads, { basis: basis() }).find((x) => x.id === id);
  const ro = isOwner() ? '' : ' disabled';
  S.open = null; S.openCust = null; S.openMech = id;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${id === 'new' ? 'New mechanic' : esc(m.name)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><div class="inline-form">
    <label class="label" for="mn">Name</label><input id="mn" maxlength="60" value="${esc(m.name)}"${ro}>
    <label class="label" for="mp">Mobile number</label><input id="mp" inputmode="numeric" maxlength="10" value="${esc(m.phone)}"${ro}>
    <label class="label" for="ma">Area they cover (optional)</label><input id="ma" maxlength="40" value="${esc(m.area || '')}"${ro}>
    <div class="split-card"><h3 style="margin:0 0 4px">Revenue split</h3><p class="tiny muted" style="margin:0 0 10px">The company decides the percentage for each mechanic. It applies to the money collected on this mechanic's completed jobs${basis() === 'before_gst' ? ', before GST' : ' (GST included)'}.</p>
      <label class="label" for="mr-range">Mechanic's share</label>
      <div class="split-inputs"><input type="range" id="mr-range" min="0" max="100" step="5" value="${esc(m.payout_rate || 0)}"${ro} aria-label="Mechanic's share in percent"><span class="split-num"><input id="mr" inputmode="numeric" maxlength="3" value="${esc(m.payout_rate || 0)}"${ro} aria-label="Mechanic's share, number"><b>%</b></span></div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><span class="tiny muted" style="align-self:center">Quick pick:</span>${[30, 40, 50].map((p) => `<button class="btn btn-ghost btn-sm" type="button" data-act="mrPreset" data-pct="${p}"${ro}>${p}%</button>`).join('')}</div>
      <div id="split-bar" class="split-bar" role="img"></div><p id="split-sample" class="split-sample" role="status"></p><p class="tiny muted" style="margin:6px 0 0">In-garage jobs use ${esc(S.settings.garage_pct ?? 30)}% instead (change in Settings). A job can also have its own percentage and a plus or minus adjustment, from the booking.</p></div>
    <label class="label" for="mcity">City</label><input id="mcity" maxlength="40" value="${esc(m.city || 'Bengaluru')}"${ro}>
    <label class="label" for="msp">Specialties (for example: scooters, Royal Enfield, EV)</label><input id="msp" maxlength="120" value="${esc(m.specialties || '')}"${ro}>
    <label class="label" for="mexp">Years of experience</label><input id="mexp" inputmode="numeric" maxlength="2" value="${esc(m.experience_years || 0)}"${ro}>
    <label class="label" for="mnotes">Private notes (not shown to customers)</label><input id="mnotes" maxlength="500" value="${esc(m.notes || '')}"${ro}>
    <label class="check"><input type="checkbox" id="mcert"${m.certified !== false ? ' checked' : ''}${ro}><span>Mechanix Pro certified (shown to the customer in the confirmation)</span></label>
    <label class="check"><input type="checkbox" id="mc"${m.active ? ' checked' : ''}${ro}><span>Active (can be assigned new jobs)</span></label>
    ${isOwner() ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary" type="button" data-act="saveMechanic">Save</button>' + (id !== 'new' ? '<button class="btn btn-ghost" type="button" data-act="deleteMechanic">Delete mechanic</button>' : '') + '</div>' : '<p class="tiny muted">Only the owner can change mechanics.</p>'}</div></div>
  ${id === 'new' ? '' : mechDetail(id, st)}`;
  updateSplitPreview();
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}

/* One mechanic: every job's split in a table, totals, and the statement to share. */
function mechDetail(id, st) {
  const acct = salesModel().mechAccts.find((a) => a.mechanic.id === id), m = S.mechanics.find((x) => x.id === id);
  const open = st ? `${st.open} open · ${st.completed} completed` : '';
  if (!acct) return `<div class="card" style="margin-top:12px"><h3>Jobs and split</h3><p class="small muted" style="margin:0">${open}. The split appears here once a job has an invoice or a payment.</p></div>`;
  const jobs = [...acct.jobAccounts].sort((x, y) => new Date(y.issuedAt) - new Date(x.issuedAt));
  const sum = (f) => jobs.reduce((t, j) => t + f(j), 0);
  const rows = jobs.map((j) => `<tr class="inv-tr" data-lead="${j.lead_id}" tabindex="0"><td>${esc(new Date(j.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}<br><span class="tiny muted mono">${esc(j.ref)}</span></td><td>${j.jobPlace === 'garage' ? 'In garage' : 'Doorstep'}</td><td class="num">${rupee2(j.service)}${j.gst ? '<br><span class="tiny muted">+ GST ' + rupee2(j.gst) + '</span>' : ''}</td><td class="num">${j.mechanicPct}%${j.commissionAdjust ? '<br><span class="tiny muted">' + (j.commissionAdjust > 0 ? '+' : '−') + rupee2(Math.abs(j.commissionAdjust)) + '</span>' : ''}</td><td class="num"><b>${rupee2(j.earningsTotal)}</b></td><td class="num">${rupee2(j.companyShareTotal)}</td><td>${[j.byChannel.company_manual ? 'Company' : '', j.byChannel.company_portal ? 'Online' : '', j.byChannel.mechanic ? 'Mechanic' : ''].filter(Boolean).join(', ') || '<span class="muted">Unpaid</span>'}</td><td class="num">${j.payoutDue > 0.005 ? 'We owe ' + rupee2(j.payoutDue) : ''}${j.remitDue > 0.005 ? (j.payoutDue > 0.005 ? '<br>' : '') + 'Owes us ' + rupee2(j.remitDue) : ''}${j.payoutDue <= 0.005 && j.remitDue <= 0.005 ? '<span class="muted">Clear</span>' : ''}</td></tr>`).join('');
  const text = statementShareText({ mechanicName: m ? m.name : acct.mechanic.name, rows: jobs.map((j) => ({ ref: j.ref, date: new Date(j.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), place: j.jobPlace, earnings: j.earningsTotal })), totals: { earnings: acct.earnings, remitDue: acct.remitRemaining, payoutDue: acct.payoutRemaining, net: acct.net, netLabel: acct.netLabel } });
  const kpi = (v, l) => `<div class="kpi"><b>${rupee2(v)}</b><span>${l}</span></div>`;
  return `<div class="card" style="margin-top:12px"><h3>Jobs and split</h3><p class="tiny muted" style="margin:0 0 10px">${open}. Tap a job to open it and correct the commission.</p>
    <div class="kpis">${kpi(acct.serviceSales, 'Service sales')}${kpi(acct.earnings, 'Mechanic earnings')}${kpi(sum((j) => j.companyShareTotal), 'Company share')}${kpi(acct.paidOut, 'Paid to the mechanic')}${kpi(acct.payoutRemaining, 'We still owe')}${kpi(acct.remitRemaining, 'Mechanic still owes us')}</div>
    <p style="margin:10px 0"><span class="pill ${acct.status === 'Settled' ? 'p-ok' : 'p-warn'}">${esc(acct.status)}</span> <b class="tnum">${acct.net ? rupee2(Math.abs(acct.net)) : ''}</b> <span class="muted">${esc(acct.netLabel)}</span></p>
    <div class="scroll"><table style="min-width:680px"><thead><tr><th>Job</th><th>Type</th><th class="num">Service</th><th class="num">Share</th><th class="num">Mechanic earns</th><th class="num">We keep</th><th>Paid to</th><th class="num">Balance</th></tr></thead><tbody>${rows}<tr class="tot"><td colspan="2"><b>${jobs.length} job${jobs.length === 1 ? '' : 's'}</b></td><td class="num"><b>${rupee2(sum((j) => j.service))}</b></td><td></td><td class="num"><b>${rupee2(acct.earnings)}</b></td><td class="num"><b>${rupee2(sum((j) => j.companyShareTotal))}</b></td><td></td><td></td></tr></tbody></table></div>
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${m && m.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(m.phone, text))}">Share statement on WhatsApp</a>` : ''}<button class="btn btn-ghost btn-sm" type="button" data-act="copyText" data-text="${esc(text)}">Copy statement</button><button class="btn btn-ghost btn-sm" type="button" data-act="openMoneyTab">Open mechanic ledgers</button></div></div>`;
}

/* ---------- coupons ---------- */
function coupons() {
  const rows = couponRows(S.coupons, S.leads);
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">Customers type a code on the booking form. The server works out the discount, and your expert applies it on the WhatsApp quote. A code counts as used once its booking is paid, scheduled or completed.</p>${isOwner() ? '<button class="btn btn-primary btn-sm" type="button" data-act="newCoupon">New coupon</button>' : ''}</div>
  <div class="list">${rows.length ? rows.map((c) => `<button class="row mrow" data-coupon="${c.id}"><span><b>${esc(c.code)}</b> <span class="pill ${c.status === 'Active' ? 'paid' : 'off'}">${c.status}</span><br><span class="meta">${esc(c.offer)}</span></span><span class="meta">${c.requested} asked</span><span class="meta">${c.used}${c.maxUses ? ' of ' + c.maxUses : ''} used</span><b>${rupee(c.given)}</b></button>`).join('') : '<p class="muted" style="padding:16px">No coupons yet. Create your first one to run an offer.</p>'}</div>`;
}
function openCoupon(id) {
  const c = id === 'new' ? { id: 'new', code: '', kind: 'percent', value: 10, minAmount: 0, maxUses: null, startsOn: '', endsOn: '', active: true, note: '' } : couponRows(S.coupons, S.leads).find((x) => x.id === id); if (!c) return;
  const ro = isOwner() ? '' : ' disabled';
  S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = id;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${id === 'new' ? 'New coupon' : esc(c.code)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><div class="inline-form">
    <label class="label" for="cc">Code (letters, numbers, dash)</label><input id="cc" maxlength="20" autocapitalize="characters" value="${esc(c.code)}"${id === 'new' ? ro : ' disabled'}>
    <label class="label" for="ck">Type</label><select id="ck"${ro}><option value="percent"${c.kind === 'percent' ? ' selected' : ''}>Percent off</option><option value="flat"${c.kind === 'flat' ? ' selected' : ''}>Rupees off</option></select>
    <label class="label" for="cv">Amount (percent, or rupees)</label><input id="cv" inputmode="numeric" maxlength="5" value="${esc(c.value)}"${ro}>
    <label class="label" for="cm">Minimum order, rupees (0 for none)</label><input id="cm" inputmode="numeric" maxlength="6" value="${esc(c.minAmount)}"${ro}>
    <label class="label" for="cu">Use limit (leave empty for none)</label><input id="cu" inputmode="numeric" maxlength="5" value="${esc(c.maxUses ?? '')}"${ro}>
    <label class="label" for="cs">Starts on</label><input id="cs" type="date" value="${esc(c.startsOn || '')}"${ro}>
    <label class="label" for="ce">Ends on</label><input id="ce" type="date" value="${esc(c.endsOn || '')}"${ro}>
    <label class="label" for="cn2">Private note</label><input id="cn2" maxlength="200" value="${esc(c.note || '')}"${ro}>
    <label class="check"><input type="checkbox" id="ca"${c.active ? ' checked' : ''}${ro}><span>Switched on</span></label>
    ${isOwner() ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary" type="button" data-act="saveCoupon">Save</button>' + (id !== 'new' ? '<button class="btn btn-ghost" type="button" data-act="deleteCoupon">Delete coupon</button>' : '') + '</div>' : '<p class="tiny muted">Only the owner can change coupons.</p>'}</div></div>
  ${id === 'new' ? '' : `<div class="card" style="margin-top:12px"><h3>Use so far</h3><dl class="kv"><dt>Asked for</dt><dd>${c.requested}</dd><dt>Went ahead</dt><dd>${c.used}</dd><dt>Discount given</dt><dd>${rupee(c.given)}</dd></dl></div>`}`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}

/* ---------- reports ---------- */
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['90d', 'Last 90 days'], ['all', 'All time']];
function payoutTable(p) {
  if (!p.rows.length) return '<div class="card" style="margin-top:16px"><h3>Mechanic payouts</h3><p class="muted">No completed jobs with a mechanic in this period yet.</p></div>';
  return `<div class="card" style="margin-top:16px"><h3>Mechanic payouts</h3><p class="tiny muted" style="margin:0 0 8px">From completed jobs. Mechanic and company shares use each mechanic's percentage${basis() === 'before_gst' ? ', worked out before GST' : ''}.</p>
  <div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Mechanic</th><th>Split</th><th>Jobs</th><th>Collected</th>${p.totals.gst ? '<th>GST</th>' : ''}<th>Mechanic gets</th><th>Company keeps</th></tr></thead><tbody>
  ${p.rows.map((r) => `<tr><td>${esc(r.name)}</td><td><span class="splitbar" aria-hidden="true"><i style="width:${r.rate}%"></i></span> ${r.rate}/${100 - r.rate}</td><td>${r.jobs}</td><td>${rupee(r.collected)}</td>${p.totals.gst ? `<td>${rupee(r.gst)}</td>` : ''}<td>${rupee(r.mechanic)}</td><td>${rupee(r.company)}</td></tr>`).join('')}
  <tr class="tot"><td><b>Total</b></td><td></td><td><b>${p.totals.jobs}</b></td><td><b>${rupee(p.totals.collected)}</b></td>${p.totals.gst ? `<td><b>${rupee(p.totals.gst)}</b></td>` : ''}<td><b>${rupee(p.totals.mechanic)}</b></td><td><b>${rupee(p.totals.company)}</b></td></tr></tbody></table></div></div>`;
}
function reportData() { return buildReport(S.leads, { services: S.services, mechanics: S.mechanics }, rangeFor(S.range)); }
function adsInfoText() {
  const r = adsConversions(S.leads), k = r.skipped;
  return `${r.rows.length} completed job${r.rows.length === 1 ? '' : 's'} ready to send` + (k.noClick ? `. ${k.noClick} completed job${k.noClick === 1 ? ' has' : 's have'} no Google click ID (not from a Google ad)` : '') + (k.tooOld ? `. ${k.tooOld} too old (over 90 days)` : '') + '.';
}
function reports() {
  const r = reportData(), t = r.totals;
  const table = (title, rows) => `<div class="card"><h3>${title}</h3>${rows.length ? `<table class="rtable"><thead><tr><th></th><th>Bookings</th><th>Collected</th></tr></thead><tbody>${rows.map((x) => `<tr><td>${esc(x.name)}</td><td>${x.count}</td><td>${rupee(x.collected)}</td></tr>`).join('')}</tbody></table>` : '<p class="small muted">No bookings in this period.</p>'}</div>`;
  return `<div class="toolbar"><select id="rr" aria-label="Period">${RANGES.map(([k, n]) => `<option value="${k}"${S.range === k ? ' selected' : ''}>${n}</option>`).join('')}</select><button class="btn btn-ghost btn-sm" type="button" data-act="reportCsv">Download CSV</button></div>
  <div class="kpis">
    <div class="kpi"><b>${t.bookings}</b><span>Bookings</span></div>
    <div class="kpi"><b>${t.wentAhead}</b><span>Went ahead (paid, scheduled, completed)</span></div>
    <div class="kpi"><b>${t.conversion}%</b><span>Share that went ahead</span></div>
    <div class="kpi"><b>${rupee(t.collected)}</b><span>Collected</span></div>
    <div class="kpi"><b>${rupee(t.avgOrder)}</b><span>Average paid order</span></div>
    <div class="kpi"><b>${rupee(t.discount)}</b><span>Coupon discount given</span></div>
  </div>
  <div class="split2">${table('By service', r.byService)}${table('By area', r.byArea)}${table('By mechanic', r.byMechanic)}${table('By source', r.bySource)}</div><div class="card" style="margin-top:12px"><h3>Google Ads: completed jobs</h3><p class="small muted" style="margin:0 0 8px">Tell Google which ad clicks became real customers, so it finds more like them. Download the file and upload it in Google Ads (steps in docs/GOOGLE-ADS-OFFLINE.md). Only completed jobs from the last 90 days that have a Google click ID are included.</p><p class="small" id="adsInfo" style="margin:0 0 10px">${adsInfoText()}</p><button class="btn btn-ghost btn-sm" type="button" data-act="adsExport">Download Google Ads upload file</button></div>${payoutTable(payoutReport(r.leads, S.mechanics, basis()))}`;
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.leads.filter((l) => (S.status === 'all' || (S.status === 'open' ? ['new', 'contacted', 'quoted', 'payment_sent'].includes(l.status) : l.status === S.status)) &&
    (!q || [l.name, l.phone, l.ref, l.area].some((v) => String(v ?? '').toLowerCase().includes(q))));
}
function renderList() {
  const el = $('#list'); if (!el) return; const rows = filtered();
  el.innerHTML = rows.length ? rows.map((l) => `<button class="row${S.selMode && S.sel.has(l.id) ? ' picked' : ''}" data-lead="${l.id}"${S.selMode ? ` aria-pressed="${S.sel.has(l.id)}"` : ''}><span class="ref">${S.selMode ? `<span class="chk" aria-hidden="true">${S.sel.has(l.id) ? '\u2611' : '\u2610'}</span> ` : ''}${esc(l.ref)}<br><span class="meta">${l.source === 'whatsapp' ? 'WhatsApp' : 'Website'}</span></span><span>${esc(l.name)} · <span class="meta">${esc(l.phone)}</span><br><span class="meta">${esc(svcName(l.service_id))} · ${esc(l.area || '')} · ${l.preferred_date ? esc(l.preferred_date) + ' ' + esc(SLOT[l.preferred_slot] ?? '') : ''}</span></span><span style="text-align:right"><span class="pill ${l.status}">${LABEL[l.status]}</span><br><span class="meta">${l.est_total ? rupee(l.est_total) : ''} · ${when(l.created_at)}</span></span></button>`).join('') : '<p class="muted" style="padding:16px">No bookings here yet.</p>';
}

/* ---------- commission: one simple rule per job ---------- */
const defaults = () => ({ doorstep_pct: S.settings.doorstep_pct, garage_pct: S.settings.garage_pct });
function jobRate(l) { return effectiveRate({ lead: l, mechanic: S.mechanics.find((x) => x.id === l.mechanic_id) || null, settings: defaults() }); }
function mechFor(l) { const m = S.mechanics.find((x) => x.id === l.mechanic_id) || null; return m ? { ...m, payout_rate: jobRate(l).pct } : null; }
const SRC = { job: 'set on this job', mechanic: "this mechanic's usual rate", default: 'the standard rate', 'garage default': 'the in-garage rate' };
const isoDay = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60000).toISOString().slice(0, 10) : '');
function jobFacts(l) {
  const a = salesModel().accounts.find((x) => x.lead_id === l.id);
  const inv = buildInvoice(withBike(l), S.services), rate = jobRate(l), sp = jobSplit({ service: inv.taxable, gst: inv.total - inv.taxable, pct: rate.pct, adjust: l.commission_adjust });
  const dd = new Date(l.completed_at || l.paid_at || l.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const bc = a ? a.byChannel : { company_manual: 0, company_portal: 0, mechanic: 0 };
  return { inv, rate, sp, a, job: { ref: l.ref, date: dd, place: rate.place, service: sp.base, gst: sp.gst, total: inv.total, pct: sp.pct, adjust: sp.adjust, adjustNote: l.commission_note || '', earnings: sp.earnings, company: sp.company, collected: a ? a.collected : 0, byChannel: bc, remitDue: a ? a.remitDue : 0, payoutDue: a ? a.payoutDue : 0 } };
}
const waLink = (phone, text) => 'https://wa.me/91' + String(phone || '').replace(/\D/g, '').slice(-10) + '?text=' + encodeURIComponent(text);
function payoutCard(l) {
  const m = S.mechanics.find((x) => x.id === l.mechanic_id); if (!m) return '';
  try { return payoutCardBody(l, m); } catch (e) { console.error('payoutCard', e); return '<div class="card" style="margin-top:12px"><h3>Payout for this job</h3><p class="small muted" style="margin:0">Could not work out the payout for this job. Open Money, then Mechanic ledgers.</p></div>'; }
}
function payoutCardBody(l, m) {
  const { inv, rate, sp, a, job } = jobFacts(l), place = PLACES[rate.place];
  const text = payoutShareText({ mechanicName: m.name, job }), owner = isOwner();
  const earnPct = sp.base ? Math.round((sp.earnings / sp.base) * 100) : 0;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  const money = a ? row('Customer paid', rupee2(a.collected)) + (a.byChannel.mechanic ? row('Collected by the mechanic', rupee2(a.byChannel.mechanic)) : '') + row(`${esc(m.name)} gets paid`, rupee2(a.payoutDue) + ' <span class="tiny muted">still to pay</span>') + (a.remitDue > 0.005 ? row('Mechanic must send us', '<b>' + rupee2(a.remitDue) + '</b>') : '') : row('Customer paid', rupee2(l.paid_amount || 0));
  const edit = owner ? `<details class="cm-edit" style="margin-top:12px"><summary class="btn btn-ghost btn-sm" style="display:inline-block">Edit commission</summary>
    <div class="inline-form" style="margin-top:10px">
      <label class="label" for="cm-place">Where was the job done?</label><select id="cm-place"><option value="doorstep"${rate.place === 'doorstep' ? ' selected' : ''}>Doorstep</option><option value="garage"${rate.place === 'garage' ? ' selected' : ''}>In garage</option></select>
      <label class="label" for="cm-pct">Mechanic's share of the service amount (%)</label>
      <div class="split-inputs"><span class="split-num"><input id="cm-pct" inputmode="numeric" maxlength="3" value="${l.commission_pct == null ? '' : esc(l.commission_pct)}" placeholder="${rate.pct}"><b>%</b></span><span style="display:flex;gap:6px;flex-wrap:wrap">${[30, 40, 50].map((p) => `<button class="btn btn-ghost btn-sm" type="button" data-act="cmPreset" data-pct="${p}">${p}%</button>`).join('')}<button class="btn btn-ghost btn-sm" type="button" data-act="cmPreset" data-pct="">Usual rate</button></span></div>
      <p class="tiny muted" style="margin:4px 0 0">Empty means ${rate.source === 'job' ? 'the usual rate' : SRC[rate.source]} (${rate.pct}%).</p>
      <label class="label" for="cm-adj">Commission adjustment in rupees (plus or minus)</label><input id="cm-adj" inputmode="decimal" maxlength="9" value="${l.commission_adjust ? esc(l.commission_adjust) : ''}" placeholder="0, for example 50 or -100">
      <label class="label" for="cm-reason">Reason for the adjustment</label><input id="cm-reason" maxlength="200" value="${esc(l.commission_note || '')}" placeholder="For example: extra trip, parts returned">
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary btn-sm" type="button" data-act="saveCommission">Save commission</button></div></div></details>` : '';
  return `<div class="card" style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">Payout for this job</h3><span class="pill ${rate.place === 'garage' ? 'p-info' : 'p-ok'}">${place}</span></div>
    <div class="split-bar" role="img" aria-label="Mechanic ${earnPct} percent, company ${100 - earnPct} percent" style="margin-top:10px"><span class="sb-mech" style="width:${earnPct}%">${earnPct >= 14 ? earnPct + '%' : ''}</span><span class="sb-co" style="width:${100 - earnPct}%">${100 - earnPct >= 14 ? (100 - earnPct) + '%' : ''}</span></div>
    <dl class="kv" style="margin-top:10px">${row('Service amount (before GST)', rupee2(sp.base))}${sp.gst ? row('GST, kept aside', rupee2(sp.gst)) : row('GST', 'None on this invoice')}${row('Invoice total', rupee2(inv.total))}${row(esc(m.name) + "'s share", sp.pct + '% <span class="tiny muted">(' + SRC[rate.source] + ')</span> = ' + rupee2(sp.byPct))}${sp.adjust ? row('Adjustment', (sp.adjust > 0 ? '+' : '−') + rupee2(Math.abs(sp.adjust)) + (l.commission_note ? ' <span class="tiny muted">' + esc(l.commission_note) + '</span>' : '')) : ''}${row(esc(m.name) + ' earns', '<b>' + rupee2(sp.earnings) + '</b>')}${row('Mechanix Pro keeps', '<b>' + rupee2(sp.company) + '</b>')}${money}</dl>
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${m.phone ? `<a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(m.phone, text))}">Share on WhatsApp</a>` : '<span class="tiny muted">Add the mechanic\'s mobile number to share on WhatsApp.</span>'}<button class="btn btn-ghost btn-sm" type="button" data-act="copyText" data-text="${esc(text)}">Copy message</button></div>${edit}</div>`;
}

const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
function serviceEditCard(l) {
  const bike = S.bikes.find((b) => b.id === l.bike_id);
  const pkgs = S.services.filter((x) => x.kind === 'service' && !/(250|500)$/.test(x.id)), adds = S.services.filter((x) => x.kind === 'addon');
  const slot = (v, t) => `<option value="${v}"${l.preferred_slot === v ? ' selected' : ''}>${t}</option>`;
  return `<details class="card" style="margin-top:12px" id="esCard"><summary style="cursor:pointer;font:600 17px var(--f-display)">Service, visit time and address</summary>
    <p class="tiny muted" style="margin:8px 0 6px">Change the package, add-ons, visit time or place. The estimate is worked out again from the live prices. Press Save changes at the bottom to keep your edits.</p>
    <label class="label" for="es-service">Service</label><select id="es-service"><option value="">Not chosen yet</option>${pkgs.map((x) => `<option value="${x.id}"${x.id === l.service_id ? ' selected' : ''}>${esc(x.name)} (${rupee(x.price)})</option>`).join('')}</select>
    <fieldset style="border:0;padding:0;margin:10px 0 0"><legend class="label">Add-ons</legend>${adds.map((x) => `<label class="check"><input type="checkbox" data-es-addon="${x.id}"${(l.addons || []).includes(x.id) ? ' checked' : ''}><span>${esc(x.name)} (${x.price ? rupee(x.price) : 'free'})</span></label>`).join('')}</fieldset>
    ${engineField('es', bike, !!bike)}
    <label class="label" for="es-date">Visit day</label><input id="es-date" type="date" value="${esc(l.preferred_date || '')}">
    <label class="label" for="es-slot">Time slot</label><select id="es-slot"><option value="">No slot</option>${slot('morning', 'Morning (9 to 12)')}${slot('afternoon', 'Afternoon (12 to 4)')}${slot('evening', 'Evening (4 to 8)')}${slot('asap', 'As soon as possible')}</select>
    <label class="label" for="es-time">Exact time <span class="muted" style="font-weight:400">(optional)</span></label><input id="es-time" maxlength="30" value="${esc(l.preferred_time || '')}" placeholder="For example: 5:30 PM">
    <label class="label" for="es-area">Area</label><input id="es-area" maxlength="40" value="${esc(l.area || '')}">
    <label class="label" for="es-pin">PIN code</label><input id="es-pin" inputmode="numeric" maxlength="6" value="${esc(l.pincode || '')}">
    <label class="label" for="es-address">Address</label><textarea id="es-address" rows="2" maxlength="200">${esc(l.address || '')}</textarea>
    <label class="label" for="es-note">What is wrong or what the customer asked for</label><textarea id="es-note" rows="2" maxlength="500">${esc(l.note || '')}</textarea>
    <p class="small" style="margin:12px 0 0"><b>New estimate: <span id="es-est">${l.est_total != null ? rupee(l.est_total) : 'not set'}</span></b></p>
    ${l.invoice_override ? '<p class="tiny muted" style="margin:6px 0 0">The invoice was edited by hand, so it will not change. Open Invoice to update it.</p>' : ''}
  </details>`;
}
// The customer on this booking: edit their details, or move the booking to a different customer.
function customerCard(l) {
  const c = S.customers.find((x) => x.id === l.customer_id) || S.customers.find((x) => x.phone === l.phone) || null;
  return `<div class="card" style="margin-top:12px"><h3>Customer</h3><p style="margin:0">${esc(c ? c.name : l.name)} · +91 ${esc(c ? c.phone : l.phone)}${c && c.email ? ' · ' + esc(c.email) : ''}</p>
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">${c ? `<button class="btn btn-ghost btn-sm" type="button" data-act="editCustomerFromBooking" data-id="${c.id}">Edit customer details</button>` : ''}<button class="btn btn-ghost btn-sm" type="button" data-act="showMoveBooking">Change customer</button></div>
    <div id="moveBox" hidden style="margin-top:10px"><label class="label" for="cc-q">Move this booking to another customer</label><input id="cc-q" type="search" placeholder="Search name or phone" autocomplete="off"><div id="cc-res" style="margin-top:8px"></div></div></div>`;
}
// Saved copies of this booking's invoice. The owner can delete them (they are hidden, not erased) and restore them.
function invoiceCard(l) {
  const mine = S.invoicesAll.filter((r) => r.lead_id === l.id).sort((a, b) => b.revision - a.revision);
  const live = mine.filter((r) => !r.voided_at);
  let made = null;
  if (!mine.length) { try { const inv = buildInvoice(withBike(l), S.services, { customer: S.customers.find((c) => c.id === l.customer_id) || null }); if (inv.lines.length) made = inv; } catch (e) { made = null; } }
  if (!mine.length && !made) return '';
  const row = (r) => `<tr${r.voided_at ? ' style="opacity:.6"' : ''}><td><b>${esc(r.number)}</b>${r.voided_at ? ' <span class="pill p-bad">Deleted</span>' : ''}</td><td>${esc(when(r.issued_at))}</td><td class="num">${rupee2(r.total)}</td><td class="tiny muted">${r.has_gst ? 'GST ' + r.gst_rate + '%' : 'No GST'}${r.voided_at && r.void_reason ? ' · ' + esc(r.void_reason) : ''}</td></tr>`;
  const table = mine.length ? `<div class="scroll"><table style="min-width:420px"><thead><tr><th>Number</th><th>Saved</th><th class="num">Total</th><th></th></tr></thead><tbody>${mine.map(row).join('')}</tbody></table></div>` : `<p class="small" style="margin:0"><b>${esc(made.number)}</b> · ${rupee2(made.total)} <span class="muted">· made from the booking, saved when printed or emailed</span></p>`;
  return `<div class="card" style="margin-top:12px"><h3>Invoice</h3>${table}
    ${isOwner() ? `<div class="row-btns" style="margin-top:10px">${live.length || made ? '<button class="btn btn-ghost btn-sm" type="button" data-act="voidInvoice">Delete invoice</button>' : '<button class="btn btn-ghost btn-sm" type="button" data-act="restoreInvoice">Restore invoice</button>'}</div><p class="tiny muted" style="margin:8px 0 0">Deleting hides the invoice from the register and the sales figures. The booking and its payments stay. You can restore it.</p>` : '<p class="tiny muted" style="margin:8px 0 0">Only the owner can delete an invoice.</p>'}</div>`;
}
// Where the booking came from, and a way to link it to a Google ad click with the Ref code from the customer's WhatsApp message.
function adCard(l) {
  const u = l.utm || {}, linked = !!(u.gclid || u.utm_campaign || (u.utm_source && u.utm_source !== 'direct'));
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  return `<div class="card" style="margin-top:12px"><h3>Where it came from</h3><dl class="kv">${row('Source', esc(l.source || '—'))}${linked ? row('Campaign', esc(u.utm_campaign || u.utm_source || 'Ad click')) + (u.utm_term ? row('Search', esc(u.utm_term)) : '') + row('Google click ID', u.gclid ? '<span class="pill p-ok">Saved</span>' : '<span class="pill p-mute">None</span>') : row('Ad', 'Not linked to an ad click')}</dl>
    ${u.gclid ? '' : `<div class="inline-form" style="margin-top:8px"><label class="label" for="ad-ref">Ref code from the customer's WhatsApp message</label><input id="ad-ref" maxlength="5" autocapitalize="characters" placeholder="K7P2M" autocomplete="off"><button class="btn btn-ghost btn-sm" type="button" data-act="linkAdRef" style="margin-top:8px">Link to the ad click</button></div>`}</div>`;
}
// How this booking was paid: who collected each rupee (company manual, online, mechanic), what is still owed, and every payment.
function moneyCard(l) {
  try { return moneyCardBody(l); } catch (e) { console.error('moneyCard', e); return `<div class="card" style="margin-top:12px"><h3>Payments and who collected them</h3><p class="small muted" style="margin:0">Could not load the payment summary (${esc(e && e.message)}). Open Money to see this booking.</p><div class="row-btns" style="margin-top:10px"><button class="btn btn-ghost btn-sm" type="button" data-act="openMoney" data-id="${l.id}">Open money sheet</button></div></div>`; }
}
function moneyCardBody(l) {
  const a = salesModel().accounts.find((x) => x.lead_id === l.id), entries = S.ledger.filter((e) => e.lead_id === l.id).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  const head = '<h3>Payments and who collected them</h3>';
  const btn = `<div class="row-btns" style="margin-top:10px"><button class="btn btn-ghost btn-sm" type="button" data-act="openMoney" data-id="${l.id}">Open money sheet to record or refund</button></div>`;
  if (!a) return `<div class="card" style="margin-top:12px">${head}<p class="small muted" style="margin:0">${entries.length ? 'Payments are listed below. The invoice figures appear once the service is chosen.' : 'No payment recorded yet. Record one below with Mark paid, or in the money sheet.'}</p>${entries.length ? entryRows(entries, true) : ''}${btn}</div>`;
  const row = (k, v) => `<dt>${k}</dt><dd>${v}</dd>`;
  return `<div class="card" style="margin-top:12px">${head}<p style="margin:0 0 6px">${a.statusLabels.map(statusPill).join(' ')}</p>
    <dl class="kv">${row('Invoice total', '<b>' + rupee2(a.total) + '</b>')}${row('Collected by the company, manual', rupee2(a.byChannel.company_manual))}${row('Collected online (Razorpay)', rupee2(a.byChannel.company_portal))}${row('Collected by the mechanic', rupee2(a.byChannel.mechanic))}${row('Customer still owes', '<b>' + rupee2(a.outstanding) + '</b>')}${a.mechanicId ? row('Mechanic must pay the company', rupee2(a.remitDue)) + row('Company must pay the mechanic', rupee2(a.payoutDue)) : ''}</dl>
    ${entryRows(entries, true)}${btn}</div>`;
}
async function openLead(id, silent) {
  if (!silent && S.open !== id) S.dt = 'booking';
  S.open = id; const l = S.leads.find((x) => x.id === id); if (!l) return;
  const { data: msgs } = await sb.from('messages').select('*').eq('lead_id', id).order('created_at').limit(200);
  const wa = 'https://wa.me/91' + l.phone;
  const DETAILS = `<div class="card"><dl class="kv"><dt>Customer</dt><dd>${esc(l.name)}<br><a href="tel:+91${esc(l.phone)}">+91 ${esc(l.phone)}</a></dd><dt>Service</dt><dd>${esc(svcName(l.service_id))}${(l.addons || []).length ? ' + ' + l.addons.map((a) => esc(svcName(a))).join(', ') : ''}</dd><dt>Estimate</dt><dd>${l.est_total ? rupee(l.est_total) : '—'}</dd><dt>Area</dt><dd>${esc(l.area || '—')}</dd><dt>When</dt><dd>${esc(l.preferred_date || '—')} · ${esc(l.preferred_time || SLOT[l.preferred_slot] || '—')}</dd>${leadDetailRows(l).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Map pin' ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open in Google Maps</a>` : esc(v)}</dd>`).join('')}<dt>Source</dt><dd>${esc(l.source)}${l.utm?.utm_campaign ? ' · ' + esc(l.utm.utm_campaign) : ''}</dd><dt>Created</dt><dd>${when(l.created_at)}</dd><dt>Reminders</dt><dd>${l.next_followup_at ? 'Next ' + when(l.next_followup_at) + ' (step ' + (l.followup_step + 1) + ' of 4)' : 'None scheduled'}</dd></dl>
  <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">Open WhatsApp chat</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a></div></div>`, MECH = `${S.mechanics.filter((m) => m.active || m.id === l.mechanic_id).map((m) => `<option value="${m.id}"${m.id === l.mechanic_id ? ' selected' : ''}>${esc(m.name)}${m.active ? '' : ' (inactive)'}</option>`).join('')}`, CONV = `<div class="card"><h3>WhatsApp conversation</h3><div class="chat">${(msgs ?? []).map((m) => `<div class="bubble ${m.direction}">${esc(m.body)}<small>${m.direction === 'in' ? 'Customer' : m.sender === 'ai' ? 'AI assistant' : m.sender === 'staff' ? 'Team' : 'Automatic'} · ${when(m.created_at)}</small></div>`).join('') || '<p class="muted small">No messages yet. The conversation appears here once WhatsApp automation is connected.</p>'}</div></div>`;
  S.dt = S.dt || 'booking';
  const dtab = (id, label) => `<button type="button" role="tab" data-dt="${id}" aria-selected="${S.dt === id}">${label}</button>`;
  const panel = (id, inner) => `<section class="dpanel" id="dt-${id}"${S.dt === id ? '' : ' hidden'}>${inner}</section>`;
  const linkBlock = l.payment_link ? `<p class="small">Payment link: <a href="${esc(l.payment_link)}" target="_blank" rel="noopener">${esc(l.payment_link)}</a> (${rupee(l.amount_due)})</p><p><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="https://wa.me/91${esc(l.phone)}?text=${encodeURIComponent('Hi ' + String(l.name).split(' ')[0] + ', here is your secure link to pay ' + rupee(l.amount_due) + ' for booking ' + l.ref + ': ' + l.payment_link)}">Send link on WhatsApp</a></p>` : '';
  const customerEmail = S.customers.find((c) => c.id === l.customer_id)?.email || '';
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${esc(l.ref)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p style="margin:8px 0"><span class="pill ${l.status}">${LABEL[l.status]}</span> ${l.opted_out ? '<span class="pill lost">Opted out</span>' : ''} ${l.paid_amount ? `<span class="pill paid">Paid ${rupee(l.paid_amount)}</span>` : ''}</p>
  <div class="qa"><a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a><button class="btn btn-ghost btn-sm" type="button" data-act="invoice">Invoice</button><button class="btn btn-ghost btn-sm" type="button" data-act="confirmBooking">Confirm and email customer</button><button class="btn btn-ghost btn-sm" type="button" data-act="issueFromLead">Log an issue</button></div>
  <div class="dtabs" role="tablist" aria-label="Booking sections">${dtab('booking', 'Booking')}${dtab('money', 'Money')}${dtab('customer', 'Customer')}${dtab('messages', 'Messages')}</div>
  ${panel('booking', `${DETAILS}
    <div class="card" style="margin-top:12px"><h3>Update</h3>
      <label class="label" for="ls">Status</label><select id="ls">${STATUSES.map((s) => `<option value="${s}"${s === l.status ? ' selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
      <label class="label" for="lm">Mechanic</label><select id="lm"><option value="">Not assigned</option>${MECH}</select>
      <label class="label" for="la">Garage or outside partner (if not on your mechanic list)</label><input id="la" value="${esc(l.assigned_to || '')}" maxlength="60">
      <label class="label" for="ln">Notes</label><textarea id="ln" rows="3" maxlength="1000">${esc(l.notes || '')}</textarea>
      <label class="check"><input type="checkbox" id="lai"${l.ai_enabled ? ' checked' : ''}><span>AI assistant replies and automatic reminders for this booking</span></label></div>
    ${serviceEditCard(l)}
    ${isOwner() ? '<div class="card" style="margin-top:12px"><h3>Delete this booking</h3><p class="tiny muted" style="margin:0 0 8px">A booking with no invoice or payment is erased. One that has either is moved to Deleted bookings, where you can restore it.</p><button class="btn btn-ghost btn-sm" type="button" data-act="deleteLead">Delete booking</button></div>' : ''}`)}
  ${panel('money', `${moneyCard(l)}
    <div class="card" style="margin-top:12px"><h3>Take a payment</h3>
      <label class="label" for="pa">Amount (₹) <span class="muted" style="font-weight:400">(${S.leads.some((x) => x.phone === l.phone && x.id !== l.id && x.status === 'completed') ? 'returning customer' : 'new customer'} slot fee by default; saved as the amount due)</span></label><input id="pa" inputmode="numeric" value="${esc(l.amount_due || slotFeeFor(l))}" data-init="${esc(l.amount_due || slotFeeFor(l))}">
      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px"><b>Money received already</b>
        <label class="label" for="pby">Who received it</label><select id="pby"><option value="company_manual">The company (cash, bank or UPI)</option>${l.mechanic_id ? `<option value="mechanic">The mechanic ${esc((S.mechanics.find((m) => m.id === l.mechanic_id) || {}).name || '')}</option>` : ''}</select>${l.mechanic_id ? '' : '<p class="tiny muted" style="margin:4px 0 0">Assign a mechanic on the Booking tab to record money the mechanic collected.</p>'}
        <div style="margin-top:10px"><button class="btn btn-primary btn-sm" type="button" data-act="markPaid">Record payment received</button></div></div>
      <div style="border-top:1px solid var(--line);margin-top:14px;padding-top:12px"><b>Ask the customer to pay online</b>${linkBlock}
        <label class="label" for="pe">Customer email <span class="muted" style="font-weight:400">(the payment link is emailed here)</span></label><input id="pe" type="email" inputmode="email" autocomplete="off" maxlength="254" placeholder="name@example.com" value="${esc(customerEmail)}">
        <div style="margin-top:10px"><button class="btn btn-ghost btn-sm" type="button" data-act="emailLink">Email payment link</button></div></div>
      <p class="tiny muted" style="margin:12px 0 0">Online payments through Razorpay are recorded automatically. Paid bookings stop all automatic reminders.</p></div>
    ${invoiceCard(l)}${payoutCard(l)}`)}
  ${panel('customer', `${customerCard(l)}${adCard(l)}`)}
  ${panel('messages', `${CONV}`)}
  <div class="sheet-save"><button class="btn btn-primary" type="button" data-act="saveBooking">Save changes</button><span class="tiny muted">Saves the status, mechanic, notes, service details and amount due together.</span></div>`;
  $('#sheet').hidden = false; if (!silent) $('#sheetPanel').scrollTop = 0;
  const chat = $('.chat'); if (chat) chat.scrollTop = chat.scrollHeight;
}
// Asks for a reason in a box on the page. The browser's own prompt() is blocked or ignored in some browsers, which made Delete look like it did nothing.
function askReason(title, hint, okLabel) {
  return new Promise((resolve) => {
    const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = `<div class="modal-box"><h3 style="margin:0 0 6px">${esc(title)}</h3><label class="label" for="mr-why">${esc(hint || 'Reason')}</label><input id="mr-why" maxlength="200" autocomplete="off"><p class="tiny muted" id="mr-err" style="margin:6px 0 0;color:var(--ember,#B45309)" hidden>A reason is needed.</p><div class="modal-btns"><button class="btn btn-ghost" type="button" data-md="no">Cancel</button><button class="btn btn-primary" type="button" data-md="yes">${esc(okLabel || 'Delete')}</button></div></div>`;
    document.body.appendChild(m);
    const inp = m.querySelector('#mr-why'), err = m.querySelector('#mr-err'); inp.focus();
    const done = (v) => { document.removeEventListener('keydown', onKey, true); m.remove(); resolve(v); };
    const yes = () => { const v = inp.value.trim(); if (!v) { err.hidden = false; inp.focus(); return; } done(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } else if (e.key === 'Enter' && document.activeElement === inp) { e.preventDefault(); yes(); } };
    document.addEventListener('keydown', onKey, true);
    m.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('[data-md]'); if (b) { if (b.dataset.md === 'yes') yes(); else done(null); } else if (e.target === m) done(null); });
  });
}
// Removes bookings. A booking with no invoice or payment is erased for good; one that has either is moved to "Deleted bookings" (hidden everywhere, restorable),
// because invoices and payments are accounting records that must not disappear.
async function removeBookings(ids, reason) {
  const [inv, led] = await Promise.all([sb.from('invoices').select('lead_id').in('lead_id', ids), sb.from('ledger_entries').select('lead_id').in('lead_id', ids)]);
  if (inv.error || led.error) return { error: (inv.error || led.error).message };
  const held = new Set([...(inv.data ?? []), ...(led.data ?? [])].map((r) => r.lead_id));
  const hard = ids.filter((i) => !held.has(i)), soft = ids.filter((i) => held.has(i));
  if (hard.length) { const { error } = await sb.from('leads').delete().in('id', hard); if (error) return { error: error.message }; }
  if (soft.length) { const { error } = await sb.from('leads').update({ deleted_at: new Date().toISOString(), deleted_reason: reason || null, next_followup_at: null }).in('id', soft); if (error) return { error: error.message }; }
  return { erased: hard.length, archived: soft.length };
}
const removedMsg = (r) => (r.archived && r.erased ? `${r.erased} erased, ${r.archived} moved to Deleted bookings` : r.archived ? (r.archived === 1 ? 'Moved to Deleted bookings (it has an invoice or payment). The owner can restore it.' : `${r.archived} moved to Deleted bookings (they have invoices or payments)`) : `${r.erased} deleted`);
function closeSheet() { $('#sheet').hidden = true; S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = null; }

document.addEventListener('input', (e) => { if (e.target.closest && e.target.closest('#esCard')) updateEstimate(); });
document.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#esCard')) updateEstimate(); });
function updateEstimate() {
  const el = $('#es-est'); if (!el) return;
  const r = buildServiceEdit({ service: $('#es-service').value, addons: [...document.querySelectorAll('[data-es-addon]')].filter((c) => c.checked).map((c) => c.getAttribute('data-es-addon')), ...engineRead('es') }, { services: S.services });
  el.textContent = r.ok && r.lead.est_total != null ? rupee(r.lead.est_total) : 'not set';
}
const ACT = {
  close: closeSheet,
  openBooking(btn) { S.tab = 'leads'; render(); openLead(btn.getAttribute('data-id')); },
  openMoney(btn) { S.tab = 'sales'; S.finJob = btn.getAttribute('data-id'); S.finKind = 'payment'; ACT.close(); render(); window.scrollTo({ top: 0 }); },
  finOpen(btn) { S.finJob = btn.getAttribute('data-lead'); S.finKind = 'payment'; render(); window.scrollTo({ top: 0 }); },
  finClose() { S.finJob = null; render(); },
  async finSave() {
    const a = salesModel().accounts.find((x) => x.lead_id === S.finJob), l = S.leads.find((x) => x.id === S.finJob); if (!a || !l) return;
    const v = (id) => ($('#' + id)?.value ?? '');
    const kind = S.finKind, r = buildEntry(kind, { amount: v('fin-amount'), by: v('fin-by'), method: v('fin-method'), reference: v('fin-ref'), on: v('fin-on'), reason: v('fin-reason'), note: v('fin-note'), mechanic: l.mechanic_id || '', gatewayFee: v('fin-fee'), txn: v('fin-txn'), settlement: v('fin-settle') }, { today: todayIST(), lead: l, collectedBy: a.byChannel, outstanding: a.outstanding });
    if (!r.ok) return toast(r.error);
    if (!confirm(`${FIN_KINDS[kind]}: ${rupee2(r.entry.amount)} for ${l.ref}? This cannot be edited later, only cancelled with a reason.`)) return;
    const { error } = await sb.from('ledger_entries').insert({ ...r.entry, created_by: S.me.user_id });
    if (error) return toast('Could not save: ' + error.message);
    if (kind === 'payment' && !['paid', 'scheduled', 'completed'].includes(l.status)) await sb.from('leads').update({ status: 'paid' }).eq('id', l.id);
    await audit('ledger_' + r.entry.entry_type, { ref: l.ref, amount: r.entry.amount, by: r.entry.collected_by });
    toast('Saved'); await Promise.all([loadLedger(), loadLeads()]); render();
  },
  async finReverse(btn) {
    const target = S.ledger.find((e) => e.id === btn.getAttribute('data-id')); if (!target) return toast('That entry was not found. Refresh the page.');
    const reason = await askReason(`Delete this ${entryLabel(target).toLowerCase()} of ${rupee2(target.amount)}?`, 'Why is it being deleted? It stays in the history, marked deleted.', 'Delete payment');
    if (!reason) return;
    const r = buildEntry('reversal', { reason, on: todayIST() }, { today: todayIST(), target });
    if (!r.ok) return toast(r.error);
    const { error } = await sb.from('ledger_entries').insert({ ...r.entry, created_by: S.me.user_id });
    if (error) return toast('Could not delete: ' + error.message);
    await audit('ledger_reversal', { entry: target.id, reason });
    await Promise.all([loadLedger(), loadLeads()]); toast('Payment deleted. The history keeps a record.');
    render(); if (S.open) openLead(S.open, true); else if (S.openCust) openCustomer(S.openCust);
  },
  mlOpen(btn) { const id = btn.getAttribute('data-id'); S.mlOpen = S.mlOpen === id ? null : id; render(); },
  async mlSave(btn) {
    const mid = btn.getAttribute('data-id'), kind = btn.getAttribute('data-kind'), v = (id) => ($('#' + id + '-' + mid + '-' + kind)?.value ?? '');
    const r = buildEntry(kind, { amount: v('ml-amount'), method: v('ml-method'), reference: v('ml-ref'), on: v('ml-on'), mechanic: mid }, { today: todayIST() });
    if (!r.ok) return toast(r.error);
    const m = S.mechanics.find((x) => x.id === mid);
    if (!confirm(`${kind === 'remittance' ? (m?.name || 'The mechanic') + ' paid the company' : 'The company paid ' + (m?.name || 'the mechanic')}: ${rupee2(r.entry.amount)}? This cannot be edited later, only cancelled with a reason.`)) return;
    const { error } = await sb.from('ledger_entries').insert({ ...r.entry, created_by: S.me.user_id });
    if (error) return toast('Could not save: ' + error.message);
    await audit('ledger_' + kind, { mechanic: m?.name, amount: r.entry.amount }); toast('Saved'); await loadLedger(); render();
  },
  async settle(btn) {
    const { error } = await sb.rpc('set_settlement', { entry_id: btn.getAttribute('data-id'), settled: btn.getAttribute('data-to') === 'yes' });
    if (error) return toast('Could not update: ' + error.message);
    await audit('ledger_settlement', { entry: btn.getAttribute('data-id'), settled: btn.getAttribute('data-to') === 'yes' }); await loadLedger(); render();
  },
  ledgerCsv() {
    if (!S.ledger.length) return toast('Nothing to download');
    const refs = Object.fromEntries(S.leads.map((l) => [l.id, l.ref])), mechanics = Object.fromEntries(S.mechanics.map((m) => [m.id, m.name]));
    const blob = new Blob(['\ufeff' + ledgerCsv([...S.ledger].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)), { refs, mechanics, who: whoRecorded })], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mechanix-transactions-' + todayIST() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  salesCsv() {
    const rows = salesRows(); if (!rows.length) return toast('Nothing to download');
    const blob = new Blob(['\ufeff' + salesCsv(rows)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mechanix-sales-collections-' + todayIST() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  cmPreset(btn) { const i = $('#cm-pct'); if (i) i.value = btn.getAttribute('data-pct'); },
  async saveCommission() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const r = cleanCommission({ place: $('#cm-place').value, pct: $('#cm-pct').value, adjust: $('#cm-adj').value, reason: $('#cm-reason').value });
    if (!r.ok) return toast(r.error);
    const { error } = await sb.from('leads').update(r.value).eq('id', l.id);
    if (error) return toast('Could not save: ' + error.message);
    await audit('commission_edited', { ref: l.ref, ...r.value }); toast('Commission saved'); await Promise.all([loadLeads(), loadLedger()]); openLead(l.id, true);
  },
  async copyText(btn) {
    const t = btn.getAttribute('data-text') || '';
    try { await navigator.clipboard.writeText(t); toast('Message copied'); } catch (e) { toast('Could not copy. Use Share on WhatsApp instead.'); }
  },
  mrPreset(btn) { const v = btn.getAttribute('data-pct'), n = $('#mr'), r = $('#mr-range'); if (n) n.value = v; if (r) r.value = v; updateSplitPreview(); },
  openMoneyTab() { S.tab = 'mechledger'; ACT.close(); render(); window.scrollTo({ top: 0 }); },
  async linkAdRef() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const code = ($('#ad-ref').value || '').trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) return toast('The ref code is 5 letters or digits, like K7P2M');
    const { data: ck, error: ce } = await sb.from('ad_clicks').select('utm').eq('code', code).maybeSingle();
    if (ce) return toast('Could not look it up: ' + ce.message);
    if (!ck) return toast('That ref code was not found');
    const { error } = await sb.from('leads').update({ utm: ck.utm }).eq('id', l.id);
    if (error) return toast('Could not save: ' + error.message);
    await audit('lead_linked_to_ad', { ref: l.ref, code }); toast('Linked to the Google ad click'); await loadLeads(); openLead(l.id, true);
  },
  editCustomerFromBooking(btn) { ACT.close(); openCustomer(btn.getAttribute('data-id')); },
  showMoveBooking() { const b = $('#moveBox'); if (b) { b.hidden = !b.hidden; if (!b.hidden) $('#cc-q').focus(); } },
  async moveBooking(btn) {
    const l = S.leads.find((x) => x.id === S.open), c = S.customers.find((x) => x.id === btn.getAttribute('data-id')); if (!l || !c) return;
    if (!confirm(`Move ${l.ref} to ${c.name} (+91 ${c.phone})? The booking will show under that customer.`)) return;
    const bike = S.bikes.find((b) => b.id === l.bike_id), upd = { customer_id: c.id, name: c.name, phone: c.phone };
    if (bike && bike.customer_id !== c.id) upd.bike_id = null;
    const { error } = await sb.from('leads').update(upd).eq('id', l.id);
    if (error) return toast('Could not move it: ' + error.message);
    await audit('booking_customer_changed', { ref: l.ref, to: c.id.slice(0, 8) }); toast('Booking moved to ' + c.name); await Promise.all([loadLeads(), loadPeople()]); openLead(l.id, true);
  },
  async voidInvoice() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const reason = await askReason(`Delete the invoice for ${l.ref}?`, 'Why is it being deleted? It is hidden from the register and sales figures, and you can restore it.', 'Delete invoice');
    if (!reason) return;
    if (!S.invoicesAll.some((r) => r.lead_id === l.id)) { const saved = await saveInvoiceCopy(l, 'rebuilt'); if (!saved) return toast('There is no invoice on this booking to delete.'); await loadInvoices(); }
    const { data, error } = await sb.rpc('void_invoices', { p_lead: l.id, p_reason: reason });
    if (error) return toast('Could not delete: ' + error.message);
    await audit('invoice_deleted', { ref: l.ref, copies: data, reason }); toast('Invoice deleted'); await loadInvoices(); openLead(l.id, true); if (['sales', 'invoices', 'custbook'].includes(S.tab)) render();
  },
  async restoreInvoice() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const { error } = await sb.rpc('restore_invoices', { p_lead: l.id });
    if (error) return toast('Could not restore: ' + error.message);
    await audit('invoice_restored', { ref: l.ref }); toast('Invoice restored'); await loadInvoices(); openLead(l.id, true); if (['sales', 'invoices', 'custbook'].includes(S.tab)) render();
  },
  cbEdit() { if (S.cb.id) openCustomer(S.cb.id); },
  cbNewBooking() { const c = S.customers.find((x) => x.id === S.cb.id); if (c) { S.openCust = c.id; openNewBooking(c); } },
  async showDeleted() {
    const { data, error } = await sb.from('leads').select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(200);
    if (error) return toast('Could not load: ' + error.message);
    S.open = null; S.openCust = null; S.openMech = null;
    $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">Deleted bookings</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
    <p class="small muted">These are hidden from every list and no reminders go out. They are kept because they have an invoice or payment. Restore one to bring it back.</p>
    ${(data ?? []).length ? (data ?? []).map((l) => `<div class="card" style="margin-top:10px"><b class="mono">${esc(l.ref)}</b> · ${esc(l.name)} · ${esc(svcName(l.service_id))}<br><span class="tiny muted">Deleted ${esc(when(l.deleted_at))}${l.deleted_reason ? ' · ' + esc(l.deleted_reason) : ''}</span>${isOwner() ? `<div style="margin-top:8px"><button class="btn btn-ghost btn-sm" type="button" data-act="restoreLead" data-id="${l.id}">Restore</button></div>` : ''}</div>`).join('') : '<p class="muted">No deleted bookings.</p>'}`;
    $('#sheet').hidden = false;
  },
  async restoreLead(btn) {
    const { error } = await sb.from('leads').update({ deleted_at: null, deleted_reason: null }).eq('id', btn.getAttribute('data-id'));
    if (error) return toast('Could not restore: ' + error.message);
    await audit('booking_restored', { id: btn.getAttribute('data-id').slice(0, 8) }); toast('Restored'); await loadLeads(); render(); ACT.showDeleted();
  },
  async saveBooking() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const mid = $('#lm').value || null, mech = S.mechanics.find((m) => m.id === mid);
    const upd = { status: $('#ls').value, mechanic_id: mid, assigned_to: $('#la').value.trim() || (mech ? mech.name : null), notes: $('#ln').value.trim() || null, ai_enabled: $('#lai').checked };
    // the service section is only applied when something in it was changed, so saving never reworks an old estimate by accident
    const bike = S.bikes.find((b) => b.id === l.bike_id);
    const f = { service: $('#es-service').value, addons: [...document.querySelectorAll('[data-es-addon]')].filter((c) => c.checked).map((c) => c.getAttribute('data-es-addon')), ...engineRead('es'),
      date: $('#es-date').value, slot: $('#es-slot').value, time: $('#es-time').value, area: $('#es-area').value, pincode: $('#es-pin').value, address: $('#es-address').value, note: $('#es-note').value };
    const was = { service: l.service_id || '', addons: [...(l.addons || [])], engine: bike ? engineOf(bike) : undefined, bigBike: bike && !hasTiers() ? !!bike.big_bike : undefined, date: l.preferred_date || '', slot: l.preferred_slot || '', time: l.preferred_time || '', area: l.area || '', pincode: l.pincode || '', address: l.address || '', note: l.note || '' };
    const key = (o) => JSON.stringify({ ...o, addons: [...o.addons].sort() });
    let svc = null;
    if (key(f) !== key(was)) {
      svc = buildServiceEdit(f, { services: S.services, today: todayIST(), currentDate: l.preferred_date });
      if (!svc.ok) { toast(svc.error); const d = $('#esCard'); if (d) d.open = true; return; }
      Object.assign(upd, svc.lead);
    }
    const pa = $('#pa');
    if (pa && pa.value !== pa.dataset.init) { const n = parseInt(pa.value, 10); if (!(n >= 0 && n <= 100000)) return toast('Check the amount (0 to 1,00,000)'); upd.amount_due = n; }
    const { error } = await sb.from('leads').update(upd).eq('id', l.id);
    if (error) return toast('Could not save: ' + error.message);
    if (svc && svc.bike && l.bike_id) await sb.from('bikes').update(svc.bike).eq('id', l.bike_id);
    await audit('lead_updated', { ref: l.ref, status: upd.status, mechanic_id: upd.mechanic_id, service_changed: !!svc, amount_due: upd.amount_due });
    toast(svc && svc.lead.est_total != null ? 'Saved. New estimate ' + rupee(svc.lead.est_total) : 'Saved'); await Promise.all([loadLeads(), loadPeople()]); renderList(); openLead(l.id, true);
  },
  async boardNext(btn) {
    const l = S.leads.find((x) => x.id === btn.getAttribute('data-id')), n = l && nextStep(l.status); if (!n) return;
    const upd = { status: n.to }; if (n.to === 'completed') upd.completed_at = new Date().toISOString();
    const { error } = await sb.from('leads').update(upd).eq('id', l.id);
    if (error) return toast('Could not update: ' + error.message);
    await audit('board_step', { ref: l.ref, from: l.status, to: n.to }); toast(l.ref + ': ' + n.label.toLowerCase()); await loadLeads(); render();
  },
  async boardMech(sel) {
    const l = S.leads.find((x) => x.id === sel.getAttribute('data-board-mech')); if (!l) return;
    const { error } = await sb.from('leads').update({ mechanic_id: sel.value || null }).eq('id', l.id);
    if (error) return toast('Could not assign: ' + error.message);
    await audit('board_mechanic', { ref: l.ref, mechanic: sel.value || null }); toast(sel.value ? 'Mechanic assigned' : 'Mechanic removed'); await loadLeads(); render();
  },
  invRegisterCsv() {
    const rows = registerRows(); if (!rows.length) return toast('Nothing to download');
    const blob = new Blob(['\ufeff' + registerCsv(rows)], { type: 'text/csv;charset=utf-8' }), a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'mechanix-invoices-' + todayIST() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async backfillInvoices(btn) {
    const sent = await sb.from('email_log').select('lead_id').eq('template', 'invoice').eq('status', 'sent').limit(3000);
    const ids = new Set((sent.data ?? []).map((x) => x.lead_id)); S.leads.filter((l) => l.invoice_override).forEach((l) => ids.add(l.id));
    const have = new Set(S.invoices.map((r) => r.lead_id)), todo = S.leads.filter((l) => ids.has(l.id) && !have.has(l.id));
    if (!todo.length) return toast('No past invoices to add');
    if (!confirm(`Add ${todo.length} past invoice${todo.length === 1 ? '' : 's'}? They are built from each booking's current details and marked as rebuilt.`)) return;
    const rowsNew = [];
    for (const l of todo) {
      const customer = S.customers.find((c) => c.id === l.customer_id) || null, mech = S.mechanics.find((m) => m.id === l.mechanic_id) || null, inv = buildInvoice(withBike(l), S.services, { customer });
      if (inv.lines.length) rowsNew.push(snapshotRow({ invoice: inv, lead: l, customer, mechanic: mechFor(l), via: 'rebuilt', basis: basis(), revision: 1, now: l.completed_at || l.paid_at || l.created_at }));
    }
    if (!rowsNew.length) return toast('No past invoices to add');
    const { error } = await sb.from('invoices').insert(rowsNew);
    if (error) return toast('Could not add: ' + error.message);
    await audit('invoices_backfilled', { count: rowsNew.length }); toast(`Added ${rowsNew.length} past invoice${rowsNew.length === 1 ? '' : 's'}`); await loadInvoices(); render();
  },
  async saveCustomerDetails() {
    const r = S.customers.find((x) => x.id === S.openCust); if (!r) return;
    const c = cleanCustomerEdit({ name: $('#cd-name').value, phone: $('#cd-phone').value, email: $('#cd-email').value, area: $('#cd-area').value, address: $('#cd-address').value, company_name: $('#cd-company').value, gstin: $('#cd-gstin').value });
    if (!c.ok) return toast(c.error);
    if (S.customers.some((x) => x.id !== r.id && x.phone === c.value.phone)) return toast('Another customer already has that mobile number');
    const { error } = await sb.from('customers').update(c.value).eq('id', r.id);
    if (error) return toast('Could not save: ' + error.message);
    // The customer's bookings keep their own copy of the name and number, so keep them in step.
    await sb.from('leads').update({ name: c.value.name, phone: c.value.phone }).eq('customer_id', r.id);
    await audit('customer_details_edited', { phone_last4: c.value.phone.slice(-4), fields: Object.keys(c.value).length });
    toast('Customer details saved'); await Promise.all([loadPeople(), loadLeads()]); if (S.tab === 'customers') renderCustomers(); openCustomer(r.id);
  },
  async saveBike(btn) {
    const id = btn.getAttribute('data-id'), row = btn.closest('[data-bike-row]'); if (!row) return;
    const b = cleanBikeEdit({ brand: row.querySelector('[id^=bk-brand]').value, model: row.querySelector('[id^=bk-model]').value, reg_no: row.querySelector('[id^=bk-reg]').value });
    if (!b.ok) return toast(b.error);
    const { error } = await sb.from('bikes').update(b.value).eq('id', id);
    if (error) return toast('Could not save the bike: ' + error.message);
    await audit('bike_edited', { bike: id.slice(0, 8) }); toast('Bike saved'); await loadPeople(); const cid = S.openCust; if (S.tab === 'customers') renderCustomers(); openCustomer(cid);
  },
  async saveCustomer() {
    const r = S.customers.find((x) => x.id === S.openCust); if (!r) return;
    const upd = { notes: $('#cn').value.trim() || null, blocked: $('#cb').checked, blocked_reason: $('#cb').checked ? ($('#cr').value.trim() || null) : null };
    const { error } = await sb.from('customers').update(upd).eq('id', r.id);
    if (error) return toast('Could not save: ' + error.message);
    await audit(upd.blocked && !r.blocked ? 'customer_blocked' : !upd.blocked && r.blocked ? 'customer_unblocked' : 'customer_updated', { phone_last4: r.phone.slice(-4) });
    toast('Saved'); await loadPeople(); if (S.tab === 'customers') renderCustomers(); openCustomer(r.id);
  },

  reportCsv() {
    const r = reportData(), csv = reportCsv(r.leads, { services: S.services, mechanics: S.mechanics });
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'mechanixpro-report-' + S.range + '-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    audit('exported_report', { range: S.range, rows: r.leads.length });
  },
  adsExport() {
    const r = adsConversions(S.leads);
    if (!r.rows.length) return toast('No completed jobs from Google ads yet. Mark jobs Completed in Bookings, and they appear here.');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' })); a.download = 'mechanixpro-google-ads-conversions-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    audit('exported_ads_conversions', { rows: r.rows.length });
  },
  newCoupon() { openCoupon('new'); },
  async saveCoupon() {
    const num = (v) => (String(v).trim() === '' ? null : parseInt(v, 10));
    const row = { kind: $('#ck').value, value: num($('#cv').value), min_amount: num($('#cm').value) || 0, max_uses: num($('#cu').value), starts_on: $('#cs').value || null, ends_on: $('#ce').value || null, note: $('#cn2').value.trim() || null, active: $('#ca').checked };
    if (S.openCoupon === 'new') { row.code = $('#cc').value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!/^[A-Z0-9_-]{3,20}$/.test(row.code)) return toast('Code needs 3 to 20 letters, numbers or dashes'); }
    if (!(row.value > 0)) return toast('Enter the discount amount');
    if (row.kind === 'percent' && row.value > 100) return toast('Percent cannot be more than 100');
    if (row.max_uses !== null && !(row.max_uses > 0)) return toast('Use limit must be 1 or more');
    if (row.starts_on && row.ends_on && row.starts_on > row.ends_on) return toast('The end date is before the start date');
    const q = S.openCoupon === 'new' ? sb.from('coupons').insert(row) : sb.from('coupons').update(row).eq('id', S.openCoupon);
    const { error } = await q; if (error) return toast(/duplicate|unique/i.test(error.message) ? 'That code already exists' : 'Could not save: ' + error.message);
    await audit(S.openCoupon === 'new' ? 'coupon_created' : 'coupon_updated', { code: row.code ?? S.coupons.find((c) => c.id === S.openCoupon)?.code });
    toast('Saved'); await loadPeople(); closeSheet(); render();
  },
  newMechanic() { openMechanic('new'); },
  async saveMechanic() {
    const row = { name: $('#mn').value.trim(), phone: $('#mp').value.replace(/\D/g, '').slice(-10), area: $('#ma').value.trim() || null, payout_rate: parseInt($('#mr').value, 10) || 0, active: $('#mc').checked, city: $('#mcity').value.trim() || 'Bengaluru', specialties: $('#msp').value.trim() || null, experience_years: Math.min(60, Math.max(0, parseInt($('#mexp').value, 10) || 0)), certified: $('#mcert').checked, notes: $('#mnotes').value.trim() || null };
    if (row.name.length < 2) return toast('Enter the mechanic\'s name');
    if (!/^[6-9]\d{9}$/.test(row.phone)) return toast('Enter a valid 10-digit mobile number');
    if (row.payout_rate < 0 || row.payout_rate > 100) return toast('Payout rate must be 0 to 100');
    const q = S.openMech === 'new' ? sb.from('mechanics').insert(row) : sb.from('mechanics').update(row).eq('id', S.openMech);
    const { error } = await q; if (error) return toast('Could not save: ' + error.message);
    await audit(S.openMech === 'new' ? 'mechanic_added' : 'mechanic_updated', { name: row.name });
    toast('Saved'); await loadPeople(); closeSheet(); render();
  },
  async uploadHome(input) {
    const f = input.files && input.files[0]; if (!f) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) { input.value = ''; return toast('Use a JPG, PNG or WebP picture'); }
    if (f.size > 2 * 1024 * 1024) { input.value = ''; return toast('That picture is over 2 MB. Make it smaller and try again.'); }
    if (S.homeimgs.length >= 12) { input.value = ''; return toast('You can have up to 12 pictures'); }
    const ext = f.type === 'image/png' ? 'png' : f.type === 'image/webp' ? 'webp' : 'jpg', path = Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const up = await sb.storage.from('home').upload(path, f, { contentType: f.type, cacheControl: '31536000' });
    if (up.error) { input.value = ''; return toast('Could not upload: ' + up.error.message); }
    const url = sb.storage.from('home').getPublicUrl(path).data.publicUrl;
    const { error } = await sb.from('home_images').insert({ url, caption: ($('#hc').value || '').trim() || null, position: S.homeimgs.length });
    if (error) return toast('Could not save: ' + error.message);
    await audit('home_image_added', { path }); toast('Added'); await loadHome(); render();
  },
  async homeMove(el, dir) {
    const i = S.homeimgs.findIndex((r) => r.id === el.dataset.id), j = i + dir; if (i < 0 || j < 0 || j >= S.homeimgs.length) return;
    const a = S.homeimgs[i], b = S.homeimgs[j];
    const r1 = await sb.from('home_images').update({ position: j }).eq('id', a.id), r2 = await sb.from('home_images').update({ position: i }).eq('id', b.id);
    if (r1.error || r2.error) return toast('Could not reorder'); await loadHome(); render();
  },
  homeUp(el) { return ACT.homeMove(el, -1); },
  homeDown(el) { return ACT.homeMove(el, 1); },
  async homeToggle(el) {
    const r = S.homeimgs.find((x) => x.id === el.dataset.id); if (!r) return;
    const { error } = await sb.from('home_images').update({ active: !r.active }).eq('id', r.id); if (error) return toast('Could not save');
    await audit('home_image_toggled', { id: r.id, active: !r.active }); await loadHome(); render();
  },
  async homeDelete(el) {
    const r = S.homeimgs.find((x) => x.id === el.dataset.id); if (!r || !confirm('Delete this picture from the home page?')) return;
    const { error } = await sb.from('home_images').delete().eq('id', r.id); if (error) return toast('Could not delete');
    const m = r.url.match(/\/object\/public\/home\/(.+)$/); if (m) await sb.storage.from('home').remove([decodeURIComponent(m[1])]);
    await audit('home_image_deleted', { id: r.id }); toast('Deleted'); await loadHome(); render();
  },
  selectMode() { S.selMode = true; S.sel = new Set(); render(); },
  selectDone() { S.selMode = false; S.sel = new Set(); render(); },
  selectAll() { filtered().forEach((l) => S.sel.add(l.id)); render(); },
  async deleteSelected() {
    const ids = [...S.sel]; if (!ids.length) return;
    if (!confirm(`Delete ${ids.length} booking${ids.length === 1 ? '' : 's'}? Ones with an invoice or payment are moved to Deleted bookings, the rest are erased.`)) return;
    const r = await removeBookings(ids, 'Deleted by the owner');
    if (r.error) return toast('Could not delete: ' + r.error);
    await audit('booking_deleted', { count: ids.length, archived: r.archived }); toast(removedMsg(r));
    S.selMode = false; S.sel = new Set(); await loadLeads(); render();
  },
  wlCsv() {
    const rows = [['Joined', 'Name', 'Mobile', 'Email', 'City', 'Interested in', 'Note']].concat(waitlistRows(S.waitlist, { interest: S.wi, q: S.wq }).map((r) => [r.created_at, r.name, r.phone, r.email, r.city, (r.interests || []).map(interestLabel).join('; '), r.note]));
    const csv = rows.map((r) => r.map((c) => { c = String(c ?? ''); if (/^[=+\-@]/.test(c)) c = "'" + c; return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'mechanixpro-waitlist-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    audit('exported_waitlist', { rows: rows.length - 1 });
  },
  async wlDelete() {
    const r = S.waitlist.find((x) => x.id === S.openWl); if (!r) return;
    if (!confirm(`Delete ${r.name || 'this signup'} from the waitlist? This cannot be undone.`)) return;
    const { error } = await sb.from('waitlist').delete().eq('id', r.id); if (error) return toast('Could not delete: ' + error.message);
    await audit('waitlist_deleted', {}); toast('Deleted'); closeSheet(); await loadWaitlist(); render();
  },
  addPin() { openPin('new'); },
  async savePin() {
    const isNew = S.openPin === 'new', pin = isNew ? cleanPin($('#pp').value) : S.openPin, name = cleanPinName($('#pn').value), active = $('#pa').checked;
    if (!validPin(pin)) return toast('A PIN code has 6 digits');
    if (name.length < 2) return toast('Enter the area name');
    if (isNew && S.pins.some((x) => x.pin === pin)) return toast('That PIN code is already in the list');
    const { error } = isNew ? await sb.from('service_pincodes').insert({ pin, name, active }) : await sb.from('service_pincodes').update({ name, active }).eq('pin', pin);
    if (error) return toast('Could not save: ' + error.message);
    await audit(isNew ? 'pin_added' : 'pin_updated', { pin, name, active }); toast('Saved'); await loadPins(); closeSheet(); render();
  },
  async togglePin() {
    const p = S.pins.find((x) => x.pin === S.openPin); if (!p) return;
    const { error } = await sb.from('service_pincodes').update({ active: !p.active }).eq('pin', p.pin); if (error) return toast('Could not save: ' + error.message);
    await audit('pin_updated', { pin: p.pin, active: !p.active }); toast(p.active ? p.pin + ' paused' : p.pin + ' is served again'); await loadPins(); closeSheet(); render();
  },
  async deletePin() {
    const p = S.pins.find((x) => x.pin === S.openPin); if (!p) return;
    if (!confirm(`Delete PIN code ${p.pin} (${p.name})? To stop serving it but keep it listed, untick "We serve this PIN code" instead.`)) return;
    const { error } = await sb.from('service_pincodes').delete().eq('pin', p.pin); if (error) return toast('Could not delete: ' + error.message);
    await audit('pin_deleted', { pin: p.pin }); toast('Deleted ' + p.pin); closeSheet(); await loadPins(); render();
  },
  async deleteCustomer() {
    const c = S.customers.find((x) => x.id === S.openCust); if (!c) return;
    const theirs = S.leads.filter((l) => l.customer_id === c.id);
    if (!confirm(`Delete ${c.name}? Their saved bikes are deleted too. This cannot be undone.`)) return;
    if (theirs.length && confirm(`Also delete their ${theirs.length} booking${theirs.length === 1 ? '' : 's'}? OK deletes the bookings too. Cancel keeps the bookings.`)) {
      const r = await removeBookings(theirs.map((l) => l.id), 'Customer deleted'); if (r.error) return toast('Could not delete the bookings: ' + r.error);
    }
    const { error } = await sb.from('customers').delete().eq('id', c.id); if (error) return toast('Could not delete: ' + error.message);
    await audit('customer_deleted', { name: c.name }); toast('Deleted ' + c.name); closeSheet(); await Promise.all([loadPeople(), loadLeads()]); render();
  },
  async deleteMechanic() {
    const m = S.mechanics.find((x) => x.id === S.openMech); if (!m) return;
    if (!confirm(`Delete mechanic ${m.name}? Their jobs stay, but show as not assigned. This cannot be undone.`)) return;
    const { error } = await sb.from('mechanics').delete().eq('id', m.id); if (error) return toast('Could not delete: ' + error.message);
    await audit('mechanic_deleted', { name: m.name }); toast('Deleted ' + m.name); closeSheet(); await Promise.all([loadPeople(), loadLeads()]); render();
  },
  async deleteCoupon() {
    const c = S.coupons.find((x) => x.id === S.openCoupon); if (!c) return;
    if (!confirm(`Delete coupon ${c.code}? Past bookings keep their discount. This cannot be undone.`)) return;
    const { error } = await sb.from('coupons').delete().eq('id', c.id); if (error) return toast('Could not delete: ' + error.message);
    await audit('coupon_deleted', { code: c.code }); toast('Deleted ' + c.code); closeSheet(); await loadPeople(); render();
  },
  async deleteIssue() {
    const i = S.issues.find((x) => x.id === S.openIssue); if (!i) return;
    if (!confirm(`Delete this ${KIND_LABEL[i.kind].toLowerCase()} record? This cannot be undone.`)) return;
    const { error } = await sb.from('issues').delete().eq('id', i.id); if (error) return toast('Could not delete: ' + error.message);
    await audit('issue_deleted', { kind: i.kind }); toast('Deleted'); closeSheet(); await loadIssues(); render();
  },
  async deleteLead() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    if (!confirm(`Delete booking ${l.ref} for ${l.name}?`)) return;
    const r = await removeBookings([l.id], 'Deleted by the owner');
    if (r.error) return toast('Could not delete: ' + r.error);
    await audit('booking_deleted', { ref: l.ref, archived: r.archived }); toast(removedMsg(r));
    closeSheet(); await loadLeads(); render();
  },
  newIssue() { S.issueLead = ''; openIssue('new'); },
  issueFromLead() { const l = S.leads.find((x) => x.id === S.open); S.issueLead = l ? l.id : ''; openIssue('new'); },
  async saveIssue() {
    const amt = $('#ia').value.replace(/\D/g, ''), kind = $('#ik').value, status = $('#is').value;
    const row = { amount: amt ? Math.min(100000, parseInt(amt, 10)) : null, note: $('#in').value.trim() || null, resolution: $('#ir').value.trim() || null, status, resolved_at: status === 'resolved' ? new Date().toISOString() : null };
    if (!row.note) return toast('Describe what happened');
    if (kind === 'refund' && !row.amount) return toast('Enter the refund amount');
    const q = S.openIssue === 'new' ? sb.from('issues').insert({ ...row, kind, lead_id: $('#il').value || null, created_by: S.me.user_id }) : sb.from('issues').update(row).eq('id', S.openIssue);
    const { error } = await q; if (error) return toast('Could not save: ' + error.message);
    await audit(S.openIssue === 'new' ? 'issue_logged' : 'issue_updated', { kind, status }); toast('Saved'); await loadIssues(); closeSheet(); render();
  },
  async offerTest() {
    const f = offerForm(), { data, error } = await sb.functions.invoke('send-broadcast', { body: { ...f, mode: 'test' } });
    $('#offerMsg').textContent = error || !data || data.error ? 'Could not send: ' + ((data && data.error) || (error && error.message) || 'try again') : 'Test sent to ' + data.to + '. Check your inbox and spam.';
  },
  async offerSend() {
    const f = offerForm(), n = eligibleCustomers().length;
    if (!confirm(`Send "${f.subject}" to ${n} customer${n === 1 ? '' : 's'} now? This cannot be undone.`)) return;
    S.offerKey = S.offerKey || 'c' + Date.now();
    $('#offerMsg').textContent = 'Sending. Please keep this page open…';
    const { data, error } = await sb.functions.invoke('send-broadcast', { body: { ...f, mode: 'send', campaign: S.offerKey } });
    if (error || !data || data.error) { $('#offerMsg').textContent = 'Could not send: ' + ((data && data.error) || (error && error.message) || 'try again'); return; }
    $('#offerMsg').textContent = `Sent ${data.sent}${data.failed ? ', ' + data.failed + ' failed' : ''}.` + (data.more ? ' There are more customers: press Send again to continue. Nobody gets it twice.' : '');
    if (!data.more) S.offerKey = null;
  },
  invoice() { const l = S.leads.find((x) => x.id === S.open); if (l) openInvoice(l); },
  async invPrint() { const l = S.leads.find((x) => x.id === S.open); if (l) await saveInvoiceCopy(l, 'print'); window.print(); },
  invEdit() { const b = $('#invEditBox'); if (!b) return; b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ block: 'nearest' }); },
  invAddRow() { $('#ie-rows').insertAdjacentHTML('beforeend', invEditRow('', '')); $('#ie-rows').lastElementChild.querySelector('input').focus(); },
  invDelRow(btn) { btn.closest('.ie-row').remove(); },
  async invSaveEdit() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const lines = [...document.querySelectorAll('#ie-rows .ie-row')].map((r) => ({ name: r.querySelector('[data-ie=name]').value.trim(), amount: parseFloat(r.querySelector('[data-ie=amount]').value) })).filter((x) => x.name || x.amount);
    if (!lines.length) return toast('Add at least one item');
    if (lines.some((x) => !x.name)) return toast('Give every amount an item name');
    if (lines.some((x) => !(x.amount >= 0) || x.amount > 1000000)) return toast('Check the amounts');
    const override = { basis: $('#ie-basis').value === 'incl' ? 'incl' : 'excl', rate: [0, 5, 12, 18].includes(+$('#ie-rate').value) ? +$('#ie-rate').value : 18, lines: lines.map((x) => ({ name: x.name.slice(0, 80), amount: Math.round(x.amount * 100) / 100 })) };
    const { error } = await sb.from('leads').update({ invoice_override: override }).eq('id', l.id);
    if (error) return toast('Could not save the invoice: ' + error.message);
    await audit('invoice_edited', { ref: l.ref, basis: override.basis, rate: override.rate, lines: override.lines.length }); toast('Invoice updated');
    await loadLeads(); openInvoice(S.leads.find((x) => x.id === l.id), { quick: true });
  },
  async invResetEdit() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const { error } = await sb.from('leads').update({ invoice_override: null }).eq('id', l.id);
    if (error) return toast('Could not reset the invoice: ' + error.message);
    await audit('invoice_reset', { ref: l.ref }); toast('Back to package prices');
    await loadLeads(); openInvoice(S.leads.find((x) => x.id === l.id), { quick: true });
  },
  async invDiscount() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const v0 = buildInvoice({ ...l, extra_discount: 0 }, S.services), left = Math.round((v0.subtotal - v0.couponDiscount) * 100) / 100;
    const raw = parseFloat($('#inv-disc').value) || 0, kind = $('#inv-disc-kind').value;
    if (raw < 0) return toast('The discount cannot be negative');
    const amount = Math.min(Math.round(kind === 'pct' ? (left * Math.min(100, raw)) / 100 : raw), Math.round(left));
    const note = $('#inv-disc-note').value.trim().slice(0, 80) || null;
    const { error } = await sb.from('leads').update({ extra_discount: amount, extra_discount_note: amount ? note : null }).eq('id', l.id);
    if (error) return toast('Could not save the discount: ' + error.message);
    await audit('invoice_discount', { ref: l.ref, amount, note }); toast(amount ? 'Discount of ' + rupee(amount) + ' applied' : 'Discount removed');
    await loadLeads(); openInvoice(S.leads.find((x) => x.id === l.id), { quick: true });
  },
  async invEmail(btn) {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'Sending…';
    const { data, error } = await sb.functions.invoke('send-invoice', { body: { lead_id: l.id } });
    btn.disabled = false; btn.textContent = old;
    if (!(error || !data || data.error)) await saveInvoiceCopy(l, 'email');
    toast(error || !data || data.error ? 'Could not send: ' + ((data && data.error) || (error && error.message) || 'try again') : 'Invoice emailed to the customer and saved in Invoices');
  },
  invClose() { $('#inv')?.remove(); },
  async confirmBooking() {
    const l = S.leads.find((x) => x.id === S.open);
    if (!l.mechanic_id && !confirm('No mechanic is assigned yet. Confirm without one?')) return;
    const { data, error } = await sb.functions.invoke('confirm-booking', { body: { lead_id: l.id } });
    if (error || !data || data.error) return toast('Could not confirm: ' + ((data && data.error) || (error && error.message) || 'try again'));
    toast(data.emailed ? 'Confirmed. Email sent to the customer.' : data.has_email ? 'Confirmed. Email could not be sent.' : 'Confirmed. This customer gave no email.');
    await loadLeads(); renderList(); openLead(l.id, true);
  },
  async payLink() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10);
    if (!(amount > 0)) return toast('Enter an amount');
    const { data, error } = await sb.functions.invoke('payment-link', { body: { lead_id: l.id, amount } });
    // supabase-js hides the body of a non-2xx answer inside error.context, so read the real reason from there.
    const why = data?.error || (error?.context?.json ? (await error.context.json().catch(() => null))?.error : '') || '';
    if (error || data?.error) return toast('Could not create link: ' + (why || (error && error.message) || 'try again'));
    toast(data.whatsapp_sent ? 'Payment link sent on WhatsApp' + (data.emailed ? ' and email' : '') : data.emailed ? 'Link emailed to the customer. To send on WhatsApp too, tap Send link on WhatsApp.' : data.has_email ? 'Link created, but the email could not be sent. Tap Send link on WhatsApp.' : 'Link created. No email on file and WhatsApp automation is not connected, so tap Send link on WhatsApp.'); await loadLeads(); openLead(l.id, true);
  },
  async emailLink() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10), email = $('#pe').value.trim();
    if (!(amount > 0)) return toast('Enter an amount');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('Enter the customer email first');
    const { data, error } = await sb.functions.invoke('payment-link', { body: { lead_id: l.id, amount, email, resend: true, send_whatsapp: false } });
    const why = data?.error || (error?.context?.json ? (await error.context.json().catch(() => null))?.error : '') || '';
    if (error || data?.error) return toast('Could not email the link: ' + (why || (error && error.message) || 'try again'));
    toast(data.emailed ? 'Payment link emailed to ' + email : 'Link is ready but the email could not be sent. Tap Send link on WhatsApp instead.');
    await loadLeads(); await loadPeople(); openLead(l.id, true);
  },
  async markPaid() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10);
    if (!(amount > 0)) return toast('Enter the amount received');
    const r = buildEntry('payment', { amount, by: $('#pby')?.value || 'company_manual', method: 'Cash or transfer', on: todayIST() }, { today: todayIST(), lead: l });
    if (!r.ok) return toast(r.error);
    if (!confirm(`Record ${rupee(amount)} received by ${r.entry.collected_by === 'mechanic' ? 'the mechanic' : 'the company'} for ${l.ref}?`)) return;
    const { error } = await sb.from('ledger_entries').insert({ ...r.entry, created_by: S.me.user_id });
    if (error) return toast(error.message);
    if (!['paid', 'scheduled', 'completed'].includes(l.status)) await sb.from('leads').update({ status: 'paid' }).eq('id', l.id);
    await audit('marked_paid_manually', { ref: l.ref, amount }); toast('Payment recorded'); await Promise.all([loadLedger(), loadLeads()]); openLead(l.id, true);
  },
  newLead() { openNewBooking(); },
  newBookingForCustomer() { const c = S.customers.find((x) => x.id === S.openCust); if (c) openNewBooking(c); },
  async saveNewBooking() {
    const v = (id) => ($('#' + id)?.value ?? '');
    const f = { name: v('nb-name'), phone: v('nb-phone'), email: v('nb-email'), source: v('nb-source'), status: v('nb-status'), brand: v('nb-brand'), model: v('nb-model'), nickname: v('nb-nick'), regNo: v('nb-reg'), ...engineRead('nb'),
      service: v('nb-service'), addons: [...document.querySelectorAll('[data-nb-addon]:checked')].map((x) => x.dataset.nbAddon), area: v('nb-area'), pincode: v('nb-pin'), address: v('nb-addr'), place: v('nb-place'),
      date: v('nb-date'), slot: v('nb-slot'), time: v('nb-time'), km: v('nb-km'), note: v('nb-note'), whatsapp: $('#nb-wa').checked, reminder: $('#nb-rem').checked };
    const r = buildNewBooking(f, { services: S.services, today: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) });
    if (r.error) return toast(r.error);
    const cust = { phone: r.customer.phone, name: r.customer.name }; if (r.customer.email) cust.email = r.customer.email;
    const { data: c, error: ce } = await sb.from('customers').upsert(cust, { onConflict: 'phone' }).select('id').single();
    if (ce) return toast(ce.message);
    let bikeId = null;
    if (r.bike) { const { data: b } = await sb.from('bikes').insert({ customer_id: c.id, ...r.bike }).select('id').single(); bikeId = b?.id ?? null; }
    let adUtm = null; const refc = v('nb-ref').trim().toUpperCase();
    if (refc) { const { data: ck } = await sb.from('ad_clicks').select('utm').eq('code', refc).maybeSingle(); if (!ck) return toast('That ref code was not found. Check it, or leave it empty.'); adUtm = ck.utm; }
    const { data, error } = await sb.from('leads').insert({ ...r.lead, ...(adUtm ? { utm: adUtm } : {}), customer_id: c.id, bike_id: bikeId }).select('id').single();
    if (error) return toast(error.message);
    await audit('lead_created', { phone_last4: r.customer.phone.slice(-4), source: r.lead.source });
    toast('Booking added'); await loadLeads(); S.tab === 'leads' ? renderList() : render(); openLead(data.id);
  },
  csv() {
    const rows = [['Ref', 'Created', 'Name', 'Phone', 'Source', 'Area', 'Service', 'Estimate', 'Date', 'Slot', 'Status', 'Paid', 'UTM source', 'UTM campaign']].concat(filtered().map((l) => [l.ref, l.created_at, l.name, l.phone, l.source, l.area, svcName(l.service_id), l.est_total, l.preferred_date, l.preferred_slot, LABEL[l.status], l.paid_amount, l.utm?.utm_source, l.utm?.utm_campaign]));
    const csv = rows.map((r) => r.map((c) => { c = String(c ?? ''); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'mechanixpro-bookings-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    audit('exported_csv', { rows: rows.length - 1 });
  },
  async saveIncludes(btn) {
    const id = btn.dataset.id, list = $('#inc-' + id).value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 20);
    if (!list.length) return toast('Add at least one item');
    const { error } = await sb.from('services').update({ includes: list }).eq('id', id);
    if (error) return toast(isOwner() ? error.message : 'Only the owner can change this');
    await audit('includes_updated', { id, items: list.length }); toast('Saved. Customers see it now'); await loadServices(); render();
  },
  async savePrice(btn) {
    const id = btn.dataset.id, tr = btn.closest('tr');
    const upd = { name: $('[data-k=name]', tr).value.trim(), price: parseInt($('[data-k=price]', tr).value, 10), active: $('[data-k=active]', tr).checked };
    if (!upd.name || !(upd.price >= 0)) return toast('Check name and price');
    const { error } = await sb.from('services').update(upd).eq('id', id);
    if (error) return toast(isOwner() ? error.message : 'Only the owner can change prices');
    await audit('price_updated', { id, ...upd }); toast('Price live on the website'); loadServices();
  },
  async saveSettings() {
    const pairs = { doorstep_pct: Math.min(100, Math.max(0, parseInt($('#st-door').value, 10) || 30)), garage_pct: Math.min(100, Math.max(0, parseInt($('#st-garage').value, 10) || 30)), ai_enabled: $('#st-ai').checked, quiet_hours: { start: parseInt($('#st-q1').value, 10), end: parseInt($('#st-q2').value, 10) }, business_info: { ...(S.settings.business_info || {}), hours: $('#st-hours').value.trim(), areas: $('#st-areas').value.trim(), warranty: $('#st-war').value.trim() } };
        for (const [key, value] of Object.entries(pairs)) { const { error } = await sb.from('settings').update({ value }).eq('key', key); if (error) return toast(isOwner() ? error.message : 'Only the owner can change settings'); }
    await audit('settings_updated', { keys: Object.keys(pairs) }); await loadSettings(); toast('Settings saved');
  },
};

function prices() {
  return `<h1 style="font-size:34px">Prices</h1><p class="muted">Changes go live on the website and in AI replies immediately.${isOwner() ? '' : ' Only the owner can edit.'}</p>
  <div class="card tbl"><table class="ptable"><thead><tr><th>Item</th><th>Type</th><th>Price ₹</th><th>Live</th><th></th></tr></thead><tbody>${S.services.map((s) => `<tr><td><input data-k="name" value="${esc(s.name)}" aria-label="Name"${isOwner() ? '' : ' disabled'}></td><td>${({ service: 'Service', addon: 'Add-on', fee: 'Fee' })[s.kind] ?? s.kind}</td><td><input data-k="price" inputmode="numeric" value="${s.price}" style="width:100px" aria-label="Price"${isOwner() ? '' : ' disabled'}></td><td><input type="checkbox" data-k="active"${s.active ? ' checked' : ''} aria-label="Live"${isOwner() ? '' : ' disabled'}></td><td>${isOwner() ? `<button class="btn btn-ghost btn-sm" type="button" data-act="savePrice" data-id="${esc(s.id)}">Save</button>` : ''}</td></tr>`).join('')}</tbody></table></div>
  <h2 style="font-size:24px;margin:28px 0 6px">What is included</h2><p class="muted">Shown to customers while they choose a service, one item per line. It also feeds the services page after the next site update.</p>
  ${S.services.filter((x) => x.kind === 'service').map((x) => `<details class="card" style="margin-bottom:10px"><summary style="font-weight:600">${esc(x.name)} <span class="muted" style="font-weight:400">· ${(x.includes || []).length} items</span></summary><label class="label" for="inc-${esc(x.id)}">One item per line</label><textarea id="inc-${esc(x.id)}" rows="6"${isOwner() ? '' : ' disabled'}>${esc((x.includes || []).join('\n'))}</textarea>${isOwner() ? `<button class="btn btn-ghost btn-sm" style="margin-top:10px" type="button" data-act="saveIncludes" data-id="${esc(x.id)}">Save</button>` : ''}</details>`).join('')}`;
}
function settings() {
  const st = S.settings, bi = st.business_info || {}, q = st.quiet_hours || { start: 21, end: 9 }, dis = isOwner() ? '' : ' disabled';
  return `<h1 style="font-size:34px">Settings</h1><div class="split2"><div class="card"><h3>WhatsApp automation</h3>
  <label class="check"><input type="checkbox" id="st-ai"${st.ai_enabled !== false ? ' checked' : ''}${dis}><span><b>AI replies and reminders on</b><br><span class="tiny muted">Turn off to answer every chat yourself.</span></span></label>
  <p class="tiny muted" style="margin:10px 0 0">The checkup and quote fee, the new customer slot fee and the above-180cc surcharge are edited in the <b>Prices</b> tab, so every page shows the same number.</p>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="label" for="st-q1">No messages after (hour)</label><input id="st-q1" type="number" min="0" max="23" value="${q.start}"${dis}></div><div><label class="label" for="st-q2">Resume at (hour)</label><input id="st-q2" type="number" min="0" max="23" value="${q.end}"${dis}></div></div></div>
  <div class="card"><h3>Mechanic payouts</h3><p class="small muted" style="margin:0 0 8px">Each mechanic's usual percentage is set on their own page. These are the standard rates.</p>
  <label class="label" for="st-door">Mechanic's share on doorstep jobs, when a mechanic has no rate of their own (%)</label><input id="st-door" inputmode="numeric" maxlength="3" value="${esc(st.doorstep_pct ?? 30)}"${dis}>
  <label class="label" for="st-garage">Share on in-garage jobs (%)</label><input id="st-garage" inputmode="numeric" maxlength="3" value="${esc(st.garage_pct ?? 30)}"${dis}>
  <p class="tiny muted" style="margin:8px 0 0">The share is always worked out on the service amount before GST. GST is kept aside. You can still change the percentage for one job, and add a plus or minus adjustment, from the booking.</p></div>
  <div class="card"><h3>What the AI tells customers</h3><label class="label" for="st-hours">Hours</label><input id="st-hours" value="${esc(bi.hours || '')}"${dis}><label class="label" for="st-areas">Areas served</label><textarea id="st-areas" rows="3"${dis}>${esc(bi.areas || '')}</textarea><label class="label" for="st-war">Warranty</label><input id="st-war" value="${esc(bi.warranty || '')}"${dis}></div></div>
  ${isOwner() ? '<button class="btn btn-primary" style="margin-top:16px" type="button" data-act="saveSettings">Save settings</button>' : '<p class="muted">Only the owner can change settings.</p>'}`;
}
/* ---------- offers (marketing email to customers who asked for it) ---------- */
const eligibleCustomers = () => S.customers.filter((c) => c.email && c.email_marketing_consent === true && !c.email_unsubscribed_at && !c.blocked);
function offers() {
  if (!isOwner()) return '<h1 style="font-size:34px">Offers</h1><p class="muted">Only the owner can send offer emails.</p>';
  const n = eligibleCustomers().length, d = S.offerDraft || {};
  return `<h1 style="font-size:34px">Offers</h1><p class="muted">Email an offer to customers who ticked "email me offers". Everyone gets their own unsubscribe link. Always send yourself a test first.</p>
  <div class="card"><label class="label" for="ofs">Subject</label><input id="ofs" maxlength="120" value="${esc(d.subject || '')}">
  <label class="label" for="ofh">Headline inside the email</label><input id="ofh" maxlength="120" value="${esc(d.headline || '')}">
  <label class="label" for="ofb">Message (leave a blank line between paragraphs)</label><textarea id="ofb" rows="6" maxlength="2000">${esc(d.body || '')}</textarea>
  <label class="label" for="oft">Button text (optional)</label><input id="oft" maxlength="40" value="${esc(d.ctaText || 'Build your service')}">
  <label class="label" for="ofu">Button link (optional, must start with https://)</label><input id="ofu" maxlength="300" value="${esc(d.ctaUrl || 'https://mechanixpro.in/book/')}">
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-ghost" type="button" data-act="offerTest">Send a test to me</button><button class="btn btn-primary" type="button" data-act="offerSend"${n ? '' : ' disabled'}>Send to ${n} customer${n === 1 ? '' : 's'}</button></div>
  <p class="tiny muted" id="offerMsg" role="status" style="margin-top:8px">${n ? '' : 'No customer has asked for offers yet.'}</p></div>`;
}
function offerForm() {
  S.offerDraft = { subject: $('#ofs').value, headline: $('#ofh').value, body: $('#ofb').value, ctaText: $('#oft').value, ctaUrl: $('#ofu').value };
  return { ...S.offerDraft };
}
/* ---------- issues, refunds and warranty ---------- */
const WARRANTY_DAYS = 30;
function issues() {
  const rows = issueRows(S.issues, S.leads, S.ifilter);
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">Log complaints, refund requests and warranty redo jobs against a booking. Refund money is still paid back through Razorpay; this is the record.</p>
  <select id="ifs" aria-label="Show">${[['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']].map(([v, t]) => `<option value="${v}"${S.ifilter === v ? ' selected' : ''}>${t}</option>`).join('')}</select>
  <button class="btn btn-primary btn-sm" type="button" data-act="newIssue">Log an issue</button></div>
  <div class="list">${rows.length ? rows.map((i) => `<button class="row mrow" data-issue="${i.id}"><span><b>${esc(i.ref)}</b> ${esc(i.customer)}<br><span class="meta">${esc(KIND_LABEL[i.kind])}${i.amount ? ' · ' + rupee(i.amount) : ''} · ${when(i.created_at)}</span></span><span class="meta">${esc((i.note || '').slice(0, 60))}</span><span class="pill ${i.status === 'resolved' ? 'paid' : 'new'}">${esc(STATUS_LABEL[i.status])}</span></button>`).join('') : '<p class="muted" style="padding:16px">Nothing here. Good.</p>'}</div>`;
}
function openIssue(id) {
  const i = id === 'new' ? { id: 'new', lead_id: S.issueLead || '', kind: 'complaint', status: 'open', amount: '', note: '', resolution: '' } : S.issues.find((x) => x.id === id); if (!i) return;
  S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = null; S.openIssue = id;
  const recent = S.leads.slice(0, 200), w = warrantyInfo(S.leads.find((l) => l.id === i.lead_id), WARRANTY_DAYS);
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${id === 'new' ? 'Log an issue' : 'Issue'}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><div class="inline-form">
    <label class="label" for="il">Booking</label><select id="il"${id === 'new' ? '' : ' disabled'}><option value="">Not linked to a booking</option>${recent.map((l) => `<option value="${l.id}"${l.id === i.lead_id ? ' selected' : ''}>${esc(l.ref)} · ${esc(l.name)}</option>`).join('')}</select>
    <p class="tiny muted" id="iw">${i.lead_id ? (w.active ? `Warranty is active until ${w.endsOn} (${w.daysLeft} days left).` : 'No active warranty on this booking (needs a completed job within 30 days).') : ''}</p>
    <label class="label" for="ik">Type</label><select id="ik"${id === 'new' ? '' : ' disabled'}>${Object.entries(KIND_LABEL).map(([k, t]) => `<option value="${k}"${k === i.kind ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <label class="label" for="ia">Refund amount in rupees (refunds only)</label><input id="ia" inputmode="numeric" maxlength="6" value="${esc(i.amount ?? '')}">
    <label class="label" for="in">What happened</label><textarea id="in" rows="3" maxlength="1000">${esc(i.note || '')}</textarea>
    <label class="label" for="is">Status</label><select id="is">${Object.entries(STATUS_LABEL).map(([k, t]) => `<option value="${k}"${k === i.status ? ' selected' : ''}>${t}</option>`).join('')}</select>
    <label class="label" for="ir">How it was resolved</label><textarea id="ir" rows="3" maxlength="1000">${esc(i.resolution || '')}</textarea>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary" type="button" data-act="saveIssue">Save</button>${isOwner() && id !== 'new' ? '<button class="btn btn-ghost" type="button" data-act="deleteIssue">Delete issue</button>' : ''}</div></div></div>`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}
/* ---------- waitlist: who wants the coming-soon services ---------- */
function waitlist() {
  const counts = interestCounts(S.waitlist), max = Math.max(1, ...counts.map((c) => c.count)), rows = waitlistRows(S.waitlist, { interest: S.wi, q: S.wq });
  return `<h1 style="font-size:34px">Waitlist</h1><p class="muted">${S.waitlist.length} ${S.waitlist.length === 1 ? 'person has' : 'people have'} asked to hear about the coming-soon services. One person can pick several. Tap a bar to filter the list.</p>
  <div class="card"><h3>Interest by service</h3><div class="bars">${counts.map((c) => `<button type="button" class="b wl-bar${S.wi === c.id ? ' on' : ''}" data-wi="${c.id}" aria-pressed="${S.wi === c.id}"><span>${esc(c.label)}</span><span class="t"><i style="width:${Math.round((c.count / max) * 100)}%"></i></span><b>${c.count}</b></button>`).join('')}</div></div>
  <div class="toolbar" style="margin-top:14px"><input id="wq" type="search" placeholder="Search name, phone, email or city" value="${esc(S.wq)}" aria-label="Search the waitlist"><button class="btn btn-ghost btn-sm" type="button" data-act="wlCsv">Export CSV</button></div>
  <div class="list">${rows.length ? rows.map((r) => `<button class="row mrow" data-wl="${r.id}"><span><b>${esc(r.name || 'No name')}</b><br><span class="meta">${esc(r.phone || r.email || '')}${r.city ? ' · ' + esc(r.city) : ''}</span></span><span class="meta">${esc((r.interests || []).map(interestLabel).join(', '))}</span><span class="meta">${when(r.created_at)}</span></button>`).join('') : '<p class="muted" style="padding:16px">Nobody here yet.</p>'}</div>`;
}
function openWaitlist(id) {
  const r = S.waitlist.find((x) => x.id === id); if (!r) return;
  S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = null; S.openIssue = null; S.openPin = null; S.openWl = id;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${esc(r.name || 'Waitlist signup')}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><dl class="kv"><dt>Mobile</dt><dd>${r.phone ? `<a href="tel:+91${esc(r.phone)}">+91 ${esc(r.phone)}</a> · <a href="https://wa.me/91${esc(r.phone)}" target="_blank" rel="noopener">WhatsApp</a>` : '—'}</dd><dt>Email</dt><dd>${esc(r.email || '—')}</dd><dt>City</dt><dd>${esc(r.city || '—')}</dd><dt>Interested in</dt><dd>${esc((r.interests || []).map(interestLabel).join(', '))}</dd><dt>Note</dt><dd>${esc(r.note || '—')}</dd><dt>Joined</dt><dd>${when(r.created_at)}</dd></dl>
  ${isOwner() ? '<button class="btn btn-ghost" style="margin-top:14px" type="button" data-act="wlDelete">Delete this signup</button>' : ''}</div>`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}
/* ---------- PIN codes we serve ---------- */
function pins() {
  const rows = pinRows(S.pins, S.pq), served = S.pins.filter((p) => p.active).length;
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">We serve all of Bengaluru. This list is what the website's PIN check and booking form use, and it updates there straight away. Add a PIN code to serve a new area; pause one to stop serving it. ${served} served, ${S.pins.length - served} paused.</p>
  <input id="pq" type="search" placeholder="Search PIN or area" value="${esc(S.pq)}" aria-label="Search PIN codes">${isOwner() ? '<button class="btn btn-primary btn-sm" type="button" data-act="addPin">Add PIN code</button>' : ''}</div>
  <div class="list" id="pinlist">${rows.length ? rows.map((r) => `<button class="row mrow" data-pin="${r.pin}"><span><b>${esc(r.pin)}</b><br><span class="meta">${esc(r.name)}</span></span><span class="meta"></span><span class="pill ${r.active ? 'paid' : 'off'}">${r.status}</span></button>`).join('') : '<p class="muted" style="padding:16px">No PIN codes match.</p>'}</div>`;
}
function openPin(pin) {
  const p = pin === 'new' ? { pin: '', name: '', active: true } : S.pins.find((x) => x.pin === pin); if (!p) return;
  S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = null; S.openIssue = null; S.openPin = pin;
  const ro = isOwner() ? '' : ' disabled';
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${pin === 'new' ? 'Add a PIN code' : esc(p.pin)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><div class="inline-form">
    <label class="label" for="pp">PIN code (6 digits)</label><input id="pp" inputmode="numeric" maxlength="6" value="${esc(p.pin)}"${pin === 'new' ? ro : ' disabled'}>
    <label class="label" for="pn">Area name shown to customers</label><input id="pn" maxlength="60" value="${esc(p.name)}"${ro} placeholder="For example: Anekal">
    <label class="check"><input type="checkbox" id="pa"${p.active ? ' checked' : ''}${ro}><span>We serve this PIN code</span></label>
    ${isOwner() ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary" type="button" data-act="savePin">Save</button>' + (pin !== 'new' ? '<button class="btn btn-ghost" type="button" data-act="togglePin">' + (p.active ? 'Pause serving' : 'Serve again') + '</button><button class="btn btn-ghost" type="button" data-act="deletePin">Delete PIN code</button>' : '') + '</div>' : '<p class="tiny muted">Only the owner can change PIN codes.</p>'}</div></div>`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}
function homeimgs() {
  const rows = S.homeimgs;
  return `<h1 style="font-size:34px">Home images</h1><p class="muted">These pictures shuffle on the home page. Add up to 12. JPG, PNG or WebP, under 2 MB, wide pictures look best. With none added, the built-in bike pictures show.</p>
  <div class="card"><label class="label" for="hc">Caption (optional, shown on the picture)</label><input id="hc" maxlength="80" placeholder="For example: Doorstep service in HSR Layout">
  <label class="label" for="hf">Choose a picture to upload</label><input id="hf" type="file" accept="image/jpeg,image/png,image/webp"${rows.length >= 12 ? ' disabled' : ''}></div>
  <div class="list" style="margin-top:12px">${rows.length ? rows.map((r, i) => `<div class="row"><img src="${esc(r.url)}" alt="" width="96" height="54" style="object-fit:cover;border-radius:10px;background:#eee"><span>${esc(r.caption || 'No caption')}<br><span class="meta">${r.active ? 'Showing' : 'Hidden'} · position ${i + 1}</span></span><span style="display:flex;gap:6px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-act="homeUp" data-id="${r.id}"${i === 0 ? ' disabled' : ''} aria-label="Move earlier">Up</button><button class="btn btn-ghost btn-sm" type="button" data-act="homeDown" data-id="${r.id}"${i === rows.length - 1 ? ' disabled' : ''} aria-label="Move later">Down</button><button class="btn btn-ghost btn-sm" type="button" data-act="homeToggle" data-id="${r.id}">${r.active ? 'Hide' : 'Show'}</button><button class="btn btn-ghost btn-sm" type="button" data-act="homeDelete" data-id="${r.id}">Delete</button></span></div>`).join('') : '<p class="muted" style="padding:16px">No pictures added yet. The built-in bike pictures are showing.</p>'}</div>`;
}
/* ---------- invoice (with a short "generating" animation) ---------- */
const inr = (n) => '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let companyCache = null;
async function loadCompany() {
  if (companyCache) return companyCache;
  for (const u of ['/company.json', '/src/company.json']) { try { const r = await fetch(u); if (r.ok) { companyCache = await r.json(); return companyCache; } } catch (e) {} }
  return (companyCache = { legalName: 'NOVA VENTURES', brand: 'Mechanix Pro', addressLines: [], city: 'Bengaluru', state: 'Karnataka', pincode: '', gstin: '' });
}
function countUp(el, to, ms) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = inr(to); return; }
  let t0 = null; const tick = (t) => { if (t0 === null) t0 = t; const k = Math.min(1, (t - t0) / ms); el.textContent = inr(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
}
const invEditRow = (name, amount) => `<div class="inv-adjust-row ie-row"><input data-ie="name" maxlength="80" placeholder="Item, for example: Clutch plate set" value="${esc(name)}" aria-label="Item name"><input data-ie="amount" inputmode="decimal" maxlength="9" placeholder="Amount" value="${esc(amount)}" aria-label="Amount"><button class="btn btn-ghost btn-sm" type="button" data-act="invDelRow" aria-label="Remove this item">Remove</button></div>`;

// Save a copy of the invoice when it is printed or emailed. The same figures are never saved twice; a change is saved as a new revision.
async function saveInvoiceCopy(lead, via) {
  try {
    const customer = S.customers.find((c) => c.id === lead.customer_id) || null, mech = S.mechanics.find((m) => m.id === lead.mechanic_id) || null;
    const inv = buildInvoice(lead, S.services, { customer });
    if (!inv.lines.length) return null;
    const mine = S.invoicesAll.filter((r) => r.lead_id === lead.id).sort((a, b) => b.revision - a.revision), live = S.invoices.filter((r) => r.lead_id === lead.id).sort((a, b) => b.revision - a.revision);
    const row = snapshotRow({ invoice: inv, lead, customer, mechanic: mechFor(lead), via, basis: basis(), revision: (mine[0]?.revision || 0) + 1, now: new Date().toISOString() });
    if (live[0] && sameFigures(live[0], row)) return live[0];
    const { error } = await sb.from('invoices').insert(row);
    if (error) { toast('Could not save the invoice copy: ' + error.message); return null; }
    await loadInvoices(); if (S.tab === 'invoices') render();
    return row;
  } catch (e) { toast('Could not save the invoice copy'); return null; }
}
async function openInvoice(lead, opts = {}) {
  const co = await loadCompany(), v = buildInvoice(lead, S.services, { customer: S.customers.find((c) => c.id === lead.customer_id) }), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || opts.quick;
  $('#inv')?.remove();
  const addr = [...(co.addressLines || []), [co.city, co.state, co.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const el = document.createElement('div'); el.id = 'inv'; el.className = 'inv-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Invoice ' + v.number);
  el.innerHTML = `<div class="inv-gen" aria-live="polite"><img src="/assets/img/logo.svg" alt="" width="56" height="58"><b>Generating invoice</b>
    <ol><li style="--d:.1s">Collecting booking ${esc(v.ref)}</li><li style="--d:.6s">Adding services and add-ons</li><li style="--d:1.1s">Splitting GST</li></ol><i></i></div>
  <div class="inv-paper" hidden>
    <div class="inv-head"><div><img src="/assets/img/logo.svg" alt="" width="40" height="42"><b class="inv-co">${esc(co.legalName)}</b><span class="inv-sub">Trading as ${esc(co.brand)}<br>${addr}${co.gstin ? '<br>GSTIN ' + esc(co.gstin) : ''}</span></div>
      <div class="inv-meta"><h2>${v.gstRate ? 'TAX INVOICE' : 'INVOICE'}</h2><span>${esc(v.number)}</span><span>${esc(v.dateLabel)}</span></div></div>
    <p class="inv-to"><span>Billed to</span><b>${esc(v.customer.company || v.customer.name)}</b>${v.customer.company ? ' (' + esc(v.customer.name) + ')' : ''} · ${esc(v.customer.phone)}${v.customer.address ? '<br>' + esc(v.customer.address) : ''}${v.customer.gstin ? '<br>GSTIN ' + esc(v.customer.gstin) : ''}</p>
    <table class="inv-table"><thead><tr><th>Item</th><th class="num">Amount (${v.basis === 'excl' ? 'excl.' : 'incl.'} GST)</th></tr></thead><tbody>
      ${v.lines.length ? v.lines.map((l, i) => `<tr class="inv-line" style="--i:${i}"><td>${esc(l.name)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">No priced items on this booking.</td></tr>'}
      ${v.couponDiscount ? `<tr class="inv-line" style="--i:${v.lines.length}"><td>Coupon discount</td><td class="num">− ${inr(v.couponDiscount)}</td></tr>` : ''}${v.extraDiscount ? `<tr class="inv-line" style="--i:${v.lines.length + 1}"><td>Special discount${v.extraNote ? ' (' + esc(v.extraNote) + ')' : ''}</td><td class="num">− ${inr(v.extraDiscount)}</td></tr>` : ''}</tbody></table>
    <dl class="inv-tot"><dt>Taxable value</dt><dd data-to="${v.taxable}">${inr(v.taxable)}</dd>${v.gstRate ? `<dt>CGST @ ${v.gstRate / 2}%</dt><dd data-to="${v.cgst}">${inr(v.cgst)}</dd><dt>SGST @ ${v.gstRate / 2}%</dt><dd data-to="${v.sgst}">${inr(v.sgst)}</dd>` : ''}
      <dt class="grand">Total</dt><dd class="grand" data-to="${v.total}">${inr(v.total)}</dd>${v.paid ? `<dt>Paid so far</dt><dd data-to="${v.paid}">${inr(v.paid)}</dd><dt class="grand">Balance due</dt><dd class="grand" data-to="${v.balance}">${inr(v.balance)}</dd>` : ''}${v.refund ? `<dt class="grand">Refund due to customer</dt><dd class="grand" data-to="${v.refund}">${inr(v.refund)}</dd>` : ''}</dl>
    <div class="inv-stamp ${v.balance === 0 && v.total > 0 ? 'paid' : 'due'}" aria-hidden="true">${v.balance === 0 && v.total > 0 ? 'PAID' : 'DUE'}</div>
    <p class="inv-foot">${!v.gstRate ? 'No GST is charged on this invoice.' : v.basis === 'excl' ? `Amounts are before GST. GST is added at ${v.gstRate}% and shown in the totals.` : `Prices include ${v.gstRate}% GST.`} Parts are OEM or aftermarket, as labelled on the invoice, and carry a limited warranty on the terms of the part's manufacturer or supplier. Work is done by Mechanix Pro certified mechanics and every service carries a 30-day service warranty. Computer-generated invoice.</p>
    ${(() => {
      const m = S.mechanics.find((x) => x.id === lead.mechanic_id);
      if (!m) return '<div class="inv-cut card"><b>Mechanic cut</b> <span class="tiny muted">(private, not printed)</span><p class="small muted" style="margin:6px 0 0">No mechanic is assigned to this booking, so there is no cut. Assign one in the booking above.</p></div>';
      const c = mechanicCut(v, m.payout_rate || 0, basis());
      return `<div class="inv-cut card"><b>Mechanic cut</b> <span class="tiny muted">(private, not printed)</span>
      <dl class="kv" style="margin-top:8px"><dt>${v.gstRate ? 'GST invoice, ' + v.gstRate + '%' : 'No GST on this invoice'}</dt><dd>${c.basis === 'before_gst' ? 'Cut is on the amount ' + (v.gstRate ? 'before GST' : '(there is no GST)') : 'Cut is on the whole amount'}</dd>
      <dt>Amount the cut is worked out on</dt><dd>${inr(c.base)}</dd><dt>${esc(m.name)} gets (${c.rate}%)</dt><dd><b>${inr(c.cut)}</b></dd><dt>Company keeps</dt><dd><b>${inr(c.company)}</b></dd>${v.gstRate ? `<dt>GST (goes to the government)</dt><dd>${inr(c.gst)}</dd>` : ''}
      <dt>Payable to ${esc(m.name)} now</dt><dd>${inr(c.payableNow)}</dd><dt>Still to pay later</dt><dd>${inr(c.owed)}</dd></dl></div>`;
    })()}
    <div class="inv-adjust"><label for="inv-disc"><b>Last-minute discount</b> <span class="tiny muted">at the customer's request, on top of any coupon</span></label>
      <div class="inv-adjust-row"><select id="inv-disc-kind" aria-label="Discount type"><option value="amt">₹ amount</option><option value="pct">% of the bill</option></select><input id="inv-disc" inputmode="numeric" maxlength="6" placeholder="0" value="${v.extraDiscount || ''}" aria-label="Discount"><input id="inv-disc-note" maxlength="80" placeholder="Reason, for example: regular customer" value="${esc(v.extraNote)}" aria-label="Reason"><button class="btn btn-dark btn-sm" type="button" data-act="invDiscount">Apply</button></div></div>
    <div class="inv-edit card" id="invEditBox" hidden><b>Edit invoice</b> <span class="tiny muted">Change the items and amounts for this booking. The invoice and the email use what you save.</span>
      <label class="label" for="ie-rate">GST rate on this invoice</label><select id="ie-rate"><option value="18"${v.gstRate === 18 ? ' selected' : ''}>18% GST (CGST 9% + SGST 9%)</option><option value="12"${v.gstRate === 12 ? ' selected' : ''}>12% GST (CGST 6% + SGST 6%)</option><option value="5"${v.gstRate === 5 ? ' selected' : ''}>5% GST (CGST 2.5% + SGST 2.5%)</option><option value="0"${v.gstRate === 0 ? ' selected' : ''}>0%: no GST on this invoice</option></select>
      <label class="label" for="ie-basis">The amounts below are</label><select id="ie-basis"><option value="excl"${v.basis === 'excl' ? ' selected' : ''}>Before GST (GST is added on top)</option><option value="incl"${v.basis === 'incl' ? ' selected' : ''}>Including GST (GST is worked out from the amount)</option></select>
      <div id="ie-rows">${v.lines.map((l) => invEditRow(l.name, l.amount)).join('')}</div>
      <div class="inv-adjust-row"><button class="btn btn-ghost btn-sm" type="button" data-act="invAddRow">Add an item</button><button class="btn btn-primary btn-sm" type="button" data-act="invSaveEdit">Save invoice</button>${lead.invoice_override ? '<button class="btn btn-ghost btn-sm" type="button" data-act="invResetEdit">Back to package prices</button>' : ''}</div></div>
    <div class="inv-actions"><button class="btn btn-primary btn-sm" type="button" data-act="invPrint">Print or save as PDF</button><button class="btn btn-ghost btn-sm" type="button" data-act="invEdit">Edit invoice</button><button class="btn btn-dark btn-sm" type="button" data-act="invEmail">Email to customer</button><button class="btn btn-ghost btn-sm" type="button" data-act="invClose">Close</button></div>
  </div>`;
  document.body.appendChild(el);
  const reveal = () => { const g = el.querySelector('.inv-gen'); if (g) g.remove(); const paper = el.querySelector('.inv-paper'); paper.hidden = false; paper.classList.add('in'); el.querySelectorAll('.inv-tot [data-to]').forEach((d) => countUp(d, +d.dataset.to, 900)); el.querySelector('[data-act="invPrint"]').focus(); };
  if (reduce) reveal(); else setTimeout(reveal, 1900);
}

/* ---------- today board ---------- */
function boardCard(l) {
  const m = S.mechanics.find((x) => x.id === l.mechanic_id), n = nextStep(l.status);
  const when = [l.preferred_slot ? ({ asap: 'As soon as possible', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' }[l.preferred_slot] || '') : '', l.preferred_time || ''].filter(Boolean).join(' · ');
  return `<article class="bcard"><div class="bhead"><button class="bref" type="button" data-lead="${l.id}">${esc(l.ref)}</button><span class="pill ${l.status}">${LABEL[l.status]}</span></div>
    <p class="bname"><b>${esc(l.name)}</b> <span class="muted">${esc(svcName(l.service_id))}${l.est_total ? ' · ' + rupee(l.est_total) : ''}</span></p>
    <p class="meta" style="margin:2px 0 8px">${esc([when, l.area, l.pincode].filter(Boolean).join(' · ') || 'No time or place yet')}</p>
    <label class="tiny muted" for="bm-${l.id}">Mechanic</label>
    <select id="bm-${l.id}" class="bsel" data-board-mech="${l.id}"><option value="">Not assigned</option>${S.mechanics.filter((x) => x.active || x.id === l.mechanic_id).map((x) => `<option value="${x.id}"${x.id === l.mechanic_id ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
    <div class="bbtns"><a class="btn btn-wa btn-sm" href="https://wa.me/91${esc(l.phone)}" target="_blank" rel="noopener">WhatsApp</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a>${n ? `<button class="btn btn-primary btn-sm" type="button" data-act="boardNext" data-id="${l.id}">${n.label}</button>` : ''}<button class="btn btn-ghost btn-sm" type="button" data-lead="${l.id}">Open</button></div></article>`;
}
function board() {
  const g = boardGroups(S.leads), total = Object.values(g).reduce((t, a) => t + a.length, 0);
  const grp = (title, hint, rows) => `<section class="bgroup"><h2>${title} <span class="count">${rows.length}</span></h2><p class="tiny muted" style="margin:0 0 8px">${hint}</p>${rows.length ? rows.map(boardCard).join('') : '<p class="muted bempty">Nothing here.</p>'}</section>`;
  return `<h1 style="font-size:34px">Today board</h1><p class="muted">${total ? 'Everything that needs you today, in the order to do it.' : 'Nothing needs you right now.'}</p>
  <div class="bgrid">${grp('Needs a reply', 'New for more than 30 minutes. Reply first.', g.needsReply)}${grp('Quote and payment', 'Waiting for a quote, an answer or a payment.', g.quotePay)}${grp('Today\'s visits', 'Booked for today, in time order.', g.visits)}${grp('Done today', 'Finished jobs.', g.done)}</div>`;
}

/* ---------- invoice register ---------- */
const IPERIODS = [['month', 'This month'], ['last', 'Last month'], ['all', 'All time']];
function iPeriod(k) {
  const ist = new Date(Date.now() + 330 * 60000), y = ist.getUTCFullYear(), m = ist.getUTCMonth(), d = (yy, mm, dd) => new Date(Date.UTC(yy, mm, dd)).toISOString().slice(0, 10);
  if (k === 'month') return { from: d(y, m, 1), to: d(y, m + 1, 0) };
  if (k === 'last') return { from: d(y, m - 1, 1), to: d(y, m, 0) };
  return {};
}
function registerRows() {
  const f = S.ifl; return filterRegister(S.invoices, { gst: f.gst, rate: f.rate, mechanic: f.mechanic, q: f.q, ...iPeriod(f.period) });
}
function invoices() {
  const f = S.ifl, rows = registerRows(), t = registerTotals(rows), mech = byMechanic(rows), gs = gstSummary(rows);
  const opt = (v, cur, label) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
  const pill = (r) => r.has_gst ? `<span class="pill paid">GST ${r.gst_rate}%</span>` : '<span class="pill lost">No GST</span>';
  const cards = rows.map((r) => `<button class="row inv-row" data-lead="${r.lead_id}" style="border-radius:12px"><span class="ref">${esc(r.number)}</span><span>${esc(r.customer_company || r.customer_name)}<br><span class="meta">${esc(when(r.issued_at))} · ${esc(r.mechanic_name || 'No mechanic')}${r.customer_gstin ? ' · GSTIN ' + esc(r.customer_gstin) : ''}</span></span><span>${pill(r)}<br><b>${rupee(r.total)}</b><br><span class="meta">Cut ${rupee(r.mechanic_cut)}</span></span></button>`).join('');
  const table = rows.length ? `<div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th>Mechanic</th><th>GST</th><th>Taxable</th><th>GST amt</th><th>Total</th><th>Paid</th><th>Mech %</th><th>Mechanic cut</th><th>Company</th><th>Payable now</th></tr></thead><tbody>${rows.map((r) => `<tr class="inv-tr" data-lead="${r.lead_id}" tabindex="0"><td><b>${esc(r.number)}</b></td><td>${esc(when(r.issued_at))}</td><td>${esc(r.customer_company || r.customer_name)}${r.customer_gstin ? '<br><span class="tiny muted">' + esc(r.customer_gstin) + '</span>' : ''}</td><td>${esc(r.mechanic_name || 'None')}</td><td>${pill(r)}</td><td>${rupee(r.taxable)}</td><td>${rupee(r.cgst + r.sgst)}</td><td><b>${rupee(r.total)}</b></td><td>${rupee(r.paid)}</td><td>${r.mechanic_name ? r.mechanic_rate + '%' : ''}</td><td><b>${rupee(r.mechanic_cut)}</b></td><td>${rupee(r.company_share)}</td><td>${rupee(r.payable_now)}</td></tr>`).join('')}<tr class="tot"><td><b>Total (${t.count})</b></td><td></td><td></td><td></td><td></td><td><b>${rupee(t.taxable)}</b></td><td><b>${rupee(t.gst)}</b></td><td><b>${rupee(t.total)}</b></td><td><b>${rupee(t.paid)}</b></td><td></td><td><b>${rupee(t.cut)}</b></td><td><b>${rupee(t.company)}</b></td><td><b>${rupee(t.payable)}</b></td></tr></tbody></table></div>` : '<p class="muted">No saved invoices match. An invoice is saved each time you print it or email it from a booking.</p>';
  const mechTable = mech.length ? `<div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Mechanic</th><th>Invoices</th><th>With GST</th><th>Cut on GST invoices</th><th>Without GST</th><th>Cut on no-GST invoices</th><th>Total cut</th><th>Payable now</th><th>Still to pay</th></tr></thead><tbody>${mech.map((m) => `<tr><td><b>${esc(m.name)}</b></td><td>${m.count}</td><td>${m.withGst.count} · ${rupee(m.withGst.total)}</td><td>${rupee(m.withGst.cut)}</td><td>${m.withoutGst.count} · ${rupee(m.withoutGst.total)}</td><td>${rupee(m.withoutGst.cut)}</td><td><b>${rupee(m.cut)}</b></td><td>${rupee(m.payable)}</td><td>${rupee(m.owed)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const gstTable = gs.length ? `<div style="overflow-x:auto"><table class="rtable"><thead><tr><th>GST rate</th><th>Invoices</th><th>Taxable value</th><th>CGST</th><th>SGST</th><th>Total GST</th><th>Invoice total</th></tr></thead><tbody>${gs.map((g) => `<tr><td>${g.rate ? g.rate + '%' : 'No GST'}</td><td>${g.count}</td><td>${rupee(g.taxable)}</td><td>${rupee(g.cgst)}</td><td>${rupee(g.sgst)}</td><td>${rupee(g.gst)}</td><td>${rupee(g.total)}</td></tr>`).join('')}</tbody></table></div>` : '';
  const basisNote = basis() === 'before_gst' ? 'The mechanic\'s cut is worked out on the amount <b>before GST</b>. On an invoice with no GST that is the whole amount, so the same percentage gives a different rupee amount.' : 'The mechanic\'s cut is worked out on the <b>whole amount including GST</b>. You can change this in Settings.';
  return `<h1 style="font-size:34px">Invoices</h1><p class="muted">Every invoice you print or email is saved here, with its GST and the mechanic's cut as they were on that day.</p>
  <div class="toolbar" style="flex-wrap:wrap;gap:8px"><select id="if-period" aria-label="Period">${IPERIODS.map(([k, n]) => opt(k, f.period, n)).join('')}</select>
    <select id="if-gst" aria-label="GST">${opt('', f.gst, 'With and without GST')}${opt('with', f.gst, 'With GST only')}${opt('without', f.gst, 'No GST only')}</select>
    <select id="if-rate" aria-label="GST rate">${opt('', f.rate, 'Any rate')}${[18, 12, 5, 0].map((r) => opt(r, f.rate, r ? r + '%' : '0% (no GST)')).join('')}</select>
    <select id="if-mech" aria-label="Mechanic">${opt('', f.mechanic, 'All mechanics')}${S.mechanics.map((m) => opt(m.id, f.mechanic, esc(m.name))).join('')}${opt('none', f.mechanic, 'No mechanic')}</select>
    <input id="if-q" type="search" placeholder="Search number, name, GSTIN" value="${esc(f.q)}" aria-label="Search invoices" style="min-width:200px">
    <button class="btn btn-ghost btn-sm" type="button" data-act="invRegisterCsv">Download CSV</button>${isOwner() ? '<button class="btn btn-ghost btn-sm" type="button" data-act="backfillInvoices">Add past invoices</button>' : ''}</div>
  <div class="kpis"><div class="kpi"><b>${t.count}</b><span>Invoices</span></div><div class="kpi"><b>${rupee(t.total)}</b><span>Invoice total</span></div><div class="kpi"><b>${rupee(t.gst)}</b><span>GST in these invoices</span></div><div class="kpi"><b>${rupee(t.cut)}</b><span>Mechanic cut</span></div><div class="kpi"><b>${rupee(t.company)}</b><span>Company share</span></div><div class="kpi"><b>${rupee(t.cut - t.payable)}</b><span>Mechanic cut still to pay</span></div></div>
  <div class="card" style="margin-top:14px"><h3>Mechanic cut, with and without GST</h3><p class="tiny muted" style="margin:0 0 8px">${basisNote}</p>${mechTable || '<p class="muted">No invoices yet.</p>'}</div>
  ${gstTable ? `<div class="card" style="margin-top:14px"><h3>GST summary for your accountant</h3>${gstTable}</div>` : ''}
  <div class="card" style="margin-top:14px"><h3>All invoices</h3><div class="inv-table-wide">${table}</div><div class="inv-cards">${cards}</div></div>`;
}
/* ---------- sales and collections ---------- */
const rupee2 = (n) => { const v = Math.round((Number(n) || 0) * 100) / 100; return '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }); };
const FIN_KINDS = { payment: 'Customer payment', refund: 'Refund to customer', write_off: 'Write off a balance', remittance: 'Mechanic paid the company', payout: 'Company paid the mechanic' };
// The invoice a job is judged on: the latest saved copy, or one built from the booking as it stands (not saved until it is printed or emailed).
function invoiceFor(l) {
  const mech = S.mechanics.find((m) => m.id === l.mechanic_id) || null;
  let row = S.invoices.filter((r) => r.lead_id === l.id).sort((a, b) => b.revision - a.revision)[0];
  if (!row) {
    const customer = S.customers.find((c) => c.id === l.customer_id) || null, inv = buildInvoice(l, S.services, { customer });
    if (!inv.lines.length) return null;
    row = snapshotRow({ invoice: inv, lead: l, customer, mechanic: mechFor(l), via: 'print', basis: basis(), revision: 1, now: l.completed_at || l.paid_at || l.created_at });
  }
  const rate = jobRate(l);
  row = { ...row, mechanic_id: l.mechanic_id || null, mechanic_name: mech ? mech.name : null, mechanic_rate: mech ? rate.pct : 0, commission_adjust: Number(l.commission_adjust) || 0, commission_note: l.commission_note || '', job_place: rate.place };
  return row;
}
function salesModel() {
  const by = new Map();
  for (const l of S.leads) {
    const entries = S.ledger.filter((e) => e.lead_id === l.id);
    if (!(l.status === 'completed' || l.paid_amount > 0 || entries.length || S.invoices.some((r) => r.lead_id === l.id))) continue;
    if (S.invoicesAll.some((r) => r.lead_id === l.id && r.voided_at) && !S.invoices.some((r) => r.lead_id === l.id) && !entries.length && !(l.paid_amount > 0)) continue;
    let invoice = null; try { invoice = invoiceFor(l); } catch (e) { console.error('invoiceFor', l.ref, e); }
    if (!invoice) continue;
    const k = invoice.mechanic_id || 'none'; if (!by.has(k)) by.set(k, []); by.get(k).push({ invoice, entries });
  }
  const accounts = [], mechAccts = [];
  for (const [k, jobs] of by) {
    if (k === 'none') { accounts.push(...jobs.map((j) => jobAccount(j))); continue; }
    const m = S.mechanics.find((x) => x.id === k) || { id: k, name: jobs[0].invoice.mechanic_name, payout_rate: jobs[0].invoice.mechanic_rate };
    const acct = mechanicAccount({ mechanic: m, jobs, entries: S.ledger.filter((e) => e.mechanic_id === k) });
    mechAccts.push(acct); accounts.push(...acct.jobAccounts);
  }
  return { accounts, mechAccts, cards: summaryCards(accounts, S.ledger) };
}
const sfRange = () => (S.sf.from || S.sf.to ? { from: S.sf.from || undefined, to: S.sf.to || undefined } : iPeriod(S.sf.period));
function salesRows() { const f = S.sf; return filterAccounts(salesModel().accounts, { mechanic: f.mechanic, status: f.status, q: f.q, channel: f.channel, gst: f.gst, ...sfRange() }).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt)); }
const statusPill = (t) => `<span class="pill ${['Fully Paid', 'Settled'].includes(t) ? 'paid' : ['Customer Due', 'Overdue', 'Mechanic Remittance Due'].includes(t) ? 'lost' : ''}">${esc(t)}</span>`;
const whoRecorded = (e) => (e.source === 'gateway' ? 'System (Razorpay)' : e.source === 'opening' ? 'Opening balance' : e.created_by ? (e.created_by === S.me.user_id ? 'You' : 'Team member') : 'System');
function entryRows(entries, withReverse = true) {
  const gone = new Set(S.ledger.filter((e) => e.entry_type === 'reversal').map((e) => e.reverses_id));
  if (!entries.length) return '<p class="muted small">No money recorded yet.</p>';
  return `<div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Date</th><th>What</th><th>Amount</th><th>Details</th><th>Recorded by</th><th></th></tr></thead><tbody>${entries.map((e) => {
    const cancelled = gone.has(e.id), by = e.entry_type === 'customer_payment' && e.gateway_fee > 0 ? ` · gateway fee ${rupee2(e.gateway_fee)}` : '';
    return `<tr${cancelled || e.entry_type === 'reversal' ? ' style="opacity:.6"' : ''}><td>${esc(e.occurred_on)}</td><td>${esc(entryLabel(e))}${cancelled ? ' <span class="tiny muted">(deleted)</span>' : ''}</td><td><b>${e.entry_type === 'refund' ? '−' : ''}${rupee2(e.amount)}</b></td><td class="tiny muted">${esc([e.method, e.reference, e.reason, e.note].filter(Boolean).join(' · '))}${by}${e.settlement_status ? ` · <b>${e.settlement_status === 'settled' ? 'Settled' + (e.settled_on ? ' ' + esc(e.settled_on) : '') : 'Settlement pending'}</b> <button class="btn btn-ghost btn-sm" type="button" data-act="settle" data-id="${e.id}" data-to="${e.settlement_status === 'settled' ? 'no' : 'yes'}">${e.settlement_status === 'settled' ? 'Mark pending' : 'Mark settled'}</button>` : ''}</td><td class="tiny">${esc(whoRecorded(e))}<br><span class="muted">${esc(when(e.created_at))}</span></td><td>${withReverse && isOwner() && !cancelled && e.entry_type !== 'reversal' ? (e.source === 'gateway' ? '<span class="tiny muted">Refund it in Razorpay</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-act="finReverse" data-id="${e.id}">Delete</button>`) : ''}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function finPanel(a) {
  const l = S.leads.find((x) => x.id === a.lead_id), k = S.finKind, input = (id, label, attrs = '') => `<label class="label" for="${id}">${label}</label><input id="${id}" ${attrs}>`;
  const kinds = Object.entries(FIN_KINDS).filter(([key]) => (key !== 'remittance' && key !== 'payout') || a.mechanicId);
  const needsBy = k === 'payment' || k === 'refund', needsReason = k === 'refund' || k === 'write_off';
  const chan = (c, n) => `<option value="${c}">${n}${k === 'refund' ? ' (holds ' + rupee2(a.byChannel[c]) + ')' : ''}</option>`;
  const forms = `<div class="card" style="margin-top:12px"><h3>Record money</h3>
    <label class="label" for="fin-kind">What happened</label><select id="fin-kind">${kinds.map(([key, n]) => `<option value="${key}"${key === k ? ' selected' : ''}>${n}</option>`).join('')}</select>
    ${input('fin-amount', 'Amount (₹)', 'inputmode="decimal" maxlength="10" placeholder="0"')}
    ${needsBy ? `<label class="label" for="fin-by">${k === 'refund' ? 'Refunded from' : 'Who received the money'}</label><select id="fin-by">${chan('company_manual', 'The company (cash, bank or UPI)')}${chan('company_portal', 'The company, online (Razorpay)')}${a.mechanicId ? chan('mechanic', 'The mechanic ' + esc(a.mechanicName || '')) : ''}</select>` : ''}
    ${k === 'remittance' || k === 'payout' ? `<p class="tiny muted" style="margin:8px 0 0">This is recorded for ${esc(a.mechanicName || 'the mechanic')} and settles their oldest jobs first.</p>` : ''}
    ${k === 'payment' ? `<div id="fin-portal" hidden>${input('fin-fee', 'Gateway fee (₹)', 'inputmode="decimal" maxlength="8" placeholder="0"')}${input('fin-txn', 'Gateway transaction ID', 'maxlength="80"')}<label class="label" for="fin-settle">Settlement</label><select id="fin-settle"><option value="pending">Pending</option><option value="settled">Settled to the bank</option></select></div>` : ''}
    ${input('fin-method', 'How (cash, UPI, bank transfer)', 'maxlength="40"')}${input('fin-ref', 'Reference or transaction ID (optional)', 'maxlength="80"')}${input('fin-on', 'Date', `type="date" max="${todayIST()}" value="${todayIST()}"`)}
    ${needsReason ? input('fin-reason', 'Reason (required)', 'maxlength="200"') : ''}${input('fin-note', 'Note (optional)', 'maxlength="300"')}
    <button class="btn btn-primary" style="margin-top:12px" type="button" data-act="finSave">Save entry</button></div>`;
  return `<div class="card fin-panel"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2 style="font-size:24px;margin:0">${esc(a.number)} · ${esc(a.customer)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="finClose">Close</button></div>
    <p style="margin:6px 0">${a.statusLabels.map(statusPill).join(' ')}</p>
    <div class="fin-grid"><dl class="kv"><dt>Service amount</dt><dd>${rupee2(a.service)}</dd><dt>GST${a.hasGst ? ' ' + a.gstRate + '%' : ''}</dt><dd>${a.hasGst ? rupee2(a.gst) : 'No GST charged'}</dd><dt>Invoice total</dt><dd><b>${rupee2(a.total)}</b></dd><dt>Collected by company</dt><dd>${rupee2(a.byChannel.company_manual)}</dd><dt>Collected online</dt><dd>${rupee2(a.byChannel.company_portal)}${a.gatewayFees ? ' <span class="tiny muted">(fee ' + rupee2(a.gatewayFees) + ')</span>' : ''}</dd><dt>Collected by mechanic</dt><dd>${rupee2(a.byChannel.mechanic)}</dd><dt>Customer balance</dt><dd><b>${rupee2(a.outstanding)}</b>${a.credit ? ' <span class="tiny muted">(customer credit ' + rupee2(a.credit) + ')</span>' : ''}${a.writtenOff ? ' <span class="tiny muted">(written off ' + rupee2(a.writtenOff) + ')</span>' : ''}</dd></dl>
    <dl class="kv">${a.mechanicId ? `<dt>Mechanic</dt><dd>${esc(a.mechanicName)} · ${a.mechanicPct}% of the service amount</dd><dt>Mechanic earnings (full job)</dt><dd>${rupee2(a.earningsTotal)}</dd><dt>Company share (full job)</dt><dd>${rupee2(a.companyShareTotal)}</dd><dt>Earnings kept in hand</dt><dd>${rupee2(a.inHand)}</dd><dt>Mechanic must pay the company</dt><dd><b>${rupee2(a.remitDue)}</b> <span class="tiny muted">of ${rupee2(a.remitObligation)}</span></dd><dt>Company must pay the mechanic</dt><dd><b>${rupee2(a.payoutDue)}</b> <span class="tiny muted">of ${rupee2(a.payoutObligation)}</span></dd>` : '<dt>Mechanic</dt><dd>None on this job</dd>'}</dl></div>
    <h3 style="margin:14px 0 6px">Money history</h3>${entryRows(S.ledger.filter((e) => e.lead_id === a.lead_id).sort((x, y) => new Date(y.created_at) - new Date(x.created_at)))}
    <div class="row-btns" style="margin-top:10px"><button class="btn btn-ghost btn-sm" type="button" data-act="openBooking" data-id="${a.lead_id}">Open booking</button></div></div>${forms}`;
}
function sales() {
  const f = S.sf, m = salesModel(), rows = filterAccounts(m.accounts, { mechanic: f.mechanic, status: f.status, q: f.q, channel: f.channel, gst: f.gst, ...sfRange() }).sort((a, b) => new Date(b.issuedAt) - new Date(a.issuedAt));
  const c = summaryCards(rows, S.ledger), opt = (v, cur, label) => `<option value="${v}"${String(cur) === String(v) ? ' selected' : ''}>${label}</option>`;
  const fin = S.finJob && m.accounts.find((a) => a.lead_id === S.finJob);
  const kpi = (v, l) => `<div class="kpi"><b>${rupee2(v)}</b><span>${l}</span></div>`;
  const STAT = ['Unpaid', 'Partially Paid', 'Fully Paid', 'Customer Due', 'Overdue', 'Mechanic Remittance Due', 'Mechanic Payout Due', 'Settled'];
  const table = rows.length ? `<div class="inv-table-wide"><table class="rtable"><thead><tr><th>Invoice</th><th>Customer</th><th>Mechanic</th><th>Share</th><th>Total</th><th>Company</th><th>Online</th><th>Mechanic</th><th>Customer owes</th><th>Mechanic owes us</th><th>We owe mechanic</th><th>Status</th></tr></thead><tbody>${rows.map((a) => `<tr class="fin-tr" data-lead="${a.lead_id}" tabindex="0"><td><b>${esc(a.number)}</b><br><span class="tiny muted">${esc(when(a.issuedAt))}</span></td><td>${esc(a.customer)}<br><span class="tiny muted">${esc(a.phone || '')}</span></td><td>${esc(a.mechanicName || '—')}</td><td class="tiny">${a.mechanicName ? 'Mechanic ' + a.mechanicPct + '%<br>Company ' + a.companyPct + '%' : '—'}</td><td><b>${rupee2(a.total)}</b></td><td>${rupee2(a.byChannel.company_manual)}</td><td>${rupee2(a.byChannel.company_portal)}</td><td>${rupee2(a.byChannel.mechanic)}</td><td>${rupee2(a.outstanding)}</td><td>${rupee2(a.remitDue)}</td><td>${rupee2(a.payoutDue)}</td><td>${a.statusLabels.map(statusPill).join(' ')}</td></tr>`).join('')}</tbody></table></div><div class="inv-cards">${rows.map((a) => `<button class="row fin-tr" data-lead="${a.lead_id}" style="border-radius:12px"><span class="ref">${esc(a.number)}</span><span>${esc(a.customer)}<br><span class="meta">${esc(a.mechanicName || 'No mechanic')} · ${a.statusLabels.join(', ')}</span></span><span><b>${rupee2(a.total)}</b><br><span class="meta">Owes ${rupee2(a.outstanding)}</span></span></button>`).join('')}</div>` : '<p class="muted">No jobs match. Jobs appear here once they are completed or have a payment.</p>';
  return `<h1 style="font-size:34px">Sales and collections</h1><p class="muted">Every invoice, who collected the money, and what the customer, the mechanic and the company each still owe.</p>
  <div class="kpis">${kpi(c.invoiceSales, 'Invoice sales')}${kpi(c.collectedManual, 'Collected by the company')}${kpi(c.collectedPortal, 'Collected online')}${kpi(c.collectedMechanic, 'Collected by mechanics')}${kpi(c.customerOutstanding, 'Customers still owe')}${kpi(c.gst, 'GST in these invoices')}${kpi(c.mechanicsOweCompany, 'Mechanics owe the company')}${kpi(c.payoutsPending, 'Company owes mechanics')}${kpi(c.payoutsPaid, 'Mechanic payouts paid')}${c.gatewayFees ? kpi(c.gatewayFees, 'Gateway fees paid') : ''}</div>
  ${fin ? finPanel(fin) : ''}
  <div class="toolbar" style="flex-wrap:wrap;gap:8px;margin-top:14px"><select id="sf-period" aria-label="Period">${IPERIODS.map(([k, n]) => opt(k, f.period, n)).join('')}</select>
    <select id="sf-mech" aria-label="Mechanic">${opt('', f.mechanic, 'All mechanics')}${S.mechanics.map((x) => opt(x.id, f.mechanic, esc(x.name))).join('')}${opt('none', f.mechanic, 'No mechanic')}</select>
    <select id="sf-status" aria-label="Status">${opt('', f.status, 'Any status')}${STAT.map((x) => opt(x, f.status, x)).join('')}</select>
    <select id="sf-channel" aria-label="Collected by">${opt('', f.channel, 'Collected by anyone')}${opt('company_manual', f.channel, 'Company, manual')}${opt('company_portal', f.channel, 'Company, online')}${opt('mechanic', f.channel, 'Mechanic')}</select>
    <select id="sf-gst" aria-label="Invoice type">${opt('', f.gst, 'With and without GST')}${opt('with', f.gst, 'With GST')}${opt('without', f.gst, 'No GST')}</select>
    <label class="tiny muted">From <input id="sf-from" type="date" value="${esc(f.from)}" aria-label="From date"></label><label class="tiny muted">To <input id="sf-to" type="date" value="${esc(f.to)}" aria-label="To date"></label>
    <input id="sf-q" type="search" placeholder="Search invoice, name, booking" value="${esc(f.q)}" aria-label="Search" style="min-width:200px"><button class="btn btn-ghost btn-sm" type="button" data-act="salesCsv">Download jobs CSV</button><button class="btn btn-ghost btn-sm" type="button" data-act="ledgerCsv">Download all transactions CSV</button></div>
  <div class="card" style="margin-top:14px"><h3>All jobs (${rows.length})</h3>${table}</div>`;
}
function mechledger() {
  const m = salesModel(), list = m.mechAccts.sort((a, b) => (b.remitRemaining + b.payoutRemaining) - (a.remitRemaining + a.payoutRemaining));
  const card = (a) => {
    const id = a.mechanic.id, open = S.mlOpen === id, entries = S.ledger.filter((e) => e.mechanic_id === id && ['remittance', 'payout', 'reversal'].includes(e.entry_type)).sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
    const f = (kind, label) => `<div class="card" style="margin-top:10px"><b>${label}</b><label class="label" for="ml-amount-${id}-${kind}">Amount (₹)</label><input id="ml-amount-${id}-${kind}" inputmode="decimal" maxlength="10"><label class="label" for="ml-method-${id}-${kind}">How</label><input id="ml-method-${id}-${kind}" maxlength="40" placeholder="UPI, cash, bank transfer"><label class="label" for="ml-ref-${id}-${kind}">Reference (optional)</label><input id="ml-ref-${id}-${kind}" maxlength="80"><label class="label" for="ml-on-${id}-${kind}">Date</label><input id="ml-on-${id}-${kind}" type="date" max="${todayIST()}" value="${todayIST()}"><button class="btn btn-primary btn-sm" style="margin-top:10px" type="button" data-act="mlSave" data-id="${id}" data-kind="${kind}">Save</button></div>`;
    const jobs = a.jobAccounts.sort((x, y) => new Date(y.issuedAt) - new Date(x.issuedAt));
    return `<div class="card" style="margin-top:12px"><button class="row" type="button" data-act="mlOpen" data-id="${id}" style="border-radius:12px;width:100%"><span><b>${esc(a.mechanic.name)}</b><br><span class="meta">${a.mechanic.phone ? '+91 ' + esc(a.mechanic.phone) + ' · ' : ''}${a.mechanic.area ? esc(a.mechanic.area) + ' · ' : ''}${a.jobs} job${a.jobs === 1 ? '' : 's'} · ${a.mechanic.payout_rate || 0}% of the service amount</span></span><span>${statusPill(a.status)}</span><span><b>${a.net === 0 ? '' : rupee2(Math.abs(a.net))}</b><br><span class="meta">${esc(a.netLabel)}</span></span></button>
    <div class="kpis" style="margin-top:10px"><div class="kpi"><b>${rupee2(a.serviceSales)}</b><span>Service sales</span></div><div class="kpi"><b>${rupee2(a.directCollected)}</b><span>Collected directly</span></div><div class="kpi"><b>${rupee2(a.earnings)}</b><span>Earnings</span></div><div class="kpi"><b>${rupee2(a.remitRemaining)}</b><span>Owes the company</span></div><div class="kpi"><b>${rupee2(a.payoutRemaining)}</b><span>Company owes</span></div><div class="kpi"><b>${rupee2(a.remitted)}</b><span>Paid to the company</span></div><div class="kpi"><b>${rupee2(a.paidOut)}</b><span>Paid out to the mechanic</span></div></div>
    ${(() => { const mm = S.mechanics.find((x) => x.id === id); if (!mm || !mm.phone) return ''; const jobsS = [...a.jobAccounts].sort((x, y) => new Date(y.issuedAt) - new Date(x.issuedAt)); const t = statementShareText({ mechanicName: mm.name, rows: jobsS.map((j) => ({ ref: j.ref, date: new Date(j.issuedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }), place: j.jobPlace, earnings: j.earningsTotal })), totals: { earnings: a.earnings, remitDue: a.remitRemaining, payoutDue: a.payoutRemaining, net: a.net, netLabel: a.netLabel } }); return `<p style="margin:10px 0 0"><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="${esc(waLink(mm.phone, t))}">Share statement on WhatsApp</a></p>`; })()}
    ${open ? `<h3 style="margin:14px 0 6px">Jobs</h3><div style="overflow-x:auto"><table class="rtable"><thead><tr><th>Invoice</th><th>Total</th><th>Collected by mechanic</th><th>Earnings</th><th>Owes the company</th><th>Company owes</th></tr></thead><tbody>${jobs.map((j) => `<tr class="fin-tr" data-lead="${j.lead_id}" tabindex="0"><td>${esc(j.number)}</td><td>${rupee2(j.total)}</td><td>${rupee2(j.byChannel.mechanic)}</td><td>${rupee2(j.payoutObligation + j.inHand)}</td><td>${rupee2(j.remitDue)}</td><td>${rupee2(j.payoutDue)}</td></tr>`).join('')}</tbody></table></div>
    <h3 style="margin:14px 0 6px">Settlements</h3>${entryRows(entries)}<div class="fin-grid">${f('remittance', esc(a.mechanic.name) + ' paid the company')}${f('payout', 'The company paid ' + esc(a.mechanic.name))}</div>` : '<p class="tiny muted" style="margin:8px 0 0">Tap to see the jobs and record a settlement.</p>'}</div>`;
  };
  return `<h1 style="font-size:34px">Mechanic ledgers</h1><p class="muted">What each mechanic owes the company, what the company owes them, and the net of the two. The two balances are never mixed.</p>${list.map(card).join('') || '<p class="muted">No mechanic jobs yet.</p>'}`;
}
/* ---------- customer bookings: everything one customer has booked, billed and paid ---------- */
function custbook() {
  const list = customerList({ customers: S.customers, leads: S.leads, q: S.cb.q });
  const items = list.map((c) => `<button class="row crow${S.cb.id === c.id ? ' on' : ''}" type="button" data-cb="${c.id}" style="border-radius:12px"><span>${esc(c.name)}<br><span class="meta">+91 ${esc(c.phone)}</span></span><span class="meta">${c.bookings} booking${c.bookings === 1 ? '' : 's'}</span></button>`).join('') || '<p class="muted" style="padding:12px">No customers match.</p>';
  return `<h1 style="font-size:34px">Customer bookings</h1><p class="muted">Pick a customer to see all their bookings, invoices and payments in one place.</p>
  <div class="cb-grid"><div class="cb-list"><input id="cb-q" type="search" placeholder="Search name, phone or email" value="${esc(S.cb.q)}" aria-label="Search customers" style="margin-bottom:10px"><div class="list" style="display:grid;gap:8px">${items}</div></div><div class="cb-detail">${custbookDetail()}</div></div>`;
}
function custbookDetail() {
  const c = S.customers.find((x) => x.id === S.cb.id);
  if (!c) return '<div class="card"><p class="muted" style="margin:0">Choose a customer on the left.</p></div>';
  const accounts = salesModel().accounts, rows = bookingRows({ customer: c, leads: S.leads, accounts, svcName }), sm = summarize(rows), ids = new Set(rows.map((r) => r.id));
  const bikes = S.bikes.filter((b) => b.customer_id === c.id).map((b) => [b.brand, b.model].filter(Boolean).join(' ')).filter(Boolean);
  const kpi = (v, l) => `<div class="kpi"><b>${v}</b><span>${l}</span></div>`;
  const invs = S.invoicesAll.filter((r) => ids.has(r.lead_id)).sort((a, b) => new Date(b.issued_at) - new Date(a.issued_at));
  const ents = S.ledger.filter((e) => ids.has(e.lead_id)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const refOf = Object.fromEntries(rows.map((r) => [r.id, r.ref]));
  const gone = new Set(S.ledger.filter((e) => e.entry_type === 'reversal').map((e) => e.reverses_id));
  const bookingTable = rows.length ? `<div class="scroll"><table style="min-width:640px"><thead><tr><th>Booking</th><th>Service</th><th>When</th><th>Status</th><th class="num">Total</th><th class="num">Paid</th><th class="num">Due</th></tr></thead><tbody>${rows.map((r) => `<tr class="inv-tr" data-lead="${r.id}" tabindex="0"><td><b class="mono">${esc(r.ref)}</b><br><span class="tiny muted">${esc(when(r.createdAt))}</span></td><td>${esc(r.service)}</td><td>${esc(r.when || '—')}</td><td><span class="pill ${r.status}">${esc(LABEL[r.status] || r.status)}</span></td><td class="num">${rupee2(r.total)}${r.kind === 'estimate' ? '<br><span class="tiny muted">estimate</span>' : ''}</td><td class="num">${rupee2(r.paid)}</td><td class="num">${r.balance > 0.005 ? '<b>' + rupee2(r.balance) + '</b>' : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No bookings yet.</p>';
  const invTable = invs.length ? `<div class="scroll"><table style="min-width:520px"><thead><tr><th>Invoice</th><th>Booking</th><th class="num">Total</th><th>GST</th><th>State</th></tr></thead><tbody>${invs.map((r) => `<tr class="inv-tr" data-lead="${r.lead_id}" tabindex="0"${r.voided_at ? ' style="opacity:.6"' : ''}><td><b>${esc(r.number)}</b><br><span class="tiny muted">${esc(when(r.issued_at))}</span></td><td class="mono">${esc(refOf[r.lead_id] || '')}</td><td class="num">${rupee2(r.total)}</td><td>${r.has_gst ? r.gst_rate + '%' : 'None'}</td><td>${r.voided_at ? '<span class="pill p-bad">Deleted</span>' : '<span class="pill p-ok">Active</span>'}</td></tr>`).join('')}</tbody></table></div><p class="tiny muted" style="margin:8px 0 0">Open a booking to delete or restore its invoice.</p>` : '<p class="muted" style="margin:0">No saved invoices. A copy is saved each time an invoice is printed or emailed.</p>';
  return `<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:start"><div><h2 style="font-size:24px;margin:0">${esc(c.name)}</h2><p class="muted" style="margin:4px 0 0">+91 ${esc(c.phone)}${c.email ? ' · ' + esc(c.email) : ''}${c.area ? ' · ' + esc(c.area) : ''}</p>${bikes.length ? `<p class="tiny muted" style="margin:4px 0 0">${esc(bikes.join(', '))}</p>` : ''}${c.company_name ? `<p class="tiny muted" style="margin:4px 0 0">${esc(c.company_name)}${c.gstin ? ' · GSTIN ' + esc(c.gstin) : ''}</p>` : ''}</div>
    <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-ghost btn-sm" type="button" data-act="cbEdit">Edit customer</button><button class="btn btn-primary btn-sm" type="button" data-act="cbNewBooking">New booking</button></div></div>
    <div class="kpis" style="margin-top:14px">${kpi(sm.bookings, 'Bookings')}${kpi(rupee2(sm.billed), 'Invoiced')}${kpi(rupee2(sm.paid), 'Paid')}${kpi(rupee2(sm.due), 'Still due')}</div></div>
  <div class="card" style="margin-top:12px"><h3>Bookings</h3>${bookingTable}</div>
  <div class="card" style="margin-top:12px"><h3>Invoices</h3>${invTable}</div>
  <div class="card" style="margin-top:12px"><h3>Payments</h3>${ents.length ? `<div class="scroll"><table style="min-width:620px"><thead><tr><th>Date</th><th>Booking</th><th>What</th><th class="num">Amount</th><th>Recorded by</th><th></th></tr></thead><tbody>${ents.map((e) => { const del = gone.has(e.id); return `<tr${del || e.entry_type === 'reversal' ? ' style="opacity:.6"' : ''}><td>${esc(e.occurred_on)}</td><td class="mono">${esc(refOf[e.lead_id] || '')}</td><td>${esc(entryLabel(e))}${del ? ' <span class="tiny muted">(deleted)</span>' : ''}</td><td class="num"><b>${e.entry_type === 'refund' ? '−' : ''}${rupee2(e.amount)}</b></td><td class="tiny">${esc(whoRecorded(e))}</td><td>${isOwner() && !del && e.entry_type !== 'reversal' ? (e.source === 'gateway' ? '<span class="tiny muted">Refund in Razorpay</span>' : `<button class="btn btn-ghost btn-sm" type="button" data-act="finReverse" data-id="${e.id}">Delete</button>`) : ''}</td></tr>`; }).join('')}</tbody></table></div>` : '<p class="muted" style="margin:0">No payments recorded.</p>'}</div>`;
}
function activity() { return '<h1 style="font-size:34px">Activity</h1><p class="muted">Every admin action, newest first.</p><div class="list" id="act"><p class="muted" style="padding:16px">Loading…</p></div>'; }
async function loadActivity() {
  const { data } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100);
  const el = $('#act'); if (!el) return;
  el.innerHTML = (data ?? []).map((a) => `<div class="row" style="cursor:default"><span class="meta">${when(a.created_at)}</span><span>${esc(a.action.replace(/_/g, ' '))}<br><span class="meta">${esc(JSON.stringify(a.details))}</span></span><span class="meta">${a.actor ? (a.actor === S.me.user_id ? 'You' : 'Team') : 'System'}</span></div>`).join('') || '<p class="muted" style="padding:16px">No activity yet.</p>';
}

sb.auth.getSession().then(({ data }) => { if (data.session && !recovering) boot(); });
