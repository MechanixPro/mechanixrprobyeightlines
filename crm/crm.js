// Mechanix Desk for Care Buddies. The shell: sign in, navigation by permission, "My day" and the lead sheet.
// Every other screen lives in ./pages/. Every read and write goes through database functions that check the person's permissions.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { nextAction, stepGuard, lostReasonCheck, callQueue, vehicleOf, VEHICLE_LABEL, canSetVehicle, bookingLabel, idOr, canConfirmBooking, canMarkJunk, canRestoreJunk, hasPii, OPEN, BOOKED, STATUS_LABEL, LOST_REASONS, SOURCE_LABEL, KIND_LABEL, sourceName, nextStatuses, validateLog, followUpPresets, localInputValue, telUrl, waUrl, firstMessage, ago, timerInfo, targetPercent, parseContacts, techJobMessage, unstaffedSoon, rankTechs, moveCheck, handoverStatus, canSendHandoverCode, handoverMessage, HANDOVER_KIND_LABEL } from './crm-rules.js';
import { vehicleTag, stepper, setClient, rpc, $, $$, esc, rupee, when, toast, clean, debounce, modal, field, confirmBox, SLOTS } from './ui.js';
import * as dashboard from './pages/dashboard.js';
import * as leads from './pages/leads.js';
import * as webleads from './pages/webleads.js';
import * as rsa from './pages/rsa.js';
import * as tickets from './pages/tickets.js';
import * as visits from './pages/visits.js';
import * as garages from './pages/garages.js';
import * as mechanics from './pages/mechanics.js';
import * as knowledge from './pages/knowledge.js';
import * as team from './pages/team.js';
import * as inbox from './pages/inbox.js';
import * as callnow from './pages/callnow.js';
import { newBooking, editBooking } from './pages/booking.js';
import { sendPaymentLink } from './pages/payment.js';
import { findByPin } from './pages/pinsearch.js';

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
  { id: 'inbox', title: 'Inbox', page: 'inbox', mod: inbox },
  { id: 'callnow', title: 'Call now', page: 'leads', mod: callnow },
  { id: 'mine', title: 'My day', page: 'leads' },
  { id: 'unassigned', title: 'Unassigned', page: 'leads', action: 'take_leads' },
  { id: 'leads', title: 'Leads', page: 'leads', mod: leads },
  { id: 'web', title: 'Web leads', page: 'leads', mod: webleads },
  { id: 'rsa', title: 'RSA Cases', page: 'rsa', mod: rsa },
  { id: 'tickets', title: 'Tickets', page: 'tickets', mod: tickets },
  { id: 'visits', title: 'Garage Visits', page: 'garage_visits', mod: visits },
  { id: 'garages', title: 'Garages', page: 'garages', mod: garages },
  { id: 'mechanics', title: 'Mechanics', page: 'mechanics', mod: mechanics },
  { id: 'knowledge', title: 'Knowledge', page: 'knowledge', mod: knowledge },
  { id: 'team', title: 'Team', page: 'team', mod: team },
];

const S = { waiting: [], me: null, view: null, leads: [], q: '', open: null, detail: null, users: null, dispositions: [], counts: { unassigned: 0, call: 0 }, unstaffed: [], board: null, busy: false, kind: 'note' };
const can = (a) => !!S.me?.permissions?.actions?.[a];
const pageOk = (p) => !!S.me?.permissions?.pages?.[p];
// Technician work (board, picker, unstaffed alert, any booking's technician): supervisors with assign_leads, or the Technician lead with manage_technicians.
const canTech = () => can('assign_leads') || can('manage_technicians');
const screens = () => SCREENS.filter((s) => pageOk(s.page) && (!s.action || can(s.action) || can('assign_leads')));

