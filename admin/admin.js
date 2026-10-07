// Mechanix Pro admin panel — Supabase Auth + Row Level Security. All data access is checked in the database.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { leadDetailRows, sourceReport } from './lead-view.js';
import { customerRows, searchCustomers, mechanicStats } from './people.js';
import { couponRows } from './coupon-view.js';
import { rangeFor, buildReport, reportCsv } from './report.js';

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
const S = { me: null, tab: 'dash', leads: [], services: [], settings: {}, customers: [], bikes: [], mechanics: [], coupons: [], range: '30d', cq: '', q: '', status: 'open', open: null, openCust: null, channel: null };

function toast(m) { const t = document.createElement('div'); t.className = 'toast fade'; t.setAttribute('role', 'status'); t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }
async function audit(action, details) { try { await sb.from('audit_log').insert({ action, details, actor: S.me.user_id }); } catch (e) {} }
const isOwner = () => S.me?.role === 'owner';

/* ---------- auth ---------- */
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('#loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
  if (error) { $('#loginErr').textContent = 'Wrong email or password.'; return; }
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
  await Promise.all([loadLeads(), loadServices(), loadSettings(), loadPeople()]);
  render();
  S.channel = sb.channel('mxp-admin')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, async (p) => { if (p.eventType === 'INSERT') toast('New booking ' + (p.new?.ref ?? '')); await loadLeads(); if (S.tab !== 'prices' && S.tab !== 'settings') render(); if (S.open) openLead(S.open, true); })
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
async function loadServices() { const { data } = await sb.from('services').select('*').order('sort'); S.services = data ?? []; }
async function loadSettings() { const { data } = await sb.from('settings').select('*'); S.settings = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])); }
const svcName = (id) => S.services.find((s) => s.id === id)?.name ?? id ?? '—';

