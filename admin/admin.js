// Mechanix Pro admin panel — Supabase Auth + Row Level Security. All data access is checked in the database.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { leadDetailRows, sourceReport } from './lead-view.js';
import { customerRows, searchCustomers, mechanicStats } from './people.js';
import { couponRows } from './coupon-view.js';
import { rangeFor, buildReport, reportCsv, payoutReport } from './report.js';
import { splitJob } from './split.js';
import { pinRows, validPin, cleanPin, cleanPinName } from './pins-view.js';
import { interestCounts, waitlistRows, interestLabel } from './waitlist-view.js';
import { buildInvoice } from './invoice.js';
import { buildNewBooking } from './new-booking.js';
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
const S = { me: null, tab: 'dash', leads: [], services: [], settings: {}, customers: [], bikes: [], mechanics: [], coupons: [], homeimgs: [], issues: [], pins: [], pq: '', waitlist: [], wi: '', wq: '', ifilter: 'open', selMode: false, sel: new Set(), range: '30d', cq: '', q: '', status: 'open', open: null, openCust: null, channel: null };

function toast(m) { const t = document.createElement('div'); t.className = 'toast fade'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
async function audit(action, details) { try { await sb.from('audit_log').insert({ action, details, actor: S.me.user_id }); } catch (e) {} }
const basis = () => (S.settings.payout_basis === 'before_gst' ? 'before_gst' : 'collected');
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
let codeEmail = '';
$('#sendCode').addEventListener('click', async () => {
  const email = $('#em').value.trim(); $('#loginErr').textContent = '';
  if (!email) { $('#loginErr').textContent = 'Enter your email first.'; return; }
  $('#sendCode').disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  $('#sendCode').disabled = false;
  if (error) { $('#loginErr').textContent = /rate|seconds|too many/i.test(error.message) ? 'Please wait a minute before asking for another code.' : 'Could not send a code. Check the email address, or use your password.'; return; }
  codeEmail = email; $('#codeBox').hidden = false; $('#sendCode').textContent = 'Send a new code'; $('#code').focus();
  $('#loginInfo').textContent = 'We sent a 6-digit code to ' + email + '. It works for 10 minutes.';
});
$('#verifyCode').addEventListener('click', async () => {
  const token = $('#code').value.replace(/\D/g, ''); $('#loginErr').textContent = '';
  if (token.length < 6) { $('#loginErr').textContent = 'Enter the 6-digit code.'; return; }
  const { error } = await sb.auth.verifyOtp({ email: codeEmail || $('#em').value.trim(), token, type: 'email' });
  if (error) { $('#loginErr').textContent = 'That code is wrong or has expired. Ask for a new one.'; return; }
  boot();
});
$('#signOut').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data: me } = await sb.from('admins').select('user_id,name,role').eq('user_id', user.id).maybeSingle();
  if (!me) { $('#loginErr').textContent = 'This account is not an admin. Ask the owner to add you.'; await sb.auth.signOut(); return; }
  S.me = me;
  $('#login').hidden = true; $('#view').hidden = false; $('#tabs').hidden = false; $('#signOut').hidden = false;
  await Promise.all([loadLeads(), loadServices(), loadSettings(), loadPeople(), loadHome(), loadIssues(), loadPins(), loadWaitlist()]);
  render();
  S.channel = sb.channel('mxp-admin')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async (p) => { if (p.eventType === 'INSERT') toast('New booking ' + (p.new?.ref ?? '')); await loadLeads(); if (!['prices', 'settings', 'offers', 'homeimgs'].includes(S.tab)) render(); if (S.open) openLead(S.open, true); })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (p) => { if (S.open && p.new?.lead_id === S.open) openLead(S.open, true); })
    .subscribe();
}

