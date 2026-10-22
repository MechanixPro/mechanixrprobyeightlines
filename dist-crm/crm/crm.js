// Mechanix Desk for Care Buddies. The shell: sign in, navigation by permission, "My day" and the lead sheet.
// Every other screen lives in ./pages/. Every read and write goes through database functions that check the person's permissions.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { OPEN, BOOKED, STATUS_LABEL, LOST_REASONS, SOURCE_LABEL, KIND_LABEL, sourceName, nextStatuses, validateLog, followUpPresets, localInputValue, telUrl, waUrl, firstMessage, ago, timerInfo, targetPercent } from './crm-rules.js';
import { setClient, rpc, $, $$, esc, rupee, when, toast, clean, debounce, modal, field } from './ui.js';
import * as dashboard from './pages/dashboard.js';
import * as leads from './pages/leads.js';
import * as rsa from './pages/rsa.js';
import * as tickets from './pages/tickets.js';
import * as visits from './pages/visits.js';
import * as garages from './pages/garages.js';
import * as mechanics from './pages/mechanics.js';
import * as knowledge from './pages/knowledge.js';
import * as team from './pages/team.js';
import { newBooking, editBooking } from './pages/booking.js';

const C = window.MXP || {};
if (!C.supabaseUrl || !C.supabaseAnonKey) {
  $('#login').innerHTML = '<h1>Desk not connected yet</h1><p class="muted">The Supabase settings are missing from /assets/js/config.js.</p>';
  throw new Error('Supabase not configured');
}
const sb = createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
setClient(sb);

const MASK = /[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4,7}/g;
const mask = (t) => esc(String(t ?? '').replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, '••••••••••').replace(MASK, '•••• •••• ••••'));

/* ---------- screens, in menu order. "page" is the permission that opens each one. ---------- */
const SCREENS = [
  { id: 'dashboard', title: 'Dashboard', page: 'dashboard', mod: dashboard },
  { id: 'mine', title: 'My day', page: 'leads' },
  { id: 'unassigned', title: 'Unassigned', page: 'leads', action: 'take_leads' },
  { id: 'leads', title: 'Leads', page: 'leads', mod: leads },
  { id: 'rsa', title: 'RSA Cases', page: 'rsa', mod: rsa },
  { id: 'tickets', title: 'Tickets', page: 'tickets', mod: tickets },
  { id: 'visits', title: 'Garage Visits', page: 'garage_visits', mod: visits },
  { id: 'garages', title: 'Garages', page: 'garages', mod: garages },
  { id: 'mechanics', title: 'Mechanics', page: 'mechanics', mod: mechanics },
  { id: 'knowledge', title: 'Knowledge', page: 'knowledge', mod: knowledge },
  { id: 'team', title: 'Team', page: 'team', mod: team },
];

const S = { me: null, view: null, leads: [], q: '', open: null, detail: null, users: null, dispositions: [], counts: { unassigned: 0 }, busy: false, kind: 'note' };
const can = (a) => !!S.me?.permissions?.actions?.[a];
const pageOk = (p) => !!S.me?.permissions?.pages?.[p];
const screens = () => SCREENS.filter((s) => pageOk(s.page) && (!s.action || can(s.action) || can('assign_leads')));

const ctx = {
  get me() { return S.me; }, can, page: pageOk,
  reload: () => go(S.view, true),
  openLead: (id, kind) => openLead(id, kind),
  addLead: () => addDialog(),
  users: async () => (S.users ||= await rpc('crm_users_list').catch(() => [])),
  showPlaybook: (id) => knowledge.showPlaybook(id),
};