/* ---------- views ---------- */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-tab]'); if (t) { S.tab = t.dataset.tab; document.querySelectorAll('#tabs button').forEach((b) => b.toggleAttribute('aria-current', b === t)); document.querySelectorAll('#tabs button').forEach((b) => b === t ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')); render(); return; }
  const r = e.target.closest('[data-lead]'); if (r) { openLead(r.dataset.lead); return; }
  const cu = e.target.closest('[data-cust]'); if (cu) { openCustomer(cu.dataset.cust); return; }
  const me = e.target.closest('[data-mech]'); if (me) { openMechanic(me.dataset.mech); return; }
  const co = e.target.closest('[data-coupon]'); if (co) { openCoupon(co.dataset.coupon); return; }
  const a = e.target.closest('[data-act]'); if (a && ACT[a.dataset.act]) ACT[a.dataset.act](a);
});
document.addEventListener('input', (e) => { if (e.target.id === 'q') { S.q = e.target.value; renderList(); } if (e.target.id === 'cq') { S.cq = e.target.value; renderCustomers(); } });
document.addEventListener('change', (e) => { if (e.target.id === 'fs') { S.status = e.target.value; renderList(); } if (e.target.id === 'rr') { S.range = e.target.value; render(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });

function render() { const v = $('#view'); v.innerHTML = ({ dash, leads, customers, mechanics, coupons, reports, prices, settings, activity })[S.tab](); if (S.tab === 'leads') renderList(); if (S.tab === 'customers') renderCustomers(); if (S.tab === 'activity') loadActivity(); }

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
  <button class="btn btn-ghost btn-sm" type="button" data-act="csv">Export CSV</button><button class="btn btn-primary btn-sm" type="button" data-act="newLead">Add booking</button></div><div class="list" id="list"></div>`;
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
    <button class="btn btn-primary" style="margin-top:14px" type="button" data-act="saveCustomer">Save</button></div>
  <div class="card" style="margin-top:12px"><h3>Booking history</h3>${mine.length ? mine.map((l) => `<button class="row" data-lead="${l.id}" style="border-radius:12px"><span class="ref">${esc(l.ref)}</span><span>${esc(svcName(l.service_id))}<br><span class="meta">${when(l.created_at)}</span></span><span class="pill ${l.status}">${LABEL[l.status]}</span></button>`).join('') : '<p class="small muted">No bookings yet.</p>'}</div>`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}

/* ---------- mechanics ---------- */
function mechanics() {
  const rows = mechanicStats(S.mechanics, S.leads);
  return `<div class="toolbar"><p class="small muted" style="margin:0;flex:1">Assign a mechanic from a booking. Payout is the share of money collected on completed jobs, at the rate you set for each mechanic.</p>${isOwner() ? '<button class="btn btn-primary btn-sm" type="button" data-act="newMechanic">Add mechanic</button>' : ''}</div>
  <div class="list">${rows.length ? rows.map((m) => `<button class="row mrow" data-mech="${m.id}"><span>${esc(m.name)} ${m.active ? '' : '<span class="pill off">Inactive</span>'}<br><span class="meta">Rate ${m.rate}%</span></span><span class="meta">${m.open} open</span><span class="meta">${m.completed} done · ${rupee(m.revenue)}</span><b>${rupee(m.payout)}</b></button>`).join('') : '<p class="muted" style="padding:16px">No mechanics yet. Add your first one to start assigning jobs.</p>'}</div>`;
}
function openMechanic(id) {
  const m = id === 'new' ? { id: 'new', name: '', phone: '', area: '', active: true, payout_rate: 0 } : S.mechanics.find((x) => x.id === id); if (!m) return;
  const st = id === 'new' ? null : mechanicStats(S.mechanics, S.leads).find((x) => x.id === id);
  const ro = isOwner() ? '' : ' disabled';
  S.open = null; S.openCust = null; S.openMech = id;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${id === 'new' ? 'New mechanic' : esc(m.name)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <div class="card" style="margin-top:12px"><div class="inline-form">
    <label class="label" for="mn">Name</label><input id="mn" maxlength="60" value="${esc(m.name)}"${ro}>
    <label class="label" for="mp">Mobile number</label><input id="mp" inputmode="numeric" maxlength="10" value="${esc(m.phone)}"${ro}>
    <label class="label" for="ma">Area they cover (optional)</label><input id="ma" maxlength="40" value="${esc(m.area || '')}"${ro}>
    <label class="label" for="mr">Payout rate, % of collected amount</label><input id="mr" inputmode="numeric" maxlength="3" value="${esc(m.payout_rate)}"${ro}>
    <label class="check"><input type="checkbox" id="mc"${m.active ? ' checked' : ''}${ro}><span>Active (can be assigned new jobs)</span></label>
    ${isOwner() ? '<button class="btn btn-primary" style="margin-top:8px" type="button" data-act="saveMechanic">Save</button>' : '<p class="tiny muted">Only the owner can change mechanics.</p>'}</div></div>
  ${st ? `<div class="card" style="margin-top:12px"><h3>Jobs</h3><dl class="kv"><dt>Open</dt><dd>${st.open}</dd><dt>Completed</dt><dd>${st.completed}</dd><dt>Collected</dt><dd>${rupee(st.revenue)}</dd><dt>Payout due</dt><dd>${rupee(st.payout)}</dd></dl></div>` : ''}`;
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
    ${isOwner() ? '<button class="btn btn-primary" style="margin-top:8px" type="button" data-act="saveCoupon">Save</button>' : '<p class="tiny muted">Only the owner can change coupons.</p>'}</div></div>
  ${id === 'new' ? '' : `<div class="card" style="margin-top:12px"><h3>Use so far</h3><dl class="kv"><dt>Asked for</dt><dd>${c.requested}</dd><dt>Went ahead</dt><dd>${c.used}</dd><dt>Discount given</dt><dd>${rupee(c.given)}</dd></dl></div>`}`;
  $('#sheet').hidden = false; $('#sheetPanel').scrollTop = 0;
}

/* ---------- reports ---------- */
const RANGES = [['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['90d', 'Last 90 days'], ['all', 'All time']];
function reportData() { return buildReport(S.leads, { services: S.services, mechanics: S.mechanics }, rangeFor(S.range)); }
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
  <div class="split2">${table('By service', r.byService)}${table('By area', r.byArea)}${table('By mechanic', r.byMechanic)}${table('By source', r.bySource)}</div>`;
}

function filtered() {
  const q = S.q.trim().toLowerCase();
  return S.leads.filter((l) => (S.status === 'all' || (S.status === 'open' ? ['new', 'contacted', 'quoted', 'payment_sent'].includes(l.status) : l.status === S.status)) &&
    (!q || [l.name, l.phone, l.ref, l.area].some((v) => String(v ?? '').toLowerCase().includes(q))));
}
function renderList() {
  const el = $('#list'); if (!el) return; const rows = filtered();
  el.innerHTML = rows.length ? rows.map((l) => `<button class="row" data-lead="${l.id}"><span class="ref">${esc(l.ref)}<br><span class="meta">${l.source === 'whatsapp' ? 'WhatsApp' : 'Website'}</span></span><span>${esc(l.name)} · <span class="meta">${esc(l.phone)}</span><br><span class="meta">${esc(svcName(l.service_id))} · ${esc(l.area || '')} · ${l.preferred_date ? esc(l.preferred_date) + ' ' + esc(SLOT[l.preferred_slot] ?? '') : ''}</span></span><span style="text-align:right"><span class="pill ${l.status}">${LABEL[l.status]}</span><br><span class="meta">${l.est_total ? rupee(l.est_total) : ''} · ${when(l.created_at)}</span></span></button>`).join('') : '<p class="muted" style="padding:16px">No bookings here yet.</p>';
}

async function openLead(id, silent) {
  S.open = id; const l = S.leads.find((x) => x.id === id); if (!l) return;
  const { data: msgs } = await sb.from('messages').select('*').eq('lead_id', id).order('created_at').limit(200);
  const wa = 'https://wa.me/91' + l.phone;
  $('#sheetPanel').innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h2 id="sheetTitle" style="font-size:28px;margin:0">${esc(l.ref)}</h2><button class="btn btn-ghost btn-sm" type="button" data-act="close">Close</button></div>
  <p><span class="pill ${l.status}">${LABEL[l.status]}</span> ${l.opted_out ? '<span class="pill lost">Opted out</span>' : ''} ${l.paid_amount ? `<span class="pill paid">Paid ${rupee(l.paid_amount)}</span>` : ''}</p>
  <div class="card"><dl class="kv"><dt>Customer</dt><dd>${esc(l.name)}<br><a href="tel:+91${esc(l.phone)}">+91 ${esc(l.phone)}</a></dd><dt>Service</dt><dd>${esc(svcName(l.service_id))}${(l.addons || []).length ? ' + ' + l.addons.map((a) => esc(svcName(a))).join(', ') : ''}</dd><dt>Estimate</dt><dd>${l.est_total ? rupee(l.est_total) : '—'}</dd><dt>Area</dt><dd>${esc(l.area || '—')}</dd><dt>When</dt><dd>${esc(l.preferred_date || '—')} · ${esc(SLOT[l.preferred_slot] ?? '—')}</dd>${leadDetailRows(l).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${k === 'Map pin' ? `<a href="${esc(v)}" target="_blank" rel="noopener">Open in Google Maps</a>` : esc(v)}</dd>`).join('')}<dt>Source</dt><dd>${esc(l.source)}${l.utm?.utm_campaign ? ' · ' + esc(l.utm.utm_campaign) : ''}</dd><dt>Created</dt><dd>${when(l.created_at)}</dd><dt>Reminders</dt><dd>${l.next_followup_at ? 'Next ' + when(l.next_followup_at) + ' (step ' + (l.followup_step + 1) + ' of 4)' : 'None scheduled'}</dd></dl>
  <div class="row-btns" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><a class="btn btn-wa btn-sm" href="${wa}" target="_blank" rel="noopener">Open WhatsApp chat</a><a class="btn btn-ghost btn-sm" href="tel:+91${esc(l.phone)}">Call</a></div></div>
  <div class="card" style="margin-top:12px"><h3>Update</h3>
    <label class="label" for="ls">Status</label><select id="ls">${STATUSES.map((s) => `<option value="${s}"${s === l.status ? ' selected' : ''}>${LABEL[s]}</option>`).join('')}</select>
    <label class="label" for="lm">Mechanic</label><select id="lm"><option value="">Not assigned</option>${S.mechanics.filter((m) => m.active || m.id === l.mechanic_id).map((m) => `<option value="${m.id}"${m.id === l.mechanic_id ? ' selected' : ''}>${esc(m.name)}${m.active ? '' : ' (inactive)'}</option>`).join('')}</select>
    <label class="label" for="la">Garage or outside partner (if not on your mechanic list)</label><input id="la" value="${esc(l.assigned_to || '')}" maxlength="60">
    <label class="label" for="ln">Notes</label><textarea id="ln" rows="3" maxlength="1000">${esc(l.notes || '')}</textarea>
    <label class="check"><input type="checkbox" id="lai"${l.ai_enabled ? ' checked' : ''}><span>AI assistant replies and automatic reminders for this booking</span></label>
    <button class="btn btn-primary" style="margin-top:14px" type="button" data-act="save">Save changes</button></div>
  <div class="card" style="margin-top:12px"><h3>Payment</h3>${l.payment_link ? `<p class="small">Link sent: <a href="${esc(l.payment_link)}" target="_blank" rel="noopener">${esc(l.payment_link)}</a> (${rupee(l.amount_due)})</p>` : ''}
    <label class="label" for="pa">Amount</label><input id="pa" inputmode="numeric" value="${esc(l.amount_due || S.settings.booking_advance || 199)}">
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px"><button class="btn btn-dark btn-sm" type="button" data-act="payLink">Create & send payment link</button><button class="btn btn-ghost btn-sm" type="button" data-act="markPaid">Mark paid manually</button></div>
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
    const row = { name: $('#mn').value.trim(), phone: $('#mp').value.replace(/\D/g, '').slice(-10), area: $('#ma').value.trim() || null, payout_rate: parseInt($('#mr').value, 10) || 0, active: $('#mc').checked };
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
  async payLink() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10);
    if (!(amount > 0)) return toast('Enter an amount');
    const { data, error } = await sb.functions.invoke('payment-link', { body: { lead_id: l.id, amount } });
    if (error || data?.error) return toast(data?.error || 'Could not create link. Check Razorpay keys.');
    toast(data.whatsapp_sent ? 'Payment link sent on WhatsApp' : 'Link created. Copy it from the booking.'); await loadLeads(); openLead(l.id, true);
  },
  async markPaid() {
    const l = S.leads.find((x) => x.id === S.open), amount = parseInt($('#pa').value, 10);
    if (!(amount > 0)) return toast('Enter the amount received');
    if (!confirm(`Mark ${l.ref} as paid ${rupee(amount)}?`)) return;
    const { error } = await sb.from('leads').update({ status: 'paid', paid_amount: (l.paid_amount || 0) + amount, paid_at: new Date().toISOString() }).eq('id', l.id);
    if (error) return toast(error.message);
    await audit('marked_paid_manually', { ref: l.ref, amount }); toast('Marked paid'); await loadLeads(); openLead(l.id, true);
  },
  async newLead() {
    const name = prompt('Customer name'); if (!name) return;
    const phone = (prompt('Mobile number (10 digits)') || '').replace(/\D/g, '').slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) return toast('Invalid mobile number');
    const { data, error } = await sb.from('leads').insert({ name: name.trim().slice(0, 60), phone, source: 'phone', status: 'contacted', consent_whatsapp: false }).select('id').single();
    if (error) return toast(error.message);
    await audit('lead_created', { phone_last4: phone.slice(-4) }); await loadLeads(); renderList(); openLead(data.id);
  },
  csv() {
    const rows = [['Ref', 'Created', 'Name', 'Phone', 'Source', 'Area', 'Service', 'Estimate', 'Date', 'Slot', 'Status', 'Paid', 'UTM source', 'UTM campaign']].concat(filtered().map((l) => [l.ref, l.created_at, l.name, l.phone, l.source, l.area, svcName(l.service_id), l.est_total, l.preferred_date, l.preferred_slot, LABEL[l.status], l.paid_amount, l.utm?.utm_source, l.utm?.utm_campaign]));
    const csv = rows.map((r) => r.map((c) => { c = String(c ?? ''); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'mechanixpro-bookings-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    audit('exported_csv', { rows: rows.length - 1 });
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
    const pairs = { ai_enabled: $('#st-ai').checked, booking_advance: parseInt($('#st-adv').value, 10), big_bike_surcharge: parseInt($('#st-big').value, 10), quiet_hours: { start: parseInt($('#st-q1').value, 10), end: parseInt($('#st-q2').value, 10) }, business_info: { ...(S.settings.business_info || {}), hours: $('#st-hours').value.trim(), areas: $('#st-areas').value.trim(), warranty: $('#st-war').value.trim() } };
    if (!(pairs.booking_advance >= 1) || !(pairs.big_bike_surcharge >= 0)) return toast('Check the amounts');
    for (const [key, value] of Object.entries(pairs)) { const { error } = await sb.from('settings').update({ value }).eq('key', key); if (error) return toast(isOwner() ? error.message : 'Only the owner can change settings'); }
    await audit('settings_updated', { keys: Object.keys(pairs) }); await loadSettings(); toast('Settings saved');
  },
};

function prices() {
  return `<h1 style="font-size:34px">Prices</h1><p class="muted">Changes go live on the website and in AI replies immediately.${isOwner() ? '' : ' Only the owner can edit.'}</p>
  <div class="card tbl"><table class="ptable"><thead><tr><th>Item</th><th>Type</th><th>Price ₹</th><th>Live</th><th></th></tr></thead><tbody>${S.services.map((s) => `<tr><td><input data-k="name" value="${esc(s.name)}" aria-label="Name"${isOwner() ? '' : ' disabled'}></td><td>${s.kind === 'service' ? 'Service' : 'Add-on'}</td><td><input data-k="price" inputmode="numeric" value="${s.price}" style="width:100px" aria-label="Price"${isOwner() ? '' : ' disabled'}></td><td><input type="checkbox" data-k="active"${s.active ? ' checked' : ''} aria-label="Live"${isOwner() ? '' : ' disabled'}></td><td>${isOwner() ? `<button class="btn btn-ghost btn-sm" type="button" data-act="savePrice" data-id="${esc(s.id)}">Save</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
function settings() {
  const st = S.settings, bi = st.business_info || {}, q = st.quiet_hours || { start: 21, end: 9 }, dis = isOwner() ? '' : ' disabled';
  return `<h1 style="font-size:34px">Settings</h1><div class="split2"><div class="card"><h3>WhatsApp automation</h3>
  <label class="check"><input type="checkbox" id="st-ai"${st.ai_enabled !== false ? ' checked' : ''}${dis}><span><b>AI replies and reminders on</b><br><span class="tiny muted">Turn off to answer every chat yourself.</span></span></label>
  <label class="label" for="st-adv">Booking advance (₹)</label><input id="st-adv" inputmode="numeric" value="${esc(st.booking_advance ?? 199)}"${dis}>
  <label class="label" for="st-big">Above-180cc surcharge (₹)</label><input id="st-big" inputmode="numeric" value="${esc(st.big_bike_surcharge ?? 300)}"${dis}>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px"><div><label class="label" for="st-q1">No messages after (hour)</label><input id="st-q1" type="number" min="0" max="23" value="${q.start}"${dis}></div><div><label class="label" for="st-q2">Resume at (hour)</label><input id="st-q2" type="number" min="0" max="23" value="${q.end}"${dis}></div></div></div>
  <div class="card"><h3>What the AI tells customers</h3><label class="label" for="st-hours">Hours</label><input id="st-hours" value="${esc(bi.hours || '')}"${dis}><label class="label" for="st-areas">Areas served</label><textarea id="st-areas" rows="3"${dis}>${esc(bi.areas || '')}</textarea><label class="label" for="st-war">Warranty</label><input id="st-war" value="${esc(bi.warranty || '')}"${dis}></div></div>
  ${isOwner() ? '<button class="btn btn-primary" style="margin-top:16px" type="button" data-act="saveSettings">Save settings</button>' : '<p class="muted">Only the owner can change settings.</p>'}`;
}
function activity() { return '<h1 style="font-size:34px">Activity</h1><p class="muted">Every admin action, newest first.</p><div class="list" id="act"><p class="muted" style="padding:16px">Loading…</p></div>'; }
async function loadActivity() {
  const { data } = await sb.from('audit_log').select('*').order('created_at', { ascending: false }).limit(100);
  const el = $('#act'); if (!el) return;
  el.innerHTML = (data ?? []).map((a) => `<div class="row" style="cursor:default"><span class="meta">${when(a.created_at)}</span><span>${esc(a.action.replace(/_/g, ' '))}<br><span class="meta">${esc(JSON.stringify(a.details))}</span></span><span class="meta">${a.actor ? (a.actor === S.me.user_id ? 'You' : 'Team') : 'System'}</span></div>`).join('') || '<p class="muted" style="padding:16px">No activity yet.</p>';
}

sb.auth.getSession().then(({ data }) => { if (data.session) boot(); });