/* ---------- data ---------- */
async function loadLeads() {
  const { data, error } = await sb.from('leads').select('*').order('created_at', { ascending: false }).limit(500);
  if (error) toast('Could not load bookings'); else S.leads = data;
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
  const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; document.querySelectorAll('#tabs button').forEach((b) => b.toggleAttribute('aria-current', b === t)); document.querySelectorAll('#tabs button').forEach((b) => b === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')); render(); return; }
  const r = e.target.closest('[data-lead]'); if (r) { if (S.selMode) { const id = r.dataset.lead; if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); render(); } else openLead(r.dataset.lead); return; }
  const cu = e.target.closest('[data-cust]'); if (cu) { openCustomer(cu.dataset.cust); return; }
  const is = e.target.closest('[data-issue]'); if (is) { openIssue(is.dataset.issue); return; }
  const wb = e.target.closest('[data-wi]'); if (wb) { S.wi = S.wi === wb.dataset.wi ? '' : wb.dataset.wi; render(); return; }
  const wl = e.target.closest('[data-wl]'); if (wl) { openWaitlist(wl.dataset.wl); return; }
  const pn = e.target.closest('[data-pin]'); if (pn) { openPin(pn.dataset.pin); return; }
  const me = e.target.closest('[data-mech]'); if (me) { openMechanic(me.dataset.mech); return; }
  const co = e.target.closest('[data-coupon]'); if (co) { openCoupon(co.dataset.coupon); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a);
});
document.addEventListener('input', (e) => { if (e.target.id === 'mr-range' || e.target.id === 'mr') { const v = Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)); if (e.target.id === 'mr-range') $('#mr').value = v; else $('#mr-range').value = v; updateSplitPreview(); }  if (e.target.id === 'q') { S.q = e.target.value; renderList(); } if (e.target.id === 'wq') { S.wq = e.target.value; render(); const again = $('#wq'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } } if (e.target.id === 'pq') { S.pq = e.target.value; const l = $('#pinlist'); if (l) { const keep = e.target; render(); const again = $('#pq'); if (again) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); } } } if (e.target.id === 'cq') { S.cq = e.target.value; renderCustomers(); } });
document.addEventListener('change', (e) => { if (e.target.id === 'il') { const l = S.leads.find((x) => x.id === e.target.value), w = warrantyInfo(l, WARRANTY_DAYS); $('#iw').textContent = l ? (w.active ? `Warranty is active until ${w.endsOn} (${w.daysLeft} days left).` : 'No active warranty on this booking (needs a completed job within 30 days).') : ''; } if (e.target.id === 'hf') ACT.uploadHome(e.target); if (e.target.id === 'ifs') { S.ifilter = e.target.value; render(); } if (e.target.id === 'fs') { S.status = e.target.value; renderList(); } if (e.target.id === 'rr') { S.range = e.target.value; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#inv')) $('#inv').remove(); else if (!$('#sheet').hidden) closeSheet(); } });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

function render() { const v = $('#view'); v.innerHTML = ({ dash, leads, customers, mechanics, coupons, issues, pins, waitlist, offers, reports, prices, homeimgs, settings, activity })[S.tab](); if (S.tab === 'leads') renderList(); if (S.tab === 'customers') renderCustomers(); if (S.tab === 'activity') loadActivity(); }

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
  <button class="btn btn-ghost btn-sm" type="button" data-act="csv">Export CSV</button><button class="btn btn-primary btn-sm" type="button" data-act="newLead">Add booking</button>
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
  const rows = mechanicStats(S.mechanics, S.leads, { basis: basis() });
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">Assign a mechanic from a booking. Payout is the share of money collected on completed jobs, at the rate you set for each mechanic.</p>${isOwner() ? '<button class="btn btn-primary btn-sm" type="button" data-act="newMechanic">Add mechanic</button>' : ''}</div>
  <div class="list">${rows.length ? rows.map((m) => `<button class="row mrow" data-mech="${m.id}"><span>${esc(m.name)} ${m.active ? '' : '<span class="pill off">Inactive</span>'}<br><span class="meta">${esc(m.city)} · ${m.years} yr · Mechanic ${m.rate}% · Company ${m.companyRate}%${m.certified ? ' · Certified' : ''}<br><span class="splitbar" role="img" aria-label="Mechanic ${m.rate} percent, company ${m.companyRate} percent"><i style="width:${m.rate}%"></i></span>${m.specialties ? '<br>' + esc(m.specialties) : ''}</span></span><span class="meta">${m.open} open</span><span class="meta">${m.completed} done · ${rupee(m.revenue)}</span><b>${rupee(m.payout)}</b></button>`).join('') : '<p class="muted" style="padding:16px">No mechanics yet. Add your first one to start assigning jobs.</p>'}</div>`;
}
/* The revenue split picture: a two-colour bar and a sample job, so the percentage is never just a number. */
function updateSplitPreview() {
  const n = $('#mr'); if (!n) return;
  const rate = Math.min(100, Math.max(0, parseInt(n.value, 10) || 0)), sp = splitJob(1000, rate, basis());
  const bar = $('#split-bar'), sample = $('#split-sample');
  if (bar) { bar.setAttribute('aria-label', `Mechanic ${rate} percent, company ${100 - rate} percent`); bar.innerHTML = `<span class="sb-mech" style="width:${rate}%">${rate >= 14 ? 'Mechanic ' + rate + '%' : ''}</span><span class="sb-co" style="width:${100 - rate}%">${100 - rate >= 14 ? 'Company ' + (100 - rate) + '%' : ''}</span>`; }
  if (sample) sample.textContent = `On a ${rupee(1000)} job: the mechanic gets ${rupee(sp.mechanic)} and the company keeps ${rupee(sp.company)}.` + (sp.gst ? ` (${rupee(sp.gst)} is GST.)` : '');
}
function openNewBooking() {
  const svcs = S.services.filter((x) => x.kind === 'service' && x.active), adds = S.services.filter((x) => x.kind === 'addon' && x.active);
  const sel = (id, opts, d) => `<select id="${id}">${opts.map(([v, t]) => `<option value="${v}"${v === d ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  S.open = null; S.openCust = null; S.openMech = null;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">Add booking</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p class="small muted" style="margin:8px 0 0">Name and mobile number are all you need. Add the rest if you have it, so the mechanic and the invoice have the details.</p>
  <div class="card" style="margin-top:12px"><h3>Customer</h3><div class="inline-form">
    <label class="label" for="nb-name">Name *</label><input id="nb-name" maxlength="60" autocomplete="off">
    <label class="label" for="nb-phone">Mobile number *</label><input id="nb-phone" inputmode="numeric" maxlength="14" placeholder="10 digits" autocomplete="off">
    <label class="label" for="nb-email">Email (for the confirmation and invoice)</label><input id="nb-email" type="email" maxlength="120" autocomplete="off">
    <label class="label" for="nb-source">How did they reach us?</label>${sel('nb-source', [['phone', 'Phone call'], ['whatsapp', 'WhatsApp'], ['walk_in', 'Walk-in or referral']], 'phone')}
    <label class="check"><input type="checkbox" id="nb-wa"><span>The customer agreed to WhatsApp updates</span></label></div></div>
  <div class="card" style="margin-top:12px"><h3>Bike</h3><div class="inline-form">
    <label class="label" for="nb-brand">Brand</label><input id="nb-brand" maxlength="30" placeholder="Honda, Royal Enfield…">
    <label class="label" for="nb-model">Model</label><input id="nb-model" maxlength="40" placeholder="Activa 6G, Classic 350…">
    <label class="label" for="nb-nick">Nickname (optional)</label><input id="nb-nick" maxlength="24">
    <label class="label" for="nb-reg">Registration number (optional)</label><input id="nb-reg" maxlength="14" placeholder="KA 03 AB 1234">
    <label class="check"><input type="checkbox" id="nb-big"><span>Above 180cc (adds the big-bike charge to service packages)</span></label></div></div>
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
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0; $('#nb-name').focus();
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
      <div id="split-bar" class="split-bar" role="img"></div><p id="split-sample" class="split-sample" role="status"></p></div>
    <label class="label" for="mcity">City</label><input id="mcity" maxlength="40" value="${esc(m.city || 'Bengaluru')}"${ro}>
    <label class="label" for="msp">Specialties (for example: scooters, Royal Enfield, EV)</label><input id="msp" maxlength="120" value="${esc(m.specialties || '')}"${ro}>
    <label class="label" for="mexp">Years of experience</label><input id="mexp" inputmode="numeric" maxlength="2" value="${esc(m.experience_years || 0)}"${ro}>
    <label class="label" for="mnotes">Private notes (not shown to customers)</label><input id="mnotes" maxlength="500" value="${esc(m.notes || '')}"${ro}>
    <label class="check"><input type="checkbox" id="mcert"${m.certified !== false ? ' checked' : ''}${ro}><span>Mechanix Pro certified (shown to the customer in the confirmation)</span></label>
    <label class="check"><input type="checkbox" id="mc"${m.active ? ' checked' : ''}${ro}><span>Active (can be assigned new jobs)</span></label>
    ${isOwner() ? '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><button class="btn btn-primary" type="button" data-act="saveMechanic">Save</button>' + (id !== 'new' ? '<button class="btn btn-ghost" type="button" data-act="deleteMechanic">Delete mechanic</button>' : '') + '</div>' : '<p class="tiny muted">Only the owner can change mechanics.</p>'}</div></div>
  ${st ? `<div class="card" style="margin-top:12px"><h3>Jobs</h3><dl class="kv"><dt>Open</dt><dd>${st.open}</dd><dt>Completed</dt><dd>${st.completed}</dd><dt>Collected</dt><dd>${rupee(st.revenue)}</dd><dt>Payout due</dt><dd>${rupee(st.payout)}</dd></dl></div>` : ''}`;
  updateSplitPreview();
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
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

function payoutCard(l) {
  const m = S.mechanics.find((x) => x.id === l.mechanic_id); if (!m) return '';
  if (!(l.paid_amount > 0)) return `<div class="card" style="margin-top:12px"><h3>Payout for this job</h3><p class="small muted" style="margin:0">${esc(m.name)} gets ${m.payout_rate || 0}% and the company keeps ${100 - (m.payout_rate || 0)}% once the customer has paid.</p></div>`;
  const sp = splitJob(l.paid_amount, m.payout_rate || 0, basis());
  return `<div class="card" style="margin-top:12px"><h3>Payout for this job</h3>
    <div class="split-bar" role="img" aria-label="Mechanic ${sp.mechanicRate} percent, company ${sp.companyRate} percent"><span class="sb-mech" style="width:${sp.mechanicRate}%">${sp.mechanicRate >= 14 ? sp.mechanicRate + '%' : ''}</span><span class="sb-co" style="width:${sp.companyRate}%">${sp.companyRate >= 14 ? sp.companyRate + '%' : ''}</span></div>
    <dl class="kv" style="margin-top:10px"><dt>Collected</dt><dd>${rupee(l.paid_amount)}</dd>${sp.gst ? `<dt>GST</dt><dd>${rupee(sp.gst)}</dd>` : ''}<dt>${esc(m.name)} gets</dt><dd><b>${rupee(sp.mechanic)}</b></dd><dt>Company keeps</dt><dd><b>${rupee(sp.company)}</b></dd></dl></div>`;
}
async function openLead(id, silent) {
  S.open = id; const l = S.leads.find((x) => x.id === id); if (!l) return;
  const { data: msgs } = await sb.from('messages').select('*').eq('lead_id', id).order('created_at').limit(200);
  const wa = 'https://wa.me/91' + l.phone;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${esc(l.ref)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p><span class="pill ${l.status}">${LABEL[l.status]}</span> ${l.opted_out ? '<span class="pill lost">Opted out</span>' : ''} ${l.paid_amount ? `<span class="pill paid">Paid ${rupee(l.paid_amount)}</span>` : ''}</p>
  <div class="card"><dl class="kv"><dt>Customer</dt><dd>${esc(l.name)}<br><a href="tel:+91${esc(l.phone)}">+91 ${esc(l.phone)}</a></dd><dt>Service</dt><dd>${esc(svcName(l.service_id))}${(l.addons || []).length ? ' + ' + l.addons.map((a) => esc(svcName(a))).join(', ') : ''}</dd><dt>Estimate</dt><dd>${l.est_total ? rupee(l.est_total) : '—'}</dd><dt>Area</dt><dd>${esc(l.area || '—')}</dd><dt>When</dt><dd>${esc(l.preferred_date || '—')} · ${esc(l.preferred_time || SLOT[l.preferred_slot] || '—')}</dd>${leadDetailRows(l).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Map pin' ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open in Google Maps</a>` : esc(v)}</dd>`).join('')}<dt>Source</dt><dd>${esc(l.source)}${l.utm?.utm_campaign ? ' · ' + esc(l.utm.utm_campaign) : ''}</dd><dt>Created</dt><dd>${when(l.created_at)}</dd><dt>Reminders</dt><dd>${l.next_followup_at ? 'Next ' + when(l.next_followup_at) + ' (step ' + (l.followup_step + 1) + ' of 4)' : 'None scheduled'}</dd></dl>
  <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">Open WhatsApp chat</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a></div></div>
  ${payoutCard(l)}<div class="card" style="margin-top:12px"><h3>Update</h3>
    <label class="label" for="ls">Status</label><select id="ls">${STATUSES.map((s) => `<option value="${s}"${s === l.status ? ' selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
    <label class="label" for="lm">Mechanic</label><select id="lm"><option value="">Not assigned</option>${S.mechanics.filter((m) => m.active || m.id === l.mechanic_id).map((m) => `<option value="${m.id}"${m.id === l.mechanic_id ? ' selected' : ''}>${esc(m.name)}${m.active ? '' : ' (inactive)'}</option>`).join('')}</select>
    <label class="label" for="la">Garage or outside partner (if not on your mechanic list)</label><input id="la" value="${esc(l.assigned_to || '')}" maxlength="60">
    <label class="label" for="ln">Notes</label><textarea id="ln" rows="3" maxlength="1000">${esc(l.notes || '')}</textarea>
    <label class="check"><input type="checkbox" id="lai"${l.ai_enabled ? ' checked' : ''}><span>AI assistant replies and automatic reminders for this booking</span></label>
    <button class="btn btn-primary" style="margin-top:14px" type="button" data-act="save">Save changes</button></div>
  <div class="card" style="margin-top:12px"><h3>Payment</h3>${l.payment_link ? `<p class="small">Payment link: <a href="${esc(l.payment_link)}" target="_blank" rel="noopener">${esc(l.payment_link)}</a> (${rupee(l.amount_due)})</p><p><a class="btn btn-wa btn-sm" target="_blank" rel="noopener" href="https://wa.me/91${esc(l.phone)}?text=${encodeURIComponent('Hi ' + String(l.name).split(' ')[0] + ', here is your secure link to pay ' + rupee(l.amount_due) + ' for booking ' + l.ref + ': ' + l.payment_link)}">Send link on WhatsApp</a></p>` : ''}
    <label class="label" for="pa">Amount <span class="muted" style="font-weight:400">(${S.leads.some((x) => x.phone === l.phone && x.id !== l.id && x.status === 'completed') ? 'returning customer' : 'new customer'} slot fee by default)</span></label><input id="pa" inputmode="numeric" value="${esc(l.amount_due || slotFeeFor(l))}">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${isOwner() ? '<button class="btn btn-ghost btn-sm" type="button" data-act="deleteLead">Delete booking</button>' : ''}<button class="btn btn-ghost btn-sm" type="button" data-act="issueFromLead">Log an issue</button><button class="btn btn-ghost btn-sm" type="button" data-act="invoice">Invoice</button><button class="btn btn-primary btn-sm" type="button" data-act="confirmBooking">Confirm booking and email customer</button><button class="btn btn-dark btn-sm" type="button" data-act="payLink">Create & send payment link</button><button class="btn btn-ghost btn-sm" type="button" data-act="markPaid">Mark paid manually</button></div>
    <p class="tiny muted">Paid bookings stop all automatic reminders.</p></div>
  <div class="card" style="margin-top:12px"><h3>WhatsApp conversation</h3><div class="chat">${(msgs ?? []).map((m) => `<div class="bubble ${m.direction}">${esc(m.body)}<small>${m.direction === 'in' ? 'Customer' : m.sender === 'ai' ? 'AI assistant' : m.sender === 'staff' ? 'Team' : 'Automatic'} · ${when(m.created_at)}</small></div>`).join('') || '<p class="muted small">No messages yet. The conversation appears here once WhatsApp automation is connected.</p>'}</div></div>`;
  $('#sheet').hidden = false; if (!silent) $('#sheetPanel').scrollTop = 0;
  const chat = $('.chat'); if (chat) chat.scrollTop = chat.scrollHeight;
}
function closeSheet() { $('#sheet').hidden = true; S.open = null; S.openCust = null; S.openMech = null; S.openCoupon = null; }

const ACT = {
  close: closeSheet,
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
  async save() {
    const l = S.leads.find((x) => x.id === S.open);
    const mid = $('#lm').value || null, mech = S.mechanics.find((m) => m.id === mid);
    const upd = { status: $('#ls').value, mechanic_id: mid, assigned_to: $('#la').value.trim() || (mech ? mech.name : null), notes: $('#ln').value.trim() || null, ai_enabled: $('#lai').checked };
    const { error } = await sb.from('leads').update(upd).eq('id', l.id);
    if (error) return toast('Could not save: ' + error.message);
    await audit('lead_updated', { ref: l.ref, ...upd, notes: undefined }); toast('Saved'); await loadLeads(); renderList(); openLead(l.id, true);
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
    if (!confirm(`Delete ${ids.length} booking${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    const { error } = await sb.from('leads').delete().in('id', ids);
    if (error) return toast('Could not delete: ' + error.message);
    await audit('booking_deleted', { count: ids.length }); toast(ids.length + ' deleted');
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
      const r = await sb.from('leads').delete().eq('customer_id', c.id); if (r.error) return toast('Could not delete the bookings: ' + r.error.message);
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
    if (!confirm(`Delete booking ${l.ref} for ${l.name}? This cannot be undone.`)) return;
    const { error } = await sb.from('leads').delete().eq('id', l.id);
    if (error) return toast('Could not delete: ' + error.message);
    await audit('booking_deleted', { ref: l.ref }); toast('Deleted ' + l.ref);
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
  invPrint() { window.print(); },
  invEdit() { const b = $('#invEditBox'); if (!b) return; b.hidden = !b.hidden; if (!b.hidden) b.scrollIntoView({ block: 'nearest' }); },
  invAddRow() { $('#ie-rows').insertAdjacentHTML('beforeend', invEditRow('', '')); $('#ie-rows').lastElementChild.querySelector('input').focus(); },
  invDelRow(btn) { btn.closest('.ie-row').remove(); },
  async invSaveEdit() {
    const l = S.leads.find((x) => x.id === S.open); if (!l) return;
    const lines = [...document.querySelectorAll('#ie-rows .ie-row')].map((r) => ({ name: r.querySelector('[data-ie=name]').value.trim(), amount: parseFloat(r.querySelector('[data-ie=amount]').value) })).filter((x) => x.name || x.amount);
    if (!lines.length) return toast('Add at least one item');
    if (lines.some((x) => !x.name)) return toast('Give every amount an item name');
    if (lines.some((x) => !(x.amount >= 0) || x.amount > 1000000)) return toast('Check the amounts');
    const override = { basis: $('#ie-basis').value === 'incl' ? 'incl' : 'excl', lines: lines.map((x) => ({ name: x.name.slice(0, 80), amount: Math.round(x.amount * 100) / 100 })) };
    const { error } = await sb.from('leads').update({ invoice_override: override }).eq('id', l.id);
    if (error) return toast('Could not save the invoice: ' + error.message);
    await audit('invoice_edited', { ref: l.ref, basis: override.basis, lines: override.lines.length }); toast('Invoice updated');
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
    toast(error || !data || data.error ? 'Could not send: ' + ((data && data.error) || (error && error.message) || 'try again') : 'Invoice emailed to the customer');
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
  async markPaid() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10);
    if (!(amount > 0)) return toast('Enter the amount received');
    if (!confirm(`Mark ${l.ref} as paid ${rupee(amount)}?`)) return;
    const { error } = await sb.from('leads').update({ status: 'paid', paid_amount: (l.paid_amount || 0) + amount, paid_at: new Date().toISOString() }).eq('id', l.id);
    if (error) return toast(error.message);
    await audit('marked_paid_manually', { ref: l.ref, amount }); toast('Marked paid'); await loadLeads(); openLead(l.id, true);
  },
  newLead() { openNewBooking(); },
  async saveNewBooking() {
    const v = (id) => ($('#' + id)?.value ?? '');
    const f = { name: v('nb-name'), phone: v('nb-phone'), email: v('nb-email'), source: v('nb-source'), status: v('nb-status'), brand: v('nb-brand'), model: v('nb-model'), nickname: v('nb-nick'), regNo: v('nb-reg'), bigBike: $('#nb-big').checked,
      service: v('nb-service'), addons: [...document.querySelectorAll('[data-nb-addon]:checked')].map((x) => x.dataset.nbAddon), area: v('nb-area'), pincode: v('nb-pin'), address: v('nb-addr'), place: v('nb-place'),
      date: v('nb-date'), slot: v('nb-slot'), time: v('nb-time'), km: v('nb-km'), note: v('nb-note'), whatsapp: $('#nb-wa').checked, reminder: $('#nb-rem').checked };
    const r = buildNewBooking(f, { services: S.services, today: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) });
    if (r.error) return toast(r.error);
    const cust = { phone: r.customer.phone, name: r.customer.name }; if (r.customer.email) cust.email = r.customer.email;
    const { data: c, error: ce } = await sb.from('customers').upsert(cust, { onConflict: 'phone' }).select('id').single();
    if (ce) return toast(ce.message);
    let bikeId = null;
    if (r.bike) { const { data: b } = await sb.from('bikes').insert({ customer_id: c.id, ...r.bike }).select('id').single(); bikeId = b?.id ?? null; }
    const { data, error } = await sb.from('leads').insert({ ...r.lead, customer_id: c.id, bike_id: bikeId }).select('id').single();
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
    const pairs = { payout_basis: $('#st-basis').value, ai_enabled: $('#st-ai').checked, quiet_hours: { start: parseInt($('#st-q1').value, 10), end: parseInt($('#st-q2').value, 10) }, business_info: { ...(S.settings.business_info || {}), hours: $('#st-hours').value.trim(), areas: $('#st-areas').value.trim(), warranty: $('#st-war').value.trim() } };
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
  <div class="card"><h3>Mechanic payouts</h3><p class="small muted" style="margin:0 0 8px">Each mechanic's percentage is set on their own page. Choose what the percentage is worked out on.</p>
  <label class="label" for="st-basis">Work out the split on</label><select id="st-basis"${dis}><option value="collected"${basis() === 'collected' ? ' selected' : ''}>The amount collected (GST included)</option><option value="before_gst"${basis() === 'before_gst' ? ' selected' : ''}>The amount before GST (GST is kept aside)</option></select>
  <p class="tiny muted" style="margin:8px 0 0">Ask your accountant which to use. The GST on a job is paid to the government either way.</p></div>
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
async function openInvoice(lead, opts = {}) {
  const co = await loadCompany(), v = buildInvoice(lead, S.services), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches || opts.quick;
  $('#inv')?.remove();
  const addr = [...(co.addressLines || []), [co.city, co.state, co.pincode].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  const el = document.createElement('div'); el.id = 'inv'; el.className = 'inv-wrap'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Invoice ' + v.number);
  el.innerHTML = `<div class="inv-gen" aria-live="polite"><img src="/assets/img/logo.svg" alt="" width="56" height="58"><b>Generating invoice</b>
    <ol><li style="--d:.1s">Collecting booking ${esc(v.ref)}</li><li style="--d:.6s">Adding services and add-ons</li><li style="--d:1.1s">Splitting GST</li></ol><i></i></div>
  <div class="inv-paper" hidden>
    <div class="inv-head"><div><img src="/assets/img/logo.svg" alt="" width="40" height="42"><b class="inv-co">${esc(co.legalName)}</b><span class="inv-sub">Trading as ${esc(co.brand)}<br>${addr}${co.gstin ? '<br>GSTIN ' + esc(co.gstin) : ''}</span></div>
      <div class="inv-meta"><h2>TAX INVOICE</h2><span>${esc(v.number)}</span><span>${esc(v.dateLabel)}</span></div></div>
    <p class="inv-to"><span>Billed to</span><b>${esc(v.customer.name)}</b> · ${esc(v.customer.phone)}</p>
    <table class="inv-table"><thead><tr><th>Item</th><th class="num">Amount (${v.basis === 'excl' ? 'excl.' : 'incl.'} GST)</th></tr></thead><tbody>
      ${v.lines.length ? v.lines.map((l, i) => `<tr class="inv-line" style="--i:${i}"><td>${esc(l.name)}</td><td class="num">${inr(l.amount)}</td></tr>`).join('') : '<tr><td colspan="2" class="muted">No priced items on this booking.</td></tr>'}
      ${v.couponDiscount ? `<tr class="inv-line" style="--i:${v.lines.length}"><td>Coupon discount</td><td class="num">− ${inr(v.couponDiscount)}</td></tr>` : ''}${v.extraDiscount ? `<tr class="inv-line" style="--i:${v.lines.length + 1}"><td>Special discount${v.extraNote ? ' (' + esc(v.extraNote) + ')' : ''}</td><td class="num">− ${inr(v.extraDiscount)}</td></tr>` : ''}</tbody></table>
    <dl class="inv-tot"><dt>Taxable value</dt><dd data-to="${v.taxable}">${inr(v.taxable)}</dd><dt>CGST @ 9%</dt><dd data-to="${v.cgst}">${inr(v.cgst)}</dd><dt>SGST @ 9%</dt><dd data-to="${v.sgst}">${inr(v.sgst)}</dd>
      <dt class="grand">Total</dt><dd class="grand" data-to="${v.total}">${inr(v.total)}</dd>${v.paid ? `<dt>Paid so far</dt><dd data-to="${v.paid}">${inr(v.paid)}</dd><dt class="grand">Balance due</dt><dd class="grand" data-to="${v.balance}">${inr(v.balance)}</dd>` : ''}${v.refund ? `<dt class="grand">Refund due to customer</dt><dd class="grand" data-to="${v.refund}">${inr(v.refund)}</dd>` : ''}</dl>
    <div class="inv-stamp ${v.balance === 0 && v.total > 0 ? 'paid' : 'due'}" aria-hidden="true">${v.balance === 0 && v.total > 0 ? 'PAID' : 'DUE'}</div>
    <p class="inv-foot">${v.basis === 'excl' ? 'Amounts are before GST. GST is added at 18% and shown in the totals.' : 'Prices include 18% GST.'} Parts are OEM certified, work is done by Mechanix Pro certified mechanics, and every service carries a 30-day warranty. Computer-generated invoice.</p>
    <div class="inv-adjust"><label for="inv-disc"><b>Last-minute discount</b> <span class="tiny muted">at the customer's request, on top of any coupon</span></label>
      <div class="inv-adjust-row"><select id="inv-disc-kind" aria-label="Discount type"><option value="amt">₹ amount</option><option value="pct">% of the bill</option></select><input id="inv-disc" inputmode="numeric" maxlength="6" placeholder="0" value="${v.extraDiscount || ''}" aria-label="Discount"><input id="inv-disc-note" maxlength="80" placeholder="Reason, for example: regular customer" value="${esc(v.extraNote)}" aria-label="Reason"><button class="btn btn-dark btn-sm" type="button" data-act="invDiscount">Apply</button></div></div>
    <div class="inv-edit card" id="invEditBox" hidden><b>Edit invoice</b> <span class="tiny muted">Change the items and amounts for this booking. The invoice and the email use what you save.</span>
      <label class="label" for="ie-basis">The amounts below are</label><select id="ie-basis"><option value="excl"${v.basis === 'excl' ? ' selected' : ''}>Before GST (18% GST is added on top)</option><option value="incl"${v.basis === 'incl' ? ' selected' : ''}>Including GST (GST is worked out from the amount)</option></select>
      <div id="ie-rows">${v.lines.map((l) => invEditRow(l.name, l.amount)).join('')}</div>
      <div class="inv-adjust-row"><button class="btn btn-ghost btn-sm" type="button" data-act="invAddRow">Add an item</button><button class="btn btn-primary btn-sm" type="button" data-act="invSaveEdit">Save invoice</button>${lead.invoice_override ? '<button class="btn btn-ghost btn-sm" type="button" data-act="invResetEdit">Back to package prices</button>' : ''}</div></div>
    <div class="inv-actions"><button class="btn btn-primary btn-sm" type="button" data-act="invPrint">Print or save as PDF</button><button class="btn btn-ghost btn-sm" type="button" data-act="invEdit">Edit invoice</button><button class="btn btn-dark btn-sm" type="button" data-act="invEmail">Email to customer</button><button class="btn btn-ghost btn-sm" type="button" data-act="invClose">Close</button></div>
  </div>`;
  document.body.appendChild(el);
  const reveal = () => { const g = el.querySelector('.inv-gen'); if (g) g.remove(); const paper = el.querySelector('.inv-paper'); paper.hidden = false; paper.classList.add('in'); el.querySelectorAll('.inv-tot [data-to]').forEach((d) => countUp(d, +d.dataset.to, 900)); el.querySelector('[data-act="invPrint"]').focus(); };
  if (reduce) reveal(); else setTimeout(reveal, 1900);
}
function activity() { return '<h1 style="font-size:34px">Activity</h1><p class="muted">Every admin action, newest first.</p><div class="list" id="act"><p class="muted" style="padding:16px">Loading…</p></div>'; }
async function loadActivity() {
  const { data } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100);
  const el = $('#act'); if (!el) return;
  el.innerHTML = (data ?? []).map((a) => `<div class="row" style="cursor:default"><span class="meta">${when(a.created_at)}</span><span>${esc(a.action.replace(/_/g, ' '))}<br><span class="meta">${esc(JSON.stringify(a.details))}</span></span><span class="meta">${a.actor ? (a.actor === S.me.user_id ? 'You' : 'Team') : 'System'}</span></div>`).join('') || '<p class="muted" style="padding:16px">No activity yet.</p>';
}

sb.auth.getSession().then(({ data }) => { if (data.session) boot(); });