/* ---------- sign in (emailed 6-digit code) ---------- */
let codeEmail = '';
$('#sendCode').addEventListener('click', async () => {
  const email = $('#em').value.trim().toLowerCase(); $('#loginErr').textContent = '';
  if (!email) { $('#loginErr').textContent = 'Enter your email first.'; return; }
  $('#sendCode').disabled = true;
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  $('#sendCode').disabled = false;
  if (error) { $('#loginErr').textContent = /rate|seconds|too many/i.test(error.message) ? 'Please wait a minute before asking for another code.' : 'Could not send a code. Check the email your supervisor added.'; return; }
  codeEmail = email; $('#codeBox').hidden = false; $('#sendCode').textContent = 'Send a new code'; $('#code').focus();
  $('#loginInfo').textContent = 'We sent a 6-digit code to ' + email + '. It works for 10 minutes.';
});
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const token = $('#code').value.replace(/\D/g, ''); $('#loginErr').textContent = '';
  if (token.length < 6) { $('#loginErr').textContent = 'Enter the 6-digit code.'; return; }
  const { error } = await sb.auth.verifyOtp({ email: codeEmail || $('#em').value.trim().toLowerCase(), token, type: 'email' });
  if (error) { $('#loginErr').textContent = 'That code is wrong or has expired. Ask for a new one.'; return; }
  boot();
});
$('#signOut').addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });

async function boot() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  try { S.me = await rpc('crm_me'); } catch (e) {
    $('#loginErr').textContent = 'This account is not on the team. Ask your supervisor to add you.'; await sb.auth.signOut(); return;
  }
  $('#login').hidden = true; $('#app').hidden = false;
  $('#who').textContent = S.me.name + ' · Care Buddy' + (S.me.role === 'supervisor' ? ' (supervisor)' : '');
  renderTabs();
  rpc('crm_dispositions_list').then((d) => { S.dispositions = d; }).catch(() => {});
  const list = screens();
  if (!list.length) { $('#view').innerHTML = '<p class="alert pad">Your login has no pages yet. Ask your supervisor to turn some on.</p>'; return; }
  const start = location.hash.slice(1);
  await go(list.find((s) => s.id === start)?.id || (pageOk('leads') ? 'mine' : list[0].id));
  setInterval(refresh, 60e3);
}
async function refresh() {
  if (S.busy || document.hidden || !S.me || !$('#sheet').hidden || $('.modal-back')) return;
  if (['mine', 'unassigned'].includes(S.view)) { try { S.me = await rpc('crm_me'); await loadList(); renderHeader(); renderBody(); } catch (e) { /* try again next minute */ } }
}

