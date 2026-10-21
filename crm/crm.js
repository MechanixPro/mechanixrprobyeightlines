// Mechanix CRM: Sales and Support desk. Every read and write goes through database functions that check the person's role.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { OPEN, BOOKED, STATUS_LABEL, LOST_REASONS, SOURCE_LABEL, KIND_LABEL, sourceName, nextStatuses, validateLog, followUpPresets, localInputValue, telUrl, waUrl, firstMessage, ago, timerInfo, targetPercent, conversion } from './crm-rules.js';

const C = window.MXP || {};
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

if (!C.supabaseUrl || !C.supabaseAnonKey) {
  $('#login').innerHTML = '<h1>Desk not connected yet</h1><p class="muted">The Supabase settings are missing from /assets/js/config.js.</p>';
  throw new Error('Supabase not configured');
}
const sb = createClient(C.supabaseUrl, C.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
const S = { me: null, view: 'mine', leads: [], q: '', open: null, detail: null, stats: null, users: [], counts: { unassigned: 0 }, busy: false };
const MASK = /[0-9]{4}[ -]?[0-9]{4}[ -]?[0-9]{4,7}/g;
const mask = (t) => esc(String(t ?? '').replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, '••••••••••').replace(MASK, '•••• •••• ••••'));

function toast(m, bad) {
  const t = document.createElement('div'); t.className = 'toast fade' + (bad ? ' bad' : ''); t.setAttribute('role', 'status'); t.textContent = m;
  document.body.appendChild(t); setTimeout(() => t.remove(), 4200);
}
const clean = (e) => String(e?.message || e || 'Something went wrong').replace(/^Error:\s*/, '');
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}

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
  $('#who').textContent = S.me.name + ' · ' + { sales: 'Sales', support: 'Support', supervisor: 'Supervisor' }[S.me.role];
  $('#teamTab').hidden = S.me.role !== 'supervisor'; $('#allTab').hidden = S.me.role !== 'supervisor';
  await go('mine');
  setInterval(refresh, 60e3);
}
async function refresh() {
  if (S.busy || document.hidden || !S.me) return;
  try { S.me = await rpc('crm_me'); if (S.view !== 'team') await loadList(); renderHeader(); renderBody(); } catch (e) {}
}