const ctx = {
  get me() { return S.me; }, can, page: pageOk,
  reload: () => { S.users = null; return go(S.view, true); },
  go: (view) => go(view),
  openLead: (id, kind) => openLead(id, kind),
  addLead: () => addDialog(),
  users: async () => { if (!S.users || Date.now() - (S.usersAt || 0) > 20000) { try { S.users = await rpc('crm_users_list'); S.usersAt = Date.now(); } catch (e) { S.users ||= []; } } return S.users; },
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
  if (error) { $('#loginErr').textContent = /rate|seconds|too many/i.test(error.message) ? 'Please wait a minute before asking for another code.' : 'Could not send a code. Check the email your supervisor added. Admins: use your password below.'; return; }
  codeEmail = email; $('#codeBox').hidden = false; $('#sendCode').textContent = 'Send a new code'; $('#code').focus();
  $('#loginInfo').textContent = 'We sent a 6-digit code to ' + email + '. It works for 10 minutes.';
});
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  // Admins and anyone who set a password sign in with it; Care Buddies use the emailed code.
  const pw = $('#pw') ? $('#pw').value : '';
  if (pw) {
    const { error: pe } = await sb.auth.signInWithPassword({ email: $('#em').value.trim().toLowerCase(), password: pw });
    if (pe) { $('#loginErr').textContent = 'Wrong email or password.'; return; }
    boot(); return;
  }
  const token = $('#code').value.replace(/\D/g, '');
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
  renderTabs(); loadWaiting();
  rpc('crm_dispositions_list').then((d) => { S.dispositions = d; }).catch(() => {});
  const list = screens();
  if (!list.length) { $('#view').innerHTML = '<p class="alert pad">Your login has no pages yet. Ask your supervisor to turn some on.</p>'; return; }
  const start = location.hash.slice(1);
  await go(list.find((s) => s.id === start)?.id || (pageOk('leads') ? 'mine' : list[0].id));
  setInterval(refresh, 45e3); // light on the database: the alert loop below already watches for new leads and replies
  startAlerts();
}
/* ---------- fast alerts: a new lead or a customer reply makes a sound, a pop-up, a vibration and a number in the tab title ---------- */
let audioCtx = null, titleBase = document.title; const seen = { leads: null, replies: null, due: null, unstaffed: null };
function beep() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime, o = audioCtx.createOscillator(), g = audioCtx.createGain(); o.type = 'sine'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    o.connect(g); g.connect(audioCtx.destination); o.start(t); o.stop(t + 0.6);
  } catch (e) { /* no sound on this device */ }
}
function alertUser(title, body) {
  beep(); try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
  toast(title + (body ? ': ' + body : ''));
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'mxp-desk' }); } catch (e) { /* ignore */ }
}
async function pulse() {
  if (!S.me) return;
  let unassigned = null, replies = null, mine = null;
  if (pageOk('leads')) { try { S.counts.call = callQueue(await rpc('crm_call_queue')).length; const cb = $('#cqBadge'); if (cb) { cb.textContent = S.counts.call; cb.hidden = !S.counts.call; } } catch (e) { /* next time */ } }
  if (pageOk('leads')) { try { unassigned = await rpc('crm_queue', { p_view: 'unassigned', p_search: null }); } catch (e) { /* next time */ } }
  if (pageOk('leads')) { try { mine = await rpc('crm_queue', { p_view: 'mine', p_search: null }); } catch (e) { /* next time */ } }
  if (pageOk('inbox')) { try { replies = await rpc('crm_replies_waiting'); } catch (e) { /* next time */ } }
  if (unassigned) {
    const ids = new Set(unassigned.map((l) => l.id)); S.counts.unassigned = unassigned.length;
    if (seen.leads) { const fresh = unassigned.filter((l) => !seen.leads.has(l.id)); if (fresh.length) alertUser(fresh.length === 1 ? 'New lead' : fresh.length + ' new leads', fresh.slice(0, 2).map((l) => l.name).join(', ')); }
    seen.leads = ids; renderHeader();
  }
  if (replies) {
    const key = (r) => r.id + '|' + r.wrote_at, ids = new Set(replies.map(key)); S.waiting = replies;
    if (seen.replies) { const fresh = replies.filter((r) => !seen.replies.has(key(r))); if (fresh.length) alertUser('Customer replied', fresh.slice(0, 2).map((r) => r.name).join(', ')); }
    seen.replies = ids; const b = $('#inBadge'); if (b) { b.textContent = replies.length; b.hidden = !replies.length; }
  }
  let dueNow = 0;
  if (mine) {
    // A follow-up the agent set has come due: sound and pop-up once for each follow-up time, and it counts in the tab title until it is done.
    const due = mine.filter((l) => l.overdue && l.crm_next_action_at), key = (l) => l.id + '|' + l.crm_next_action_at; dueNow = due.length;
    if (seen.due) { const fresh = due.filter((l) => !seen.due.has(key(l))); if (fresh.length) alertUser(fresh.length === 1 ? 'Follow-up due' : fresh.length + ' follow-ups due', fresh.slice(0, 2).map((l) => l.name).join(', ')); }
    seen.due = new Set(due.map(key));
  }
  // A booked job still has no technician close to its slot: sound and pop-up once per job, for people who can assign.
  if (canTech()) {
    try {
      S.unstaffed = unstaffedSoon(await rpc('crm_unstaffed_jobs'));
      if (seen.unstaffed) { const fresh = S.unstaffed.filter((j) => !seen.unstaffed.has(j.id)); if (fresh.length) alertUser(fresh.length === 1 ? 'Job has no technician' : fresh.length + ' jobs have no technician', fresh.slice(0, 2).map((j) => j.ref + ' ' + j.name).join(', ')); }
      seen.unstaffed = new Set(S.unstaffed.map((j) => j.id));
    } catch (e) { /* next time */ }
  }
  const n = (unassigned ? unassigned.length : 0) + (replies ? replies.length : 0) + dueNow + S.unstaffed.length; document.title = (n ? '(' + n + ') ' : '') + titleBase;
}
function startAlerts() {
  const who = $('#who');
  if (who && 'Notification' in window && Notification.permission === 'default' && !$('#alertBtn')) {
    who.insertAdjacentHTML('afterend', ' <button class="btn ghost sm" type="button" id="alertBtn">Turn on alerts</button>');
    $('#alertBtn').addEventListener('click', async () => { try { await Notification.requestPermission(); } catch (e) { /* ignore */ } beep(); $('#alertBtn').remove(); });
  }
  document.addEventListener('click', () => { try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) { /* ignore */ } }, { once: true });
  pulse(); let t = null; const loop = () => { clearTimeout(t); t = setTimeout(async () => { await pulse(); loop(); }, document.hidden ? 120e3 : 20e3); }; loop();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pulse(); });
}
async function refresh() {
  if (S.busy || document.hidden || !S.me || !$('#sheet').hidden || $('.modal-back')) return;
  loadWaiting();
  if (['mine', 'unassigned'].includes(S.view)) { try { S.me = await rpc('crm_me'); await loadList(); renderHeader(); renderBody(); } catch (e) { /* try again next minute */ } }
  else if (['inbox', 'callnow'].includes(S.view)) { try { await go(S.view, true); } catch (e) { /* try again next minute */ } }
}

function renderTabs() {
  $('#tabs').innerHTML = screens().map((s) => `<button type="button" data-view="${s.id}" aria-current="false">${esc(s.title)}${s.id === 'unassigned' ? ' <span class="badge" id="unBadge" hidden></span>' : ''}${s.id === 'inbox' ? ' <span class="badge" id="inBadge" hidden></span>' : ''}${s.id === 'callnow' ? ' <span class="badge" id="cqBadge" hidden></span>' : ''}</button>`).join('');
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
    S.me = await rpc('crm_me'); renderHeader(); loadWaiting();
    if (sc.mod) { const root = document.createElement('div'); root.style.display = 'contents'; await sc.mod.render(root, ctx); $('#view').replaceChildren(root); }  // root stays in the page, so a page can look things up in it when a button is pressed later
    else { await loadList(); renderBody(); }
  } catch (e) { $('#view').innerHTML = '<p class="err pad">' + esc(clean(e)) + '</p>'; }
  S.busy = false; if (y) window.scrollTo(0, y);
}

async function loadWaiting() {
  if (!pageOk('inbox')) return;
  try { S.waiting = await rpc('crm_replies_waiting'); } catch (e) { S.waiting = S.waiting || []; }
  const b = $('#inBadge'); if (b) { b.textContent = S.waiting.length; b.hidden = !S.waiting.length; }
}
function renderHeader() {
  const m = S.me; if (!m) return;
  const pct = targetPercent(m.booked_today, m.daily_target);
  $('#goal').innerHTML = `<div class="goal-top"><b>${m.booked_today}</b> of ${m.daily_target} bookings today</div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="goal-sub">${m.pending_advance} waiting for the advance · ${m.contacts_today} contacts made</div>`;
  const b = $('#unBadge'); if (b) { b.textContent = S.counts.unassigned; b.hidden = !S.counts.unassigned; }
  const cb = $('#cqBadge'); if (cb) { cb.textContent = S.counts.call; cb.hidden = !S.counts.call; }
}