function renderTabs() {
  $('#tabs').innerHTML = screens().map((s) => `<button type="button" data-view="${s.id}" aria-current="false">${esc(s.title)}${s.id === 'unassigned' ? ' <span class="badge" id="unBadge" hidden></span>' : ''}</button>`).join('');
  $$('#tabs [data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
}

/* ---------- navigation ---------- */
async function go(view, keepScroll) {
  const sc = screens().find((s) => s.id === view); if (!sc) return;
  const y = keepScroll ? window.scrollY : 0;
  S.view = view; S.open = null; S.busy = true; location.hash = view;
  $$('#tabs [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (!keepScroll) $('#view').innerHTML = '<p class="muted pad">Loading…</p>';
  try {
    S.me = await rpc('crm_me'); renderHeader();
    if (sc.mod) { const root = document.createElement('div'); await sc.mod.render(root, ctx); $('#view').replaceChildren(...root.childNodes); }
    else { await loadList(); renderBody(); }
  } catch (e) { $('#view').innerHTML = '<p class="err pad">' + esc(clean(e)) + '</p>'; }
  S.busy = false; if (y) window.scrollTo(0, y);
}

function renderHeader() {
  const m = S.me; if (!m) return;
  const pct = targetPercent(m.booked_today, m.daily_target);
  $('#goal').innerHTML = `<div class="goal-top"><b>${m.booked_today}</b> of ${m.daily_target} bookings today</div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="goal-sub">${m.pending_advance} waiting for the advance · ${m.contacts_today} contacts made</div>`;
  const b = $('#unBadge'); if (b) { b.textContent = S.counts.unassigned; b.hidden = !S.counts.unassigned; }
}

/* ---------- My day and Unassigned (card view) ---------- */
async function loadList() {
  const view = S.view;
  S.leads = await rpc('crm_queue', { p_view: view, p_search: S.q || null });
  if (view !== 'unassigned') { try { S.counts.unassigned = (await rpc('crm_queue', { p_view: 'unassigned', p_search: null })).length; } catch (e) { /* badge only */ } }
  else S.counts.unassigned = S.leads.length;
  renderHeader();
}
function renderBody() {
  const titles = { mine: 'My day', unassigned: 'Unassigned leads' };
  const hints = { mine: 'Late and overdue leads come first. Every open lead needs a dated next step.', unassigned: 'Take a lead and contact it within ' + S.me.sla_minutes + ' minutes.' };
  const late = S.leads.filter((l) => l.is_late || l.overdue).length;
  $('#view').innerHTML = `<div class="view-head"><div><h1>${titles[S.view]}</h1><p class="muted">${hints[S.view]}</p></div>
    <div class="view-tools"><input id="q" type="search" placeholder="Search name, phone or ref" value="${esc(S.q)}" aria-label="Search leads">${can('create_bookings') ? '<button class="btn primary" type="button" data-act="booking">+ Booking</button>' : ''}${can('add_leads') ? '<button class="btn" type="button" data-act="add">+ Lead</button>' : ''}</div></div>
    ${late ? `<div class="alert" role="status"><b>${late}</b> ${late === 1 ? 'lead needs' : 'leads need'} you right now.</div>` : ''}
    <div class="cards">${S.leads.length ? S.leads.map(card).join('') : `<div class="empty">${S.view === 'mine' ? 'Nothing open. Take a lead from <b>Unassigned</b>, or add one you got by phone.' : 'No unassigned leads right now.'}</div>`}</div>`;
  const q = $('#q'); if (q) q.addEventListener('input', debounce(async () => { S.q = q.value.trim(); await loadList(); renderBody(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350));
}

function card(l) {
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  const src = sourceName(l.utm_source || l.source), camp = l.campaign || '';
  const mine = l.crm_owner && l.crm_owner === S.me.user_id, take = !l.crm_owner && can('take_leads');
  return `<article class="lead-card tone-${t.tone}" data-id="${l.id}">
    <div class="lc-top"><div><h2>${esc(l.name)}</h2><p class="muted small">${esc([l.bike, l.service_name, l.area].filter(Boolean).join(' · ') || 'No details yet')}</p></div><span class="chip st-${l.status}">${STATUS_LABEL[l.status]}</span></div>
    <div class="lc-meta"><span class="chip soft">${esc(src)}${camp ? ' · ' + esc(camp) : ''}</span><span class="small muted">${ago(l.created_at)}</span>${l.crm_owner && !mine ? `<span class="small muted">with ${esc(l.owner_name || 'a colleague')}</span>` : ''}</div>
    <div class="timer t-${t.tone}">${esc(t.label)}</div>
    <div class="lc-actions"><a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${take ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}<button class="btn ghost" type="button" data-act="open" data-id="${l.id}">Open</button></div></article>`;
}

/* ---------- lead sheet ---------- */
async function openLead(id, kind) {
  S.open = id; S.busy = true;
  try { S.detail = await rpc('crm_lead', { p_id: id }); if (can('assign_leads')) S.users = await ctx.users(); } catch (e) { toast(clean(e), true); S.busy = false; return; }
  S.busy = false; S.kind = kind || 'note'; renderSheet();
}
function renderSheet() {
  const d = S.detail, l = d.lead, sheet = $('#sheet');
  const mineOrBoss = l.crm_owner === S.me.user_id || can('assign_leads');
  const canAct = can('edit_leads') && mineOrBoss;
  const moves = nextStatuses(l.status, can('assign_leads') ? 'supervisor' : 'sales');
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  sheet.hidden = false; document.body.classList.add('noscroll');
  $('#sheetPanel').innerHTML = `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(l.name)}</h2><p class="muted small">${esc(l.ref)} · ${esc(SOURCE_LABEL[l.source] || l.source)}${l.campaign ? ' · ' + esc(l.campaign) : ''}</p></div><button class="btn ghost" type="button" data-act="close" aria-label="Close">Close</button></div>
    <div class="timer t-${t.tone}">${esc(t.label)}</div>
    <div class="facts">
      <div><span>Phone</span><b>${esc(l.phone)}</b></div><div><span>Area</span><b>${esc([l.area, l.pincode].filter(Boolean).join(' · ') || '—')}</b></div>
      <div><span>Bike</span><b>${esc(l.bike || '—')}</b></div><div><span>Service</span><b>${esc(l.service_name || '—')}</b></div>
      <div><span>Preferred</span><b>${esc([l.preferred_date, l.preferred_slot].filter(Boolean).join(' · ') || '—')}</b></div><div><span>Quote</span><b>${l.est_total ? rupee(l.est_total) : '—'}${l.coupon_code ? ` <small>(${esc(l.coupon_code)} −${rupee(l.coupon_discount)})</small>` : ''}</b></div>
      <div><span>With</span><b>${esc(l.owner_name || 'Nobody yet')}</b></div><div><span>Stage</span><b>${STATUS_LABEL[l.status]}</b></div>
      ${l.disposition ? `<div><span>Disposition</span><b>${esc(l.disposition)}${l.sub_disposition ? ' · ' + esc(l.sub_disposition) : ''}</b></div>` : ''}${l.address ? `<div class="wide"><span>Address</span><b>${esc(l.address)}</b></div>` : ''}</div>
    ${l.notes ? `<p class="note-box">${mask(l.notes)}</p>` : ''}
    <div class="lc-actions big"><a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${!l.crm_owner && can('take_leads') ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}
      ${can('edit_leads') && mineOrBoss && !l.crm_won_at && l.status !== 'lost' ? '<button class="btn" type="button" data-act="editBooking">Edit booking</button>' : ''}
      ${can('create_tickets') ? '<button class="btn ghost" type="button" data-act="ticket">Raise a ticket</button>' : ''}</div>
    ${!l.crm_owner && !can('assign_leads') ? '<p class="alert">Take this lead first. Then you can log what happened.</p>' : ''}
    ${canAct && l.crm_owner && (moves.length || OPEN.includes(l.status)) ? logForm(l, moves) : (BOOKED.includes(l.status) ? '<p class="alert good">This booking is confirmed.</p>' : '')}
    ${can('assign_leads') ? assignBox(l) : ''}
    <h3>History</h3><ul class="timeline">${d.activities.length ? d.activities.map((a) => `<li><b>${esc(KIND_LABEL[a.kind] || a.kind)}</b> <span class="muted small">${esc(a.actor || 'System')} · ${when(a.created_at)}</span>${a.body ? '<p>' + mask(a.body) + '</p>' : ''}</li>`).join('') : '<li class="muted">Nothing logged yet.</li>'}</ul>
    ${d.messages.length ? `<h3>WhatsApp chat</h3><ul class="chat">${d.messages.map((m) => `<li class="${m.direction === 'in' ? 'in' : 'out'}"><p>${mask(m.body)}</p><span class="small muted">${m.sender === 'ai' ? 'Auto reply' : m.direction === 'in' ? 'Customer' : 'Us'} · ${when(m.created_at)}</span></li>`).join('')}</ul>` : ''}`;
  if (S.kind) { const k = $(`#logForm [name=kind][value=${S.kind}]`); if (k) k.checked = true; }
  syncLogForm();
}
function logForm(l, moves) {
  const def = new Date(Date.now() + 86400e3); def.setHours(10, 0, 0, 0);
  const presets = followUpPresets();
  const disps = [...new Set(S.dispositions.map((x) => x.disposition))];
  return `<form id="logForm" class="log-form" novalidate><h3>What happened?</h3>
    <div class="seg" role="radiogroup" aria-label="Type of contact">${[['call', 'I called'], ['whatsapp', 'I messaged'], ['note', 'Just a note']].map(([v, t]) => `<label><input type="radio" name="kind" value="${v}"><span>${t}</span></label>`).join('')}</div>
    <label class="label" for="body">Note</label><textarea id="body" name="body" rows="3" maxlength="1000" placeholder="What did the customer say? Never write Aadhaar, PAN, bank or card numbers."></textarea>
    ${disps.length ? `<div class="grid2"><div class="fld half"><label class="label" for="disp">Disposition</label><select id="disp" name="disp"><option value="">None</option>${disps.map((x) => `<option${x === l.disposition ? ' selected' : ''}>${esc(x)}</option>`).join('')}</select></div>
      <div class="fld half"><label class="label" for="sub">Sub disposition</label><select id="sub" name="sub"><option value="">None</option></select></div></div>` : ''}
    <label class="label" for="status">Move this lead to</label>
    <select id="status" name="status"><option value="">Stay at ${STATUS_LABEL[l.status]}</option>${moves.map((s) => `<option value="${s}">${s === 'lost' ? 'Lost (give a reason)' : STATUS_LABEL[s]}</option>`).join('')}</select>
    <div id="lostBox" hidden><label class="label" for="lost">Why was it lost?</label><select id="lost" name="lost"><option value="">Choose a reason</option>${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
    <div id="nextBox"><span class="label">Next follow-up (required)</span><div class="presets">${presets.map((p) => `<button class="chip pick" type="button" data-act="preset" data-iso="${localInputValue(p.date)}">${p.label}</button>`).join('')}</div>
      <input id="next" name="next" type="datetime-local" value="${localInputValue(def)}" aria-label="Follow-up date and time"></div>
    <p class="err" id="logErr" role="alert"></p><button class="btn primary wide" type="submit" id="logSave">Save</button></form>`;
}
function syncSub() {
  const d = $('#disp'), s = $('#sub'); if (!d || !s) return;
  const cur = S.detail.lead.sub_disposition;
  s.innerHTML = '<option value="">None</option>' + S.dispositions.filter((x) => x.disposition === d.value).map((x) => `<option${x.sub === cur ? ' selected' : ''}>${esc(x.sub)}</option>`).join('');
}
function syncLogForm() {
  const f = $('#logForm'); if (!f) return;
  syncSub();
  const status = f.status.value, kind = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  const to = status || S.detail.lead.status;
  $('#lostBox').hidden = status !== 'lost';
  $('#nextBox').hidden = !(OPEN.includes(to) && !(kind === 'note' && !status));
}
async function saveLog() {
  const f = $('#logForm');
  const kindRaw = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  const v = { kind: kindRaw, body: f.body.value, status: f.status.value, lostReason: f.lost.value, nextAction: f.next.value ? new Date(f.next.value).toISOString() : '', current: S.detail.lead.status };
  const kind = v.kind === 'note' && v.status ? 'status' : v.kind;
  const check = validateLog({ ...v, kind, nextAction: $('#nextBox').hidden ? '' : v.nextAction });
  if (!check.ok) { $('#logErr').textContent = check.error; return; }
  if (f.sub && f.sub.value && !f.disp.value) { $('#logErr').textContent = 'Choose the disposition for that sub disposition.'; return; }
  $('#logErr').textContent = ''; $('#logSave').disabled = true;
  try {
    await rpc('crm_log', { p_id: S.open, p_kind: kind, p_body: v.body.trim() || null, p_next_action: $('#nextBox').hidden ? null : v.nextAction, p_status: v.status || null, p_lost_reason: v.status === 'lost' ? v.lostReason : null,
      p_disposition: f.disp && f.disp.value ? f.disp.value : null, p_sub_disposition: f.sub && f.sub.value ? f.sub.value : null });
    toast(v.status === 'lost' ? 'Saved. Lead closed as lost.' : 'Saved.');
    await afterChange(true);
  } catch (e) { $('#logErr').textContent = clean(e); $('#logSave').disabled = false; }
}
function assignBox(l) {
  return `<div class="assign"><h3>Assign</h3><div class="row"><select id="assignTo" aria-label="Assign to"><option value="">Unassigned queue</option>${(S.users || []).filter((u) => u.active).map((u) => `<option value="${u.user_id}" ${u.user_id === l.crm_owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
    <button class="btn ghost" type="button" data-act="assign">Save assignment</button></div></div>`;
}
async function afterChange(close) {
  S.me = await rpc('crm_me'); renderHeader();
  if (close) closeSheet();
  await go(S.view, true);
  if (!close && S.open) { S.detail = await rpc('crm_lead', { p_id: S.open }); renderSheet(); }
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('noscroll'); S.open = null; }

/* ---------- add a lead by hand ---------- */
function addDialog() {
  modal({ title: 'Add a lead', intro: 'For phone calls, walk-ins and Meta (Instagram) messages. Website, Google Ads and WhatsApp leads arrive on their own. To book straight away, use + Booking.',
    body: `${field('Customer name', 'name', { required: true })}${field('Mobile number', 'phone', { type: 'tel', inputmode: 'tel', required: true, placeholder: '10 digits' })}${field('Area', 'area')}
      ${field('Where did it come from?', 'src', { type: 'select', blank: false, options: [['instagram', 'Meta (Instagram) message'], ['phone', 'Phone call'], ['walk_in', 'Walk in'], ['whatsapp', 'WhatsApp']] })}${field('Note', 'note', { type: 'textarea', rows: 2 })}`,
    submit: 'Add lead', onSubmit: async (f, d, close) => {
      const r = await rpc('crm_add_lead', { p_name: d.name, p_phone: d.phone, p_area: d.area, p_source: d.src, p_note: d.note });
      close(); toast(r.duplicate ? 'This customer already has an open lead. Opening it.' : 'Lead added.'); await go(S.view, true); await openLead(r.id);
    } });
}

/* ---------- clicks ---------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'open') return await openLead(id);
    if (act === 'call' || act === 'wa') { await openLead(id, act === 'call' ? 'call' : 'whatsapp'); return; }
    if (act === 'take') { e.preventDefault(); await rpc('crm_claim', { p_id: id }); toast('It is yours. Contact the customer now.'); await go(S.view, true); return await openLead(id); }
    if (act === 'close') return closeSheet();
    if (act === 'add') return addDialog();
    if (act === 'booking') return newBooking(ctx);
    if (act === 'editBooking') return editBooking(ctx, S.detail.lead);
    if (act === 'ticket') { const l = S.detail.lead; const { newTicket } = tickets; return newTicket(ctx, { lead: l.id, title: 'Issue with ' + l.name + ' (' + l.ref + ')' }); }
    if (act === 'preset') { $('#next').value = b.dataset.iso; return; }
    if (act === 'assign') { await rpc('crm_assign', { p_id: S.open, p_user: $('#assignTo').value || null }); toast('Assignment saved.'); return await afterChange(false); }
  } catch (err) { toast(clean(err), true); }
});
document.addEventListener('change', (e) => { if (e.target.matches('#status, [name=kind], #disp')) syncLogForm(); });
document.addEventListener('submit', (e) => { if (e.target.id === 'logForm') { e.preventDefault(); saveLog(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.modal-back') && !$('#sheet').hidden) closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
setInterval(() => { if (S.me && !document.hidden && ['mine', 'unassigned'].includes(S.view) && $('#sheet').hidden && !$('.modal-back') && document.activeElement?.id !== 'q') renderBody(); }, 30e3);

boot();