/* ---------- data ---------- */
async function loadList() {
  const view = S.view;
  S.leads = await rpc('crm_queue', { p_view: view, p_search: S.q || null });
  if (view !== 'unassigned') {
    try { S.counts.unassigned = (await rpc('crm_queue', { p_view: 'unassigned', p_search: null })).length; } catch (e) {}
  } else S.counts.unassigned = S.leads.length;
}
async function go(view) {
  S.view = view; S.open = null; S.busy = true;
  $$('#tabs [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  $('#view').innerHTML = '<p class="muted pad">Loading…</p>';
  try {
    if (view === 'team') { S.stats = await rpc('crm_team_stats', { p_from: dateStr(S.from), p_to: dateStr(S.to) }); S.users = await rpc('crm_list_users'); }
    else await loadList();
    S.me = await rpc('crm_me');
  } catch (e) { $('#view').innerHTML = '<p class="err pad">' + esc(clean(e)) + '</p>'; S.busy = false; return; }
  S.busy = false; renderHeader(); renderBody();
}
const todayStr = () => new Date().toISOString().slice(0, 10);
const dateStr = (d) => d || todayStr();
S.from = null; S.to = null;

/* ---------- header and tabs ---------- */
function renderHeader() {
  const m = S.me; if (!m) return;
  const pct = targetPercent(m.booked_today, m.daily_target);
  $('#goal').innerHTML = `<div class="goal-top"><b>${m.booked_today}</b> of ${m.daily_target} bookings today</div><div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
    <div class="goal-sub">${m.pending_advance} waiting for the advance · ${m.contacts_today} contacts made</div>`;
  const b = $('#unBadge'); b.textContent = S.counts.unassigned; b.hidden = !S.counts.unassigned;
}

/* ---------- body ---------- */
function renderBody() {
  if (S.view === 'team') return renderTeam();
  const titles = { mine: 'My day', unassigned: 'Unassigned leads', won: 'My bookings', lost: 'My lost leads', all: 'All leads' };
  const hints = {
    mine: 'Late and overdue leads come first. Every open lead needs a dated next step.',
    unassigned: 'Take a lead and contact it within ' + S.me.sla_minutes + ' minutes.',
    won: 'Leads that paid the advance or are already scheduled.', lost: 'Every lost lead has a reason a supervisor can see.', all: 'Everyone’s leads. Assign or take back from the lead page.' };
  const list = S.leads;
  const late = list.filter((l) => l.is_late || l.overdue).length;
  $('#view').innerHTML = `<div class="view-head"><div><h1>${titles[S.view]}</h1><p class="muted">${hints[S.view]}</p></div>
    <div class="view-tools"><input id="q" type="search" placeholder="Search name, phone or ref" value="${esc(S.q)}" aria-label="Search leads"><button class="btn primary" type="button" data-act="add">+ Add lead</button></div></div>
    ${late && ['mine', 'unassigned', 'all'].includes(S.view) ? `<div class="alert" role="status"><b>${late}</b> ${late === 1 ? 'lead needs' : 'leads need'} you right now.</div>` : ''}
    <div class="cards">${list.length ? list.map(card).join('') : `<div class="empty">${emptyText()}</div>`}</div>`;
  const q = $('#q'); if (q) { q.addEventListener('input', debounce(async () => { S.q = q.value.trim(); await loadList(); renderBody(); const n = $('#q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 350)); }
}
const emptyText = () => ({ mine: 'Nothing open. Take a lead from <b>Unassigned</b>, or add one you got by phone.', unassigned: 'No unassigned leads right now.', won: 'No bookings yet. The first one is close.', lost: 'No lost leads.', all: 'No leads match.' }[S.view]);
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

function card(l) {
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  const src = sourceName(l.utm_source || l.source);
  const camp = l.campaign || '';
  const mine = l.crm_owner && l.crm_owner === S.me.user_id;
  const take = !l.crm_owner;
  return `<article class="lead-card tone-${t.tone}" data-id="${l.id}">
    <div class="lc-top"><div><h2>${esc(l.name)}</h2><p class="muted small">${esc([l.bike, l.service_name, l.area].filter(Boolean).join(' · ') || 'No details yet')}</p></div>
      <span class="chip st-${l.status}">${STATUS_LABEL[l.status]}</span></div>
    <div class="lc-meta"><span class="chip soft">${esc(src)}${camp ? ' · ' + esc(camp) : ''}</span><span class="small muted">${ago(l.created_at)}</span>${l.crm_owner && !mine ? `<span class="small muted">with ${esc(l.owner_name || 'a colleague')}</span>` : ''}</div>
    <div class="timer t-${t.tone}">${esc(t.label)}</div>
    <div class="lc-actions">
      <a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${take ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}
      <button class="btn ghost" type="button" data-act="open" data-id="${l.id}">Open</button></div>
  </article>`;
}

/* ---------- lead sheet ---------- */
async function openLead(id, kind) {
  S.open = id; S.busy = true;
  try {
    S.detail = await rpc('crm_lead', { p_id: id });
    if (S.me.role === 'supervisor' && !S.users.length) S.users = await rpc('crm_list_users');
  } catch (e) { toast(clean(e), true); S.busy = false; return; }
  S.busy = false; S.kind = kind || 'note'; renderSheet();
}
function renderSheet() {
  const d = S.detail, l = d.lead, sheet = $('#sheet');
  const canAct = !l.crm_owner || l.crm_owner === S.me.user_id || S.me.role === 'supervisor';
  const moves = nextStatuses(l.status, S.me.role);
  const t = timerInfo(l, new Date(), S.me.sla_minutes);
  const presets = followUpPresets();
  sheet.hidden = false; document.body.classList.add('noscroll');
  $('#sheetPanel').innerHTML = `<div class="sheet-head"><div><h2 id="sheetTitle">${esc(l.name)}</h2><p class="muted small">${esc(l.ref)} · ${esc(SOURCE_LABEL[l.source] || l.source)}${l.campaign ? ' · ' + esc(l.campaign) : ''}</p></div><button class="btn ghost" type="button" data-act="close" aria-label="Close">Close</button></div>
    <div class="timer t-${t.tone}">${esc(t.label)}</div>
    <div class="facts">
      <div><span>Phone</span><b>${esc(l.phone)}</b></div><div><span>Area</span><b>${esc(l.area || '—')}</b></div>
      <div><span>Bike</span><b>${esc(l.bike || '—')}</b></div><div><span>Service</span><b>${esc(l.service_name || '—')}</b></div>
      <div><span>Preferred</span><b>${esc([l.preferred_date, l.preferred_slot].filter(Boolean).join(' · ') || '—')}</b></div><div><span>Quote</span><b>${l.est_total ? rupee(l.est_total) : '—'}</b></div>
      <div><span>With</span><b>${esc(l.owner_name || 'Nobody yet')}</b></div><div><span>Status</span><b>${STATUS_LABEL[l.status]}</b></div></div>
    ${l.notes ? `<p class="note-box">${mask(l.notes)}</p>` : ''}
    <div class="lc-actions big">
      <a class="btn call" href="${telUrl(l.phone)}" data-act="call" data-id="${l.id}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, S.me.name))}" target="_blank" rel="noopener" data-act="wa" data-id="${l.id}">WhatsApp</a>
      ${!l.crm_owner ? `<button class="btn primary" type="button" data-act="take" data-id="${l.id}">Take lead</button>` : ''}</div>
    ${canAct && (moves.length || OPEN.includes(l.status)) ? logForm(l, moves, presets) : (BOOKED.includes(l.status) ? '<p class="alert good">This booking is confirmed.</p>' : '')}
    ${S.me.role === 'supervisor' ? assignBox(l) : ''}
    <h3>History</h3><ul class="timeline">${d.activities.length ? d.activities.map((a) => `<li><b>${esc(KIND_LABEL[a.kind] || a.kind)}</b> <span class="muted small">${esc(a.actor || 'System')} · ${when(a.created_at)}</span>${a.body ? '<p>' + mask(a.body) + '</p>' : ''}</li>`).join('') : '<li class="muted">Nothing logged yet.</li>'}</ul>
    ${d.messages.length ? `<h3>WhatsApp chat</h3><ul class="chat">${d.messages.map((m) => `<li class="${m.direction === 'in' ? 'in' : 'out'}"><p>${mask(m.body)}</p><span class="small muted">${m.sender === 'ai' ? 'Auto reply' : m.direction === 'in' ? 'Customer' : 'Us'} · ${when(m.created_at)}</span></li>`).join('')}</ul>` : ''}`;
  if (S.kind) { const k = $(`#logForm [name=kind][value=${S.kind}]`); if (k) k.checked = true; }
  syncLogForm();
}
function logForm(l, moves, presets) {
  const def = new Date(Date.now() + 86400e3); def.setHours(10, 0, 0, 0);
  return `<form id="logForm" class="log-form" novalidate><h3>What happened?</h3>
    <div class="seg" role="radiogroup" aria-label="Type of contact">${[['call', 'I called'], ['whatsapp', 'I messaged'], ['note', 'Just a note']].map(([v, t]) => `<label><input type="radio" name="kind" value="${v}"><span>${t}</span></label>`).join('')}</div>
    <label class="label" for="body">Note</label><textarea id="body" name="body" rows="3" maxlength="1000" placeholder="What did the customer say? Never write Aadhaar, PAN, bank or card numbers."></textarea>
    <label class="label" for="status">Move this lead to</label>
    <select id="status" name="status"><option value="">Stay at ${STATUS_LABEL[l.status]}</option>${moves.map((s) => `<option value="${s}">${s === 'lost' ? 'Lost (give a reason)' : STATUS_LABEL[s]}</option>`).join('')}</select>
    <div id="lostBox" hidden><label class="label" for="lost">Why was it lost?</label><select id="lost" name="lost"><option value="">Choose a reason</option>${LOST_REASONS.map((r) => `<option>${r}</option>`).join('')}</select></div>
    <div id="nextBox"><span class="label">Next follow-up (required)</span><div class="presets">${presets.map((p) => `<button class="chip pick" type="button" data-act="preset" data-iso="${localInputValue(p.date)}">${p.label}</button>`).join('')}</div>
      <input id="next" name="next" type="datetime-local" value="${localInputValue(def)}" aria-label="Follow-up date and time"></div>
    <p class="err" id="logErr" role="alert"></p>
    <button class="btn primary wide" type="submit" id="logSave">Save</button></form>`;
}
function syncLogForm() {
  const f = $('#logForm'); if (!f) return;
  const status = f.status.value, kind = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  const to = status || S.detail.lead.status;
  $('#lostBox').hidden = status !== 'lost';
  $('#nextBox').hidden = !(OPEN.includes(to) && !(kind === 'note' && !status)); // a follow-up is required for every open lead except a plain note
}
function formValues() {
  const f = $('#logForm');
  const kind = (f.querySelector('[name=kind]:checked') || {}).value || 'note';
  return { kind, body: f.body.value, status: f.status.value, lostReason: f.lost.value, nextAction: f.next.value ? new Date(f.next.value).toISOString() : '', current: S.detail.lead.status };
}
async function saveLog() {
  const v = formValues(); const f = $('#logForm');
  const kind = v.kind === 'note' && v.status ? 'status' : v.kind;
  const check = validateLog({ ...v, kind, nextAction: $('#nextBox').hidden ? '' : v.nextAction });
  if (!check.ok) { $('#logErr').textContent = check.error; return; }
  $('#logErr').textContent = ''; $('#logSave').disabled = true;
  try {
    await rpc('crm_log', { p_id: S.open, p_kind: kind, p_body: v.body.trim() || null, p_next_action: $('#nextBox').hidden ? null : v.nextAction, p_status: v.status || null, p_lost_reason: v.status === 'lost' ? v.lostReason : null });
    toast(v.status === 'lost' ? 'Saved. Lead closed as lost.' : 'Saved.');
    await afterChange(true);
  } catch (e) { $('#logErr').textContent = clean(e); $('#logSave').disabled = false; }
}
function assignBox(l) {
  return `<div class="assign"><h3>Assign</h3><div class="row"><select id="assignTo" aria-label="Assign to"><option value="">Unassigned queue</option>${(S.users || []).filter((u) => u.active).map((u) => `<option value="${u.user_id}" ${u.user_id === l.crm_owner ? 'selected' : ''}>${esc(u.name)} (${u.role})</option>`).join('')}</select>
    <button class="btn ghost" type="button" data-act="assign">Save assignment</button></div></div>`;
}
async function afterChange(close) {
  S.me = await rpc('crm_me');
  if (S.view === 'team') { S.stats = await rpc('crm_team_stats', { p_from: dateStr(S.from), p_to: dateStr(S.to) }); } else await loadList();
  renderHeader(); renderBody();
  if (close) closeSheet(); else if (S.open) { S.detail = await rpc('crm_lead', { p_id: S.open }); renderSheet(); }
}
function closeSheet() { $('#sheet').hidden = true; document.body.classList.remove('noscroll'); S.open = null; }

/* ---------- team (supervisors) ---------- */
function renderTeam() {
  const s = S.stats; if (!s) return;
  const agents = s.agents || [];
  const tot = agents.reduce((a, g) => ({ booked: a.booked + g.booked, contacts: a.contacts + g.contacts }), { booked: 0, contacts: 0 });
  const srcLeads = (s.by_source || []).reduce((a, x) => a + x.leads, 0);
  $('#view').innerHTML = `<div class="view-head"><div><h1>Team</h1><p class="muted">Bookings are what counts. Late means no first contact within ${s.sla_minutes} minutes.</p></div>
    <div class="view-tools"><label class="small muted">From <input id="from" type="date" value="${dateStr(S.from)}"></label><label class="small muted">To <input id="to" type="date" value="${dateStr(S.to)}"></label></div></div>
    <div class="stat-row"><div class="stat"><b>${s.unassigned_new}</b><span>Unassigned</span></div><div class="stat ${s.unassigned_late ? 'bad' : ''}"><b>${s.unassigned_late}</b><span>Unassigned and late</span></div><div class="stat"><b>${tot.booked}</b><span>Booked in range</span></div><div class="stat"><b>${tot.contacts}</b><span>Contacts made</span></div><div class="stat"><b>${conversion(tot.booked, srcLeads)}%</b><span>Leads booked</span></div></div>
    <h3>Agents</h3><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th class="n">Open</th><th class="n">Late</th><th class="n">Overdue</th><th class="n">Contacts</th><th class="n">Booked</th><th class="n">Advance pending</th><th class="n">Lost</th><th class="n">First contact (min)</th><th>Daily target</th><th></th></tr></thead><tbody>
    ${agents.map((a) => `<tr class="${a.active ? '' : 'off'}"><td>${esc(a.name)}</td><td>${a.role}</td><td class="n">${a.open}</td><td class="n ${a.late ? 'badtxt' : ''}">${a.late}</td><td class="n ${a.overdue ? 'badtxt' : ''}">${a.overdue}</td><td class="n">${a.contacts}</td><td class="n"><b>${a.booked}</b></td><td class="n">${a.advance_pending}</td><td class="n">${a.lost}</td><td class="n">${a.avg_first_contact_min ?? '—'}</td>
      <td><input class="tgt" type="number" min="0" max="100" value="${a.daily_target}" data-user="${a.user_id}" aria-label="Daily target for ${esc(a.name)}"></td>
      <td>${a.active ? `<button class="btn ghost sm" type="button" data-act="deactivate" data-user="${a.user_id}">Switch off</button>` : `<button class="btn ghost sm" type="button" data-act="activate" data-user="${a.user_id}">Switch on</button>`}</td></tr>`).join('') || '<tr><td colspan="12" class="muted">No team members yet. Add the first one below.</td></tr>'}</tbody></table></div>
    <div class="two"><div><h3>Leads by source</h3>${(s.by_source || []).length ? `<ul class="bars">${s.by_source.map((x) => `<li><span>${esc(sourceName(x.source))}</span><b>${x.leads}</b><i style="width:${Math.round((x.leads / Math.max(...s.by_source.map((y) => y.leads))) * 100)}%"></i><small>${x.booked} booked</small></li>`).join('')}</ul>` : '<p class="muted">No leads in this range.</p>'}</div>
      <div><h3>Why leads were lost</h3>${(s.lost_reasons || []).length ? `<ul class="bars">${s.lost_reasons.map((x) => `<li><span>${esc(x.reason)}</span><b>${x.n}</b></li>`).join('')}</ul>` : '<p class="muted">No lost leads in this range.</p>'}</div></div>
    <h3>Add a team member</h3><form id="userForm" class="user-form" novalidate><input name="name" placeholder="Full name" autocomplete="off" aria-label="Full name"><input name="email" type="email" placeholder="Work email" autocomplete="off" aria-label="Email"><select name="role" aria-label="Role"><option value="sales">Sales</option><option value="support">Support</option><option value="supervisor">Supervisor</option></select><button class="btn primary" type="submit">Add</button></form>
    <p class="small muted">They sign in with a 6-digit code sent to that email. Nothing else to set up.</p><p class="err" id="userErr" role="alert"></p>`;
  $('#from').addEventListener('change', (e) => { S.from = e.target.value || null; go('team'); });
  $('#to').addEventListener('change', (e) => { S.to = e.target.value || null; go('team'); });
}

/* ---------- add a lead by hand ---------- */
function addDialog() {
  const el = document.createElement('div'); el.className = 'modal-back'; el.id = 'addModal';
  el.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="addH" novalidate><h2 id="addH">Add a lead</h2><p class="muted small">For calls, walk-ins, JustDial and Instagram messages. Website and WhatsApp leads arrive on their own.</p>
    <label class="label" for="aName">Customer name</label><input id="aName" autocomplete="off"><label class="label" for="aPhone">Mobile number</label><input id="aPhone" inputmode="tel" autocomplete="off" placeholder="10 digits">
    <label class="label" for="aArea">Area</label><input id="aArea" autocomplete="off"><label class="label" for="aSrc">Where did it come from?</label>
    <select id="aSrc"><option value="phone">Phone call</option><option value="walk_in">Walk in</option><option value="justdial">JustDial</option><option value="instagram">Instagram</option><option value="whatsapp">WhatsApp</option></select>
    <label class="label" for="aNote">Note</label><textarea id="aNote" rows="2" maxlength="1000"></textarea><p class="err" id="aErr" role="alert"></p>
    <div class="row end"><button class="btn ghost" type="button" data-act="addCancel">Cancel</button><button class="btn primary" type="submit">Add lead</button></div></form>`;
  document.body.appendChild(el); $('#aName').focus();
  $('form', el).addEventListener('submit', async (e) => {
    e.preventDefault(); $('#aErr').textContent = '';
    try {
      const r = await rpc('crm_add_lead', { p_name: $('#aName').value, p_phone: $('#aPhone').value, p_area: $('#aArea').value, p_source: $('#aSrc').value, p_note: $('#aNote').value });
      el.remove(); toast(r.duplicate ? 'This customer already has an open lead. Opening it.' : 'Lead added.');
      await afterChange(false); await openLead(r.id);
    } catch (err) { $('#aErr').textContent = clean(err); }
  });
}

/* ---------- clicks ---------- */
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'open') return await openLead(id);
    if (act === 'call' || act === 'wa') { await openLead(id, act === 'call' ? 'call' : 'whatsapp'); return; } // the phone or WhatsApp opens through the link; the log form is ready when they come back
    if (act === 'take') { e.preventDefault(); await rpc('crm_claim', { p_id: id }); toast('It is yours. Contact the customer now.'); await afterChange(false); if (S.open === id) return; return await openLead(id); }
    if (act === 'close') return closeSheet();
    if (act === 'add') return addDialog();
    if (act === 'addCancel') return $('#addModal')?.remove();
    if (act === 'preset') { $('#next').value = b.dataset.iso; return; }
    if (act === 'assign') { await rpc('crm_assign', { p_id: S.open, p_user: $('#assignTo').value || null }); toast('Assignment saved.'); return await afterChange(false); }
    if (act === 'deactivate' || act === 'activate') {
      if (act === 'deactivate' && !confirm('Switch this person off? Their open leads go back to the unassigned queue.')) return;
      await rpc('crm_set_user_active', { p_user: b.dataset.user, p_active: act === 'activate' }); toast('Updated.'); return await go('team');
    }
  } catch (err) { toast(clean(err), true); }
});
document.addEventListener('change', async (e) => {
  if (e.target.matches('#status, [name=kind]')) syncLogForm();
  if (e.target.matches('.tgt')) { try { await rpc('crm_set_target', { p_user: e.target.dataset.user, p_target: Number(e.target.value) || 0 }); toast('Target saved.'); } catch (err) { toast(clean(err), true); } }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id === 'logForm') { e.preventDefault(); return saveLog(); }
  if (e.target.id === 'userForm') {
    e.preventDefault(); const f = e.target; $('#userErr').textContent = '';
    const { data, error } = await sb.functions.invoke('crm-user', { body: { name: f.name.value, email: f.email.value, role: f.role.value } });
    if (error || data?.error) { let m = data?.error; if (!m && error?.context?.json) { try { m = (await error.context.json()).error; } catch (x) {} } $('#userErr').textContent = m || 'Could not add that person.'; return; }
    toast('Added. They can sign in with a code sent to their email.'); await go('team');
  }
});
$$('#tabs [data-view]').forEach((b) => b.addEventListener('click', () => go(b.dataset.view)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if ($('#addModal')) $('#addModal').remove(); else if (!$('#sheet').hidden) closeSheet(); } });
$('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') closeSheet(); });
setInterval(() => { if (S.me && !document.hidden && S.view !== 'team' && $('#sheet').hidden && document.activeElement?.id !== 'q') renderBody(); }, 30e3); // keeps the timers honest

boot();