/* ---------- My day and Unassigned (card view) ---------- */
async function loadList() {
  const view = S.view;
  S.leads = await rpc('crm_queue', { p_view: view, p_search: S.q || null });
  // People who assign technicians see today's board on My day.
  S.board = null; if (view === 'mine' && canTech()) { try { S.board = await rpc('crm_tech_board', { p_date: null }); } catch (e) { S.board = null; } }
  if (view !== 'unassigned') { try { S.counts.unassigned = (await rpc('crm_queue', { p_view: 'unassigned', p_search: null })).length; } catch (e) { /* badge only */ } }
  else S.counts.unassigned = S.leads.length;
  renderHeader();
}
function renderBody() {
  const titles = { mine: 'My day', unassigned: 'Unassigned leads' };
  const hints = { mine: 'Late and overdue leads come first. Every open lead needs a dated next step.', unassigned: 'Take a lead and contact it within ' + S.me.sla_minutes + ' minutes.' };
  const late = S.leads.filter((l) => l.is_late || l.overdue).length;
  $('#view').innerHTML = `<div class="view-head"><div><h1>${titles[S.view]}</h1><p class="muted">${hints[S.view]}</p></div>
    <div class="view-tools"><input id="q" type="search" placeholder="Search name, phone or booking ID" value="${esc(S.q)}" aria-label="Search leads">${can('create_bookings') ? '<button class="btn primary" type="button" data-act="booking">+ Booking</button>' : ''}${can('add_leads') ? '<button class="btn" type="button" data-act="add">+ Lead</button>' : ''}${can('add_leads') ? '<button class="btn ghost" type="button" data-act="import">Import from AiSensy</button>' : ''}${canTech() ? '<button class="btn ghost" type="button" data-act="pinSearch">Find by PIN</button>' : ''}</div></div>
    ${S.waiting.length && pageOk('inbox') ? `<div class="alert" role="status"><b>${S.waiting.length}</b> ${S.waiting.length === 1 ? 'customer wrote' : 'customers wrote'} on WhatsApp and ${S.waiting.length === 1 ? 'is' : 'are'} waiting. <button class="btn sm" type="button" data-act="gotoInbox">Open the Inbox</button></div>` : ''}
    ${S.unstaffed.length ? `<div class="alert" role="status"><b>${S.unstaffed.length}</b> booked ${S.unstaffed.length === 1 ? 'job has' : 'jobs have'} no technician yet: ${S.unstaffed.slice(0, 4).map((j) => `<button class="btn sm" type="button" data-act="open" data-id="${j.id}">${esc(idOr(j, 'Job'))} ${esc(j.name)}</button>`).join(' ')}</div>` : ''}
    ${late ? `<div class="alert" role="status"><b>${late}</b> ${late === 1 ? 'lead needs' : 'leads need'} you right now.</div>` : ''}
    ${S.board ? techBoard(S.board) : ''}
    <div class="cards">${S.leads.length ? S.leads.map(card).join('') : `<div class="empty">${S.view === 'mine' ? 'Nothing open. Take a lead from <b>Unassigned</b>, or add one you got by phone.' : 'No unassigned leads right now.'}</div>`}</div>`;
  const q = $('#q'); if (q) q.addEventListener('input', debounce(async () => { S.q = q.value.trim(); await loadList(); renderBody(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350));
}

const SLOT_SHORT = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', asap: 'ASAP' };
function techBoard(b) {
  const job = (j) => `<button class="chip pick" type="button" data-act="open" data-id="${j.id}">${esc(j.booking_id || j.name)} · ${esc(SLOT_SHORT[j.slot] || 'No slot')}${j.area ? ' · ' + esc(j.area) : ''}${j.status === 'completed' ? ' · done' : ''}</button>`;
  const busy = b.techs.filter((t) => t.jobs.length).length;
  return `<details class="board" open><summary><b>Technicians today</b> <span class="small muted">${busy} of ${b.techs.length} have jobs${b.unassigned.length ? ` · <span class="badtxt">${b.unassigned.length} booked with no technician</span>` : ''}</span></summary>
    <div class="table-wrap"><table><tbody>${b.unassigned.length ? `<tr><td class="badtxt"><b>No technician</b></td><td>${b.unassigned.map(job).join(' ')}</td></tr>` : ''}
    ${b.techs.map((t) => `<tr><td><b>${esc(t.name)}</b><br><small class="muted">${esc(t.area || '')}</small></td><td>${t.jobs.length ? t.jobs.map(job).join(' ') : '<span class="muted small">Free all day</span>'}</td></tr>`).join('')}</tbody></table></div></details>`;
}

/* ---------- booking steps: the step bar and the one next-action button ---------- */
const roleOf = () => (S.me.is_admin ? 'admin' : can('assign_leads') ? 'supervisor' : 'agent');
const meRules = () => ({ canCreate: can('create_bookings'), userId: S.me.user_id, boss: canTech() });
/** The single button for the lead's next step. Call now is a phone link; the others run through runStep. A step the person cannot take shows why. */
function nextBtn(l) {
  const a = nextAction(l, roleOf(), meRules()); if (!a) return '';
  const btn = a.key === 'call' ? `<a class="btn primary call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">${a.label}</a>`
    : `<button class="btn primary" type="button" data-act="step" data-key="${a.key}" data-id="${l.id}"${a.allowed ? '' : ' aria-disabled="true"'}>${a.label}</button>`;
  return `<div class="next-step">${btn}${a.allowed ? '' : `<p class="why" role="note">${esc(a.reason)}</p>`}</div>`;
}
async function runStep(key, id) {
  const l = S.detail && S.detail.lead && S.detail.lead.id === id ? S.detail.lead : S.leads.find((x) => x.id === id); if (!l) return;
  const a = nextAction(l, roleOf(), meRules());
  if (!a || a.key !== key) return toast('That is no longer the next step. Reload the page.', true);
  if (!a.allowed) return toast(a.reason, true);
  const g = stepGuard(l, key === 'take' ? 'call' : key); if (!g.ok) return toast(g.error, true);
  if (key === 'take') { await rpc('crm_claim', { p_id: id }); toast('It is yours. Call the customer now.'); await go(S.view, true); return await openLead(id, 'call'); }
  if (key === 'confirm') { S.open = id; return await confirmBooking(); }
  if (key === 'done') { await rpc('crm_mark_done', { p_id: id }); toast('Marked done.'); S.open = id; return await afterChange(false); }
  // Send quote and Schedule need details (a follow-up, a technician and a slot), so they open the lead with the form already set.
  await openLead(id, 'note');
  const st = $('#status'); if (!st) return toast('Take the lead first, then log the quote.', true);
  st.value = key === 'quote' ? 'quoted' : 'confirm'; syncLogForm();
  toast(key === 'quote' ? 'Pick the follow-up time and save to mark the quote as sent.' : 'Choose the technician, date and slot, then save.');
  st.scrollIntoView({ block: 'center' });
}

function card(l) {
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  const src = sourceName(l.utm_source || l.source), camp = l.campaign || '';
  const mine = l.crm_owner && l.crm_owner === S.me.user_id, take = !l.crm_owner && can('take_leads');
  return `<article class="lead-card tone-${t.tone}" data-id="${l.id}">
    <div class="lc-top"><div><h2>${esc(l.name)}${vehicleTag(vehicleOf(l))}</h2><p class="muted small">${esc([l.bike, l.service_name, l.area].filter(Boolean).join(' · ') || 'No details yet')}</p></div><span class="chip st-${l.status}">${STATUS_LABEL[l.status]}</span></div>
    <div class="lc-meta"><span class="chip soft">${esc(src)}${camp ? ' · ' + esc(camp) : ''}</span><span class="small muted">${ago(l.created_at)}</span>${l.crm_owner && !mine ? `<span class="small muted">with ${esc(l.owner_name || 'a colleague')}</span>` : ''}</div>
    ${stepper(l)}<div class="timer t-${t.tone}">${esc(t.label)}</div>${S.waiting.some((w) => w.id === l.id) ? '<div class="timer t-late">Customer replied on WhatsApp. Answer now</div>' : ''}
    ${nextBtn(l)}
    <div class="lc-actions"><a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${take ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}<button class="btn ghost" type="button" data-act="open" data-id="${l.id}">Open</button></div></article>`;
}

/* ---------- lead sheet ---------- */
const rupee2 = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n) || 0) ? 0 : 2, maximumFractionDigits: 2 });
async function openLead(id, kind) {
  S.open = id; S.busy = true;
  try { S.detail = await rpc('crm_lead', { p_id: id }); S.rating = await rpc('crm_lead_rating', { p_lead: id }).catch(() => null); S.money = await rpc('crm_lead_money', { p_lead: id }).catch(() => null); S.handover = await rpc('crm_handovers', { p_lead: id }).catch(() => null); if (can('assign_leads')) S.users = await ctx.users(); } catch (e) { toast(clean(e), true); S.busy = false; return; }
  S.busy = false; S.kind = kind || 'note'; renderSheet();
}
function renderSheet() {
  const d = S.detail, l = d.lead, sheet = $('#sheet');
  const mineOrBoss = l.crm_owner === S.me.user_id || canTech();
  const canAct = can('edit_leads') && mineOrBoss;
  const moves = nextStatuses(l.status, can('assign_leads') ? 'supervisor' : 'sales');
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  sheet.hidden = false; document.body.classList.add('noscroll');
  $('#sheetPanel').innerHTML = `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(l.name)}${vehicleTag(vehicleOf(l))}</h2><p class="muted small">${esc(idOr(l))} · ${esc(SOURCE_LABEL[l.source] || l.source)}${l.campaign ? ' · ' + esc(l.campaign) : ''}</p></div><button class="btn ghost" type="button" data-act="close" aria-label="Close">Close</button></div>
    ${stepper(l)}${nextBtn(l)}
    <div class="timer t-${t.tone}">${esc(t.label)}</div>
    <div class="facts">
      <div><span>Phone</span><b>${esc(l.phone)}</b></div><div><span>Area</span><b>${esc([l.area, l.pincode].filter(Boolean).join(' · ') || '—')}</b></div>
      <div><span>Vehicle</span><b>${esc(VEHICLE_LABEL[vehicleOf(l)])}${l.vehicle_source === 'desk' ? ' <small class="muted">set by the desk</small>' : ''}</b></div><div><span>Bike</span><b>${esc(l.bike || '—')}</b></div><div><span>Service</span><b>${esc(l.service_name || '—')}</b></div>
      <div><span>Preferred</span><b>${esc([l.preferred_date, l.preferred_slot].filter(Boolean).join(' · ') || '—')}</b></div><div><span>Quote, excluding GST</span><b>${l.est_total ? rupee(l.est_total) : '—'}${l.coupon_code ? ` <small>(${esc(l.coupon_code)} −${rupee(l.coupon_discount)})</small>` : ''}</b></div>
      ${S.money ? `<div><span>Vehicle number</span><b>${esc(S.money.vehicle_reg || 'Not added yet')}</b></div><div><span>Customer paid</span><b>${rupee2(S.money.paid || 0)}</b></div>${S.money.invoice_total != null ? `<div><span>Invoice total · balance</span><b>${rupee2(S.money.invoice_total)} · ${rupee2(S.money.balance || 0)} left</b></div>` : '<div><span>Invoice</span><b>Made when the job is done, with GST added</b></div>'}` : ''}
      <div><span>Technician</span><b>${l.mechanic_name ? esc(l.mechanic_name) : `<span class="${BOOKED.includes(l.status) && l.status !== 'completed' ? 'badtxt' : 'muted'}">Not assigned</span>`}</b></div>
      <div><span>With</span><b>${esc(l.owner_name || 'Nobody yet')}</b></div><div><span>Stage</span><b>${STATUS_LABEL[l.status]}</b></div>
      ${S.rating && S.rating.rating ? `<div><span>Customer rating</span><b>${'★'.repeat(S.rating.rating)}${'☆'.repeat(5 - S.rating.rating)} ${S.rating.rating}/5${S.rating.comment ? ` <small>“${esc(S.rating.comment)}”</small>` : ''}</b></div>` : S.rating && S.rating.requested_at ? `<div><span>Customer rating</span><b>Asked ${when(S.rating.requested_at)}</b></div>` : ''}
      ${l.disposition ? `<div><span>Disposition</span><b>${esc(l.disposition)}${l.sub_disposition ? ' · ' + esc(l.sub_disposition) : ''}</b></div>` : ''}${l.address ? `<div class="wide"><span>Address</span><b>${esc(l.address)}</b></div>` : ''}</div>
    ${l.notes ? `<p class="note-box">${mask(l.notes)}</p>` : ''}
    ${canSetVehicle(l, { canEdit: can('edit_leads'), mineOrBoss }) ? `<div class="veh-pick"><label for="vehSel" class="small muted">Vehicle</label><select id="vehSel" data-lead="${l.id}" aria-label="Vehicle">${['bike', 'car', 'parts'].map((v) => `<option value="${v}"${v === vehicleOf(l) ? ' selected' : ''}>${VEHICLE_LABEL[v]}</option>`).join('')}</select></div>` : ''}
    <div class="lc-actions big"><a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${!l.crm_owner && can('take_leads') ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}
      ${canConfirmBooking(l, { canCreate: can('create_bookings'), userId: S.me.user_id, boss: canTech() }) ? '<button class="btn primary" type="button" data-act="confirmBooking">Confirm booking</button>' : ''}
      ${can('edit_leads') && mineOrBoss && !l.crm_won_at && !['lost', 'junk'].includes(l.status) ? '<button class="btn" type="button" data-act="editBooking">Edit booking</button>' : ''}
      ${l.mechanic_phone && canAct && l.status !== 'lost' ? `<button class="btn wa" type="button" data-act="sendJob">Send job to ${esc(String(l.mechanic_name || 'technician').split(' ')[0])}</button>` : ''}
      ${can('send_payment_link') && l.crm_owner && !BOOKED.includes(l.status) && !['lost', 'junk'].includes(l.status) ? '<button class="btn" type="button" data-act="payLink">Send payment link</button>' : ''}
      ${can('create_tickets') ? '<button class="btn ghost" type="button" data-act="ticket">Raise a ticket</button>' : ''}
      ${canMarkJunk(l, S.me.is_admin) ? '<button class="btn ghost" type="button" data-act="junkOpen">Mark as junk</button>' : ''}${canRestoreJunk(l, S.me.is_admin) ? '<button class="btn" type="button" data-act="junkRestore">Restore</button>' : ''}</div>
    ${l.status === 'junk' ? `<p class="alert">Junk${l.junk_reason ? ': ' + esc(l.junk_reason) : ''}. It is kept as data and left out of follow-ups, reminders and totals.</p>` : ''}
    ${handoverCard(l, canAct)}
    ${!l.crm_owner && !can('assign_leads') ? '<p class="alert">Take this lead first. Then you can log what happened.</p>' : ''}
    ${canAct && l.crm_owner && (moves.length || OPEN.includes(l.status)) ? logForm(l, moves) : (BOOKED.includes(l.status) ? '<p class="alert good">This booking is confirmed.</p>' : '')}
    ${canAct && (l.crm_owner || can('assign_leads')) && !BOOKED.includes(l.status) && !['lost', 'junk'].includes(l.status) ? outcomeBox() : ''}
    ${can('assign_leads') ? assignBox(l) : ''}
    <h3>History</h3><ul class="timeline">${d.activities.length ? d.activities.map((a) => `<li><b>${esc(KIND_LABEL[a.kind] || a.kind)}</b> <span class="muted small">${esc(a.actor || 'System')} · ${when(a.created_at)}</span>${a.body ? '<p>' + mask(a.body) + '</p>' : ''}</li>`).join('') : '<li class="muted">Nothing logged yet.</li>'}</ul>
    <h3>WhatsApp chat</h3><div id="chat" class="chat-box"><p class="muted small">Loading chat…</p></div>`;
  if (S.kind) { const k = $(`#logForm [name=kind][value=${S.kind}]`); if (k) k.checked = true; }
  syncLogForm();
  refreshChat();
}

/* ---------- WhatsApp chat in the lead sheet ---------- */
// There is no webhook, so the words a customer types stay in AiSensy Live Chat. The desk asks AiSensy when the customer last wrote
// (that opens or closes the 24-hour reply window), shows what the team sent, and sends replies and templates.
let chatTimer = null, chatMeta = null, lastSync = 0;
async function syncChat(id) {
  try { const { data } = await sb.functions.invoke('desk-chat-sync', { body: { lead_id: id } }); chatMeta = data && data.ok ? data : null; lastSync = Date.now(); } catch (e) { chatMeta = null; }
}
async function refreshChat(forceSync = true) {
  const box = $('#chat'); const id = S.open; if (!box || !id) return;
  try {
    if (forceSync || Date.now() - lastSync > 60e3) await syncChat(id);
    const c = await rpc('crm_chat', { p_lead: id });
    if (S.open !== id || !$('#chat')) return;
    const l = S.detail.lead, mineOrBoss = l.crm_owner === S.me.user_id || canTech();
    const draft = $('#replyText')?.value || '';
    const canAct = can('edit_leads') && mineOrBoss && !!l.crm_owner;
    const wrote = chatMeta?.last_active || c.last_customer_msg_at;
    const open = !!(chatMeta ? chatMeta.window_open : c.window_open);
    if (S.links === undefined) { try { S.links = await rpc('crm_wa_links'); } catch (e) { S.links = null; } }
    const url = S.links?.live_chat || chatMeta?.chat_url;
    const state = c.opted_out ? '<p class="alert">This customer asked not to get messages.</p>'
      : wrote ? `<p class="small ${open ? '' : 'muted'}">Customer last wrote ${when(wrote)}. ${open ? 'You can reply now.' : 'More than 24 hours ago, so WhatsApp allows only a template message.'} Read their words in AiSensy Live Chat.</p>`
        : '<p class="small muted">No reply from this customer on the desk number yet, so WhatsApp allows only a template message.</p>';
    box.innerHTML = `${c.messages.length ? `<ul class="chat">${c.messages.map((m) => `<li class="${m.direction === 'in' ? 'in' : 'out'}"><p>${mask(m.body)}</p><span class="small muted">${m.sender === 'ai' ? 'Auto reply' : m.direction === 'in' ? 'Customer' : 'Us'} · ${when(m.created_at)}</span></li>`).join('')}</ul>` : '<p class="muted small">Nothing sent from the desk yet.</p>'}
      ${state}
      <div class="row wrap"><button class="btn sm" type="button" data-act="chatRefresh">Check for a reply</button>${url ? `<a class="btn sm wa" href="${esc(url)}" target="_blank" rel="noopener">Open AiSensy chat</a>` : ''}
        ${canAct && !c.opted_out ? '<button class="btn sm" type="button" data-act="tplFollowup">Send follow-up template</button>' : ''}${canAct && !c.opted_out && l.status === 'completed' ? '<button class="btn sm" type="button" data-act="tplRating">Ask for a rating</button>' : ''}</div>
      ${canAct && open && !c.opted_out ? `<form id="replyForm" class="reply"><label class="label" for="replyText">Reply on WhatsApp</label><textarea id="replyText" rows="2" maxlength="1000" placeholder="Type your reply. Never share Aadhaar, PAN, bank or card numbers."></textarea><p class="err" id="replyErr" role="alert"></p><button class="btn wa wide" type="submit" id="replySend">Send</button></form>` : ''}`;
    const t = $('#replyText'); if (t && draft) t.value = draft;
    const list = box.querySelector('.chat'); if (list) list.scrollTop = list.scrollHeight;
  } catch (e) { box.innerHTML = `<p class="muted small">${esc(clean(e))}</p>`; }
  clearTimeout(chatTimer); chatTimer = setTimeout(() => { if (!$('#sheet').hidden && S.open === id && document.activeElement?.id !== 'replyText') refreshChat(false); }, 20e3);
}
async function sendReply() {
  const t = $('#replyText'), text = t.value.trim(); if (!text) { $('#replyErr').textContent = 'Write a message first.'; return; }
  if (hasPii(text)) { $('#replyErr').textContent = 'Remove Aadhaar, PAN, bank or card numbers.'; return; }
  $('#replySend').disabled = true; $('#replyErr').textContent = '';
  const { data, error } = await sb.functions.invoke('desk-reply', { body: { lead_id: S.open, text } });
  if (error || data?.error) { let msg = data?.error; if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch (x) { /* ignore */ } } $('#replyErr').textContent = msg || 'Could not send.'; $('#replySend').disabled = false; return; }
  t.value = ''; toast('Sent on WhatsApp.'); await refreshChat(false);
}
async function sendTemplate(kind) {
  const { data, error } = await sb.functions.invoke('desk-template', { body: { lead_id: S.open, kind } });
  if (error || data?.error) { let msg = data?.error; if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch (x) { /* ignore */ } } throw new Error(msg || 'Could not send.'); }
  toast(kind === 'rating' ? 'Rating request sent.' : 'Follow-up sent.'); await refreshChat(false);
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
    <select id="status" name="status"><option value="">Stay at ${STATUS_LABEL[l.status]}</option>${moves.filter((s) => s !== 'lost').map((s) => `<option value="${s}">${STATUS_LABEL[s]}</option>`).join('')}<option value="confirm">Schedule: technician, date, slot (after Confirm booking)</option>${moves.includes('lost') ? '<option value="lost">Lost (give a reason)</option>' : ''}</select>
    <div id="techBox" hidden><div class="fld"><label class="label" for="lfTech">Technician</label><select id="lfTech" name="lfTech"><option value="">Choose the technician</option></select><p class="hint">Free in the slot and covering the PIN code come first.</p></div>
      <div class="grid2" id="lfWhen" hidden><div class="fld half"><label class="label" for="lfDate">Visit date</label><input id="lfDate" name="lfDate" type="date" min="${istToday()}" value="${l.preferred_date && l.preferred_date >= istToday() ? l.preferred_date : ''}"></div>
        <div class="fld half"><label class="label" for="lfSlot">Time slot</label><select id="lfSlot" name="lfSlot"><option value="">Choose a slot</option>${SLOTS.map(([v, t]) => `<option value="${v}"${v === l.preferred_slot ? ' selected' : ''}>${t}</option>`).join('')}</select></div></div></div>
    <div id="lostBox" hidden><label class="label" for="lost">Why was it lost? (required)</label><select id="lost" name="lost"><option value="">Choose a reason</option>${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select><p class="hint">Other needs a note of at least 5 characters in the Note box above.</p></div>
    <div id="nextBox"><span class="label">Next follow-up (required)</span><div class="presets">${presets.map((p) => `<button class="chip pick" type="button" data-act="preset" data-iso="${localInputValue(p.date)}">${p.label}</button>`).join('')}</div>
      <input id="next" name="next" type="datetime-local" value="${localInputValue(def)}" aria-label="Follow-up date and time"></div>
    <p class="err" id="logErr" role="alert"></p><button class="btn primary wide" type="submit" id="logSave">Save</button></form>`;
}
function outcomeBox() {
  return `<div class="card" id="outcomeBox"><h3>Lead status</h3><p class="small muted">Close this lead as won or lost. This is separate from the note above.</p>
    <div class="row wrap"><button class="btn primary" type="button" data-act="won">Won</button><button class="btn" type="button" data-act="lostOpen">Lost</button></div>
    <div id="lostPick" hidden><label class="label" for="oLost">Why was it lost?</label><select id="oLost"><option value="">Choose a reason</option>${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select>
      <label class="label" for="oNote">Note (Other needs at least 5 characters)</label><input id="oNote" maxlength="200"><div class="row wrap" style="margin-top:8px"><button class="btn" type="button" data-act="lostSave">Save as lost</button></div></div></div>`;
}
/* Confirm booking: the database gives the booking ID (the same one again if it already has one) and writes who did it to the history. */
async function confirmBooking() {
  const id = await rpc('confirm_booking', { p_lead: S.open });
  toast('Booking ID ' + id + ' given.'); await afterChange(false);
}
/* Mark as junk and Restore: admin only, checked again by the database. The lead stays as data with its reason. */
function markJunk() {
  const lead = S.detail.lead;
  modal({ title: 'Mark as junk', intro: esc(lead.name) + ' is kept as data, but is left out of follow-ups, reminders and totals. You can restore it later.', body: field('Why is it junk? (optional)', 'reason', { max: 200, hint: 'For example spam, test or wrong number. No ID or card numbers.' }),
    submit: 'Mark as junk', danger: true, onSubmit: async (f, d, close) => { await rpc('mark_lead_junk', { p_lead: lead.id, p_reason: String(d.reason || '').trim() || null }); close(); toast('Marked as junk.'); await afterChange(true); } });
}
async function restoreJunk() {
  if (!(await confirmBox('Restore this lead to its earlier stage?', 'Restore'))) return;
  const back = await rpc('restore_lead_junk', { p_lead: S.open });
  toast('Restored to ' + (STATUS_LABEL[back] || back) + '.'); await afterChange(false);
}
async function saveOutcome(kind) {
  const note = ($('#oNote') || {}).value || '', reason = ($('#oLost') || {}).value || '';
  const g = stepGuard(S.detail.lead, kind === 'won' ? 'schedule' : 'lost'); if (!g.ok) return toast(g.error, true);
  if (kind === 'won' && !(await confirmBox('Mark this lead as won? It counts as booked.', 'Mark won'))) return;
  if (kind === 'lost') { const c = lostReasonCheck(reason, note); if (!c.ok) return toast(c.error, true); }
  await rpc('crm_set_outcome', { p_id: S.open, p_outcome: kind, p_lost_reason: kind === 'lost' ? reason : null, p_note: note.trim() || null });
  toast(kind === 'won' ? 'Marked as won.' : 'Saved. Lead closed as lost.'); await afterChange(kind === 'lost');
}
function syncSub() {
  const d = $('#disp'), s = $('#sub'); if (!d || !s) return;
  if (s.dataset.for === d.value) return;  // only rebuild when the disposition changes, so the agent's pick stays
  // Start from the lead's saved sub disposition, except the two that act (they would ask for a technician on every note).
  const saved = S.detail.lead.sub_disposition, cur = s.dataset.for === undefined && !['Technician assigned', 'Booking confirmed'].includes(saved) ? saved : ''; s.dataset.for = d.value;
  s.innerHTML = '<option value="">None</option>' + S.dispositions.filter((x) => x.disposition === d.value).map((x) => `<option${x.sub === cur ? ' selected' : ''}>${esc(x.sub)}</option>`).join('');
}
function syncLogForm() {
  const f = $('#logForm'); if (!f) return;
  syncSub();
  const status = f.status.value, kind = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  const to = status || S.detail.lead.status;
  $('#lostBox').hidden = status !== 'lost';
  const callback = f.disp && f.disp.value === 'Call backs';
  $('#nextBox').hidden = !callback && !(OPEN.includes(to) && !(kind === 'note' && !status));
  const lab = $('#nextBox .label'); if (lab) lab.textContent = callback ? 'Call back date and time (required)' : 'Next follow-up (required)';
  // "Booking confirmed" (in Move this lead to, or as the sub disposition) needs technician, date and slot; "Technician assigned" needs the technician.
  const mode = moveMode(f);
  $('#techBox').hidden = !mode; $('#lfWhen').hidden = mode !== 'confirm';
  if (mode === 'confirm') $('#nextBox').hidden = true;
  if (mode) loadTechs(f);
}
const istToday = () => new Date(Date.now() + 330 * 60e3).toISOString().slice(0, 10);
function moveMode(f) {
  if (f.status.value === 'confirm' || (f.sub && f.sub.value === 'Booking confirmed')) return 'confirm';
  return f.sub && f.sub.value === 'Technician assigned' ? 'assign' : null;
}
// The technician list, ranked for the visit date: free in the slot first, then those who cover the PIN code.
async function loadTechs(f) {
  const l = S.detail.lead, date = (f.lfDate && f.lfDate.value) || l.preferred_date || null, sel = f.lfTech.value || l.mechanic_id || '';
  if (f.lfTech.dataset.for === String(date) && f.lfTech.options.length > 1) return;
  f.lfTech.dataset.for = String(date);
  let list; try { list = rankTechs((await rpc('crm_tech_board', { p_date: date })).techs, { ...l, preferred_date: date, preferred_slot: (f.lfSlot && f.lfSlot.value) || l.preferred_slot }); }
  catch (e) { try { list = (await rpc('crm_mechanic_picker')).map((t) => ({ id: t.id, label: t.name + (t.area ? ' · ' + t.area : '') })); } catch (e2) { list = []; } }
  f.lfTech.innerHTML = '<option value="">Choose the technician</option>' + list.map((t) => `<option value="${t.id}"${t.id === sel ? ' selected' : ''}>${esc(t.label)}</option>`).join('');
}
async function saveLog() {
  const f = $('#logForm');
  const kindRaw = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  const v = { kind: kindRaw, body: f.body.value, status: f.status.value, lostReason: f.lost.value, nextAction: f.next.value ? new Date(f.next.value).toISOString() : '', current: S.detail.lead.status };
  const mode = moveMode(f);
  const target = mode === 'confirm' ? 'schedule' : { quoted: 'quote', lost: 'lost' }[v.status];
  if (target) { const g = stepGuard(S.detail.lead, target); if (!g.ok) { $('#logErr').textContent = g.error; return; } }
  if (mode === 'confirm') return saveConfirm(f, v.body);
  const kind = v.kind === 'note' && v.status ? 'status' : v.kind;
  if (mode === 'assign') { const c = moveCheck('assign', { mechanic_id: f.lfTech.value }, istToday()); if (!c.ok) { $('#logErr').textContent = c.error; return; } }
  const check = validateLog({ ...v, kind, nextAction: $('#nextBox').hidden ? '' : v.nextAction });
  if (!check.ok) { $('#logErr').textContent = check.error; return; }
  if (f.disp && f.disp.value === 'Call backs' && !f.next.value) { $('#logErr').textContent = 'Pick the date and time the customer asked to be called back.'; return; }
  if (f.sub && f.sub.value && !f.disp.value) { $('#logErr').textContent = 'Choose the disposition for that sub disposition.'; return; }
  $('#logErr').textContent = ''; $('#logSave').disabled = true;
  try {
    await rpc('crm_log', { p_id: S.open, p_kind: kind, p_body: v.body.trim() || null, p_next_action: $('#nextBox').hidden ? null : v.nextAction, p_status: v.status || null, p_lost_reason: v.status === 'lost' ? v.lostReason : null,
      p_disposition: f.disp && f.disp.value ? f.disp.value : null, p_sub_disposition: f.sub && f.sub.value ? f.sub.value : null });
    if (mode === 'assign') {
      const r = await rpc('crm_assign_technician', { p_id: S.open, p_mechanic: f.lfTech.value, p_note: null, p_next_action: null });
      toast('Saved. Technician assigned: ' + r.mechanic_name + '.'); await afterChange(false); return offerJobShare();
    }
    toast(v.status === 'lost' ? 'Saved. Lead closed as lost.' : 'Saved.');
    await afterChange(true);
  } catch (e) { $('#logErr').textContent = clean(e); $('#logSave').disabled = false; }
}
async function saveConfirm(f, body) {
  const v = { mechanic_id: f.lfTech.value, date: f.lfDate.value, slot: f.lfSlot.value }, c = moveCheck('confirm', v, istToday());
  if (!c.ok) { $('#logErr').textContent = c.error; return; }
  $('#logErr').textContent = ''; $('#logSave').disabled = true;
  try {
    const l = S.detail.lead, r = await rpc('crm_confirm_booking', { p_id: l.id, p_mechanic: v.mechanic_id, p_date: v.date, p_slot: v.slot, p_note: body.trim() || null });
    if (!r.already) sb.functions.invoke('confirm-booking', { body: { lead_id: l.id } }).then(({ data, error }) => { if (error || (data && data.error)) toast('Booking confirmed. The confirmation email could not be sent.', true); });
    toast(r.already ? 'Already confirmed. Nothing changed.' : 'Booking confirmed with ' + r.mechanic_name + '.');
    await afterChange(false); await offerJobShare();
  } catch (e) { $('#logErr').textContent = clean(e); $('#logSave').disabled = false; }
}
/* ---------- after a move: send the job to the technician ---------- */
async function offerJobShare() {
  const l = S.detail && S.detail.lead; if (!l || !l.mechanic_phone) return;
  const first = String(l.mechanic_name || 'the technician').split(' ')[0];
  if (await confirmBox(`Send the job to ${first} on WhatsApp now?`, 'Send job to ' + first)) await sendJob();
}
// The job message carries the technician's own link to report the amount collected (a new link each time; it expires the old one).
async function sendJob() {
  const l = S.detail && S.detail.lead; if (!l || !l.mechanic_phone) return;
  const win = window.open('about:blank', '_blank');  // open now, while the tap still counts, then point it at WhatsApp
  let url = null; try { url = await rpc('crm_tech_link', { p_lead: l.id }); } catch (e) { toast('The job link could not be made: ' + clean(e) + ' Sending the job without it.', true); }
  const wa = waUrl(l.mechanic_phone, techJobMessage(l, url, { pickup: !!(S.handover && S.handover.is_pickup) }));
  if (win) { win.opener = null; win.location.href = wa; } else window.open(wa, '_blank', 'noopener');
}

/* ---------- OTP handover for pickup jobs: status, send the code to the customer, see the photos ---------- */
function handoverCard(l, canAct) {
  const h = S.handover; if (!h || !h.is_pickup || l.status === 'lost') return '';
  const row = (kind) => {
    const st = handoverStatus(h.items, kind), ok = st.state === 'verified', last = (h.items || []).find((x) => x.kind === kind && x.verified_at);
    const text = ok ? `Verified ${when(st.verifiedAt)}${st.by ? ' by ' + esc(st.by) : ''} · ${st.photos} ${st.photos === 1 ? 'photo' : 'photos'}` : esc(st.label);
    const name = HANDOVER_KIND_LABEL[kind];
    return `<div class="ho-row"><div><b>${name}</b><p class="small ${ok ? 'goodtxt' : st.state === 'locked' ? 'badtxt' : 'muted'}">${text}</p></div><div class="row wrap">
      ${canAct && l.mechanic_name && canSendHandoverCode(h.items, kind) ? `<button class="btn sm wa" type="button" data-act="hoSend" data-kind="${kind}">${st.state === 'none' ? 'Send' : 'Resend'} ${name.toLowerCase()} code</button>` : ''}
      ${last && st.photos ? `<button class="btn sm" type="button" data-act="hoPhotos" data-kind="${kind}">See photos</button>` : ''}</div></div>`;
  };
  return `<div class="card ho-card"><h3>Handover</h3>${l.mechanic_name ? '' : '<p class="muted small">Assign a technician to start the handover.</p>'}${row('pickup')}${row('return')}</div>`;
}
// The code is made by the database and shown once: it goes straight into the customer's WhatsApp message, never on screen or in the history.
async function sendHandoverCode(kind) {
  const l = S.detail && S.detail.lead; if (!l) return;
  const name = HANDOVER_KIND_LABEL[kind].toLowerCase();
  if (!(await confirmBox(`Send the ${name} code to ${l.name} on WhatsApp now? Any older ${name} code stops working.`, 'Send ' + name + ' code'))) return;
  const win = window.open('about:blank', '_blank');  // open now, while the tap still counts, then point it at WhatsApp
  let r = null; try { r = await rpc('crm_handover_code', { p_lead: l.id, p_kind: kind }); } catch (e) { if (win) win.close(); toast('The code could not be made: ' + clean(e), true); return; }
  const wa = waUrl(l.phone, handoverMessage(l, kind, r.code));
  if (win) { win.opener = null; win.location.href = wa; } else window.open(wa, '_blank', 'noopener');
  toast('The ' + name + ' code is in WhatsApp. Press send to deliver it.');
  S.handover = await rpc('crm_handovers', { p_lead: l.id }).catch(() => S.handover); renderSheet();
}
const HANDOVER_BUCKET = 'handover';  // private bucket; a Storage bucket, not a table
// Photos are private: ask Storage for links that stop working after 10 minutes (the database lets only desk users who may see the lead do this).
async function showHandoverPhotos(kind) {
  const row = ((S.handover && S.handover.items) || []).find((x) => x.kind === kind && x.verified_at); if (!row) return;
  const { data, error } = await sb.storage.from(HANDOVER_BUCKET).createSignedUrls(row.photo_paths || [], 600);
  if (error) { toast('The photos could not be opened: ' + clean(error), true); return; }
  const imgs = (data || []).filter((x) => x.signedUrl).map((x, i) => `<a href="${esc(x.signedUrl)}" target="_blank" rel="noopener"><img src="${esc(x.signedUrl)}" alt="${HANDOVER_KIND_LABEL[kind]} photo ${i + 1}" loading="lazy"></a>`).join('');
  modal({ title: HANDOVER_KIND_LABEL[kind] + ' photos', intro: 'Private links that stop working after 10 minutes. Do not share them.', body: `<div class="ho-photos">${imgs || '<p class="muted">No photos found.</p>'}</div>`, cancel: 'Close', wide: true });
}

function assignBox(l) {
  return `<div class="assign"><h3>Assign</h3><div class="row"><select id="assignTo" aria-label="Assign to"><option value="">Unassigned queue</option>${(S.users || []).filter((u) => u.active).map((u) => `<option value="${u.user_id}" ${u.user_id === l.crm_owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select>
    <button class="btn ghost" type="button" data-act="assign">Save assignment</button></div></div>`;
}
async function afterChange(close) {
  const open = S.open;  // go() clears S.open, so keep it to redraw the sheet with the new step
  S.me = await rpc('crm_me'); renderHeader();
  if (close) closeSheet();
  await go(S.view, true);
  if (!close && open && !$('#sheet').hidden) { S.open = open; S.detail = await rpc('crm_lead', { p_id: open }); renderSheet(); }
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

/* ---------- import WhatsApp contacts from an AiSensy export ---------- */
// AiSensy gives no webhook on this plan, so new WhatsApp chats are exported from AiSensy and pasted here: one customer per line, name and mobile number in any order.
function importDialog() {
  modal({ title: 'Import from AiSensy', intro: 'In AiSensy, open Contacts, export the new contacts, and paste the rows here: one customer per line, with the name and the 10 digit mobile number. A customer who already has an open lead is skipped, so it is safe to paste the same list twice.',
    body: field('Contacts', 'rows', { type: 'textarea', rows: 8, max: 20000, placeholder: 'Ravi Kumar, 98450 12345\nAnita, 9741012345' }),
    submit: 'Import', onSubmit: async (f, d, close) => {
      const rows = parseContacts(d.rows); if (!rows.length) throw new Error('No mobile numbers found. Each line needs a 10 digit mobile number.');
      const r = await rpc('crm_import_leads', { p_rows: rows.slice(0, 300), p_source: 'whatsapp' });
      close(); toast(`${r.created} lead${r.created === 1 ? '' : 's'} added${r.duplicates ? ', ' + r.duplicates + ' already open' : ''}${r.invalid ? ', ' + r.invalid + ' skipped (not a mobile number)' : ''}.`); await go(S.view, true);
    } });
}

/* ---------- vehicle tag (BIKE / CAR / PARTS) ---------- */
document.addEventListener('change', async (e) => {
  const s = e.target.closest && e.target.closest('#vehSel'); if (!s) return;
  try { await rpc('set_lead_vehicle', { p_lead: s.dataset.lead, p_vehicle: s.value }); toast('Vehicle set to ' + VEHICLE_LABEL[s.value] + '.'); await go(S.view, true); await openLead(s.dataset.lead); }
  catch (err) { toast(err.message || 'Could not change the vehicle.'); }
});

/* ---------- clicks ---------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'open') return await openLead(id);
    if (act === 'call' || act === 'wa') { await openLead(id, act === 'call' ? 'call' : 'whatsapp'); return; }
    if (act === 'take') { e.preventDefault(); await rpc('crm_claim', { p_id: id }); toast('It is yours. Contact the customer now.'); await go(S.view, true); return await openLead(id); }
    if (act === 'step') return await runStep(b.dataset.key, id);
    if (act === 'close') return closeSheet();
    if (act === 'hoSend') return await sendHandoverCode(b.dataset.kind);
    if (act === 'hoPhotos') return await showHandoverPhotos(b.dataset.kind);
    if (act === 'add') return addDialog();
    if (act === 'import') return importDialog();
    if (act === 'booking') return newBooking(ctx);
    if (act === 'editBooking') return editBooking(ctx, S.detail.lead);
    if (act === 'confirmBooking') return await confirmBooking();
    if (act === 'junkOpen') return markJunk();
    if (act === 'junkRestore') return await restoreJunk();
    if (act === 'gotoInbox') return go('inbox');
    if (act === 'chatRefresh') { await refreshChat(true); return toast('Checked.'); }
    if (act === 'tplFollowup') return await sendTemplate('followup');
    if (act === 'tplRating') return await sendTemplate('rating');
    if (act === 'payLink') return sendPaymentLink(ctx, S.detail.lead, () => afterChange(false));
    if (act === 'ticket') { const l = S.detail.lead; const { newTicket } = tickets; return newTicket(ctx, { lead: l.id, title: 'Issue with ' + l.name + (bookingLabel(l) ? ' (' + bookingLabel(l) + ')' : '') }); }
    if (act === 'won') return await saveOutcome('won');
    if (act === 'lostOpen') { $('#lostPick').hidden = false; return; }
    if (act === 'lostSave') return await saveOutcome('lost');
    if (act === 'preset') { $('#next').value = b.dataset.iso; return; }
    if (act === 'pinSearch') return findByPin();
    if (act === 'sendJob') return await sendJob();
    if (act === 'assign') { await rpc('crm_assign', { p_id: S.open, p_user: $('#assignTo').value || null }); toast('Assignment saved.'); return await afterChange(false); }
  } catch (err) { toast(clean(err), true); }
});
document.addEventListener('change', (e) => {
  if (e.target.matches('#status, [name=kind], #disp, #sub')) syncLogForm();
  if (e.target.matches('#lfDate, #lfSlot')) { const f = $('#logForm'); if (f) { f.lfTech.dataset.for = ''; loadTechs(f); } }
});
document.addEventListener('submit', (e) => { if (e.target.id === 'logForm') { e.preventDefault(); saveLog(); } if (e.target.id === 'replyForm') { e.preventDefault(); sendReply(); } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('.modal-back') && !$('#sheet').hidden) closeSheet(); });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
setInterval(() => { if (S.me && !document.hidden && ['mine', 'unassigned'].includes(S.view) && $('#sheet').hidden && !$('.modal-back') && document.activeElement?.id !== 'q') renderBody(); }, 30e3);

boot();
