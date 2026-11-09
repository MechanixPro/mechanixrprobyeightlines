import { rpc, esc, head, toast, clean, modal, field, vehicleTag } from '../ui.js';
import { emptyState, errorState, skeleton, chip } from '../ds.js';
import { LOST_REASONS, lostReasonCheck, sourceName, vehicleOf, telUrl, waUrl, firstMessage } from '../crm-rules.js';
import { followUpQueue, bucketCounts, snoozeAt, missedCallQueue, fmtMinutes, quotesWaiting, unpaidBookings } from '../speed.js';

// Follow-ups: open leads whose next follow-up is due, overdue first, then today, then later. One tap to call, WhatsApp, snooze or mark lost.
// Mine for an agent, everyone's for a supervisor. Money shows only to the admin (supervisors never see it).
const st = { bucket: null };
const BUCKETS = [['shield', 'Shield claims'], ['redo', 'Redo requests'], ['quotes', 'Quotes waiting'], ['unpaid', 'Not paid yet'], ['missed', 'Missed calls'], ['due', 'Overdue and today'], ['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later'], ['nodate', 'No date set']];
const money = (ctx) => !!(ctx.me && ctx.me.is_admin);
const rupee = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

export async function render(root, ctx) {
  root.innerHTML = head('Follow-ups', 'Overdue first, then due today. Call, message, snooze or close each one.') + skeleton(4, 'Loading follow-ups');
  try { await draw(root, ctx); } catch (e) {
    root.innerHTML = head('Follow-ups', '') + errorState({ title: 'Follow-ups could not load.', detail: clean(e) });
    root.querySelector('[data-retry]')?.addEventListener('click', () => render(root, ctx));
  }
}

async function draw(root, ctx) {
  const all = ctx.can('view_all_leads');
  const raw = await rpc('crm_queue', { p_view: all ? 'all' : 'mine', p_search: null });
  const missed = missedCallQueue(raw);
  let qraw = [], qOff = false;
  try { qraw = await rpc('crm_quotes_waiting'); } catch (e) { qOff = true; }
  const quotes = quotesWaiting(qraw, Date.now(), money(ctx));
  let uraw = [], uOff = false;
  try { uraw = await rpc('crm_unpaid_bookings'); } catch (e) { uOff = true; }
  const unpaid = unpaidBookings(uraw, Date.now(), money(ctx));
  let rraw = [], rOff = false;
  try { rraw = await rpc('crm_redo_list'); } catch (e) { rOff = true; }   // Redo Promise requests
  const redoRows = Array.isArray(rraw) ? rraw : [], redoOpen = redoRows.filter((r) => r.status === 'open' || r.status === 'approved');
  let sraw = [], sOff = false;
  try { sraw = await rpc('crm_shield_list'); } catch (e) { sOff = true; }   // Mechanix Shield claims
  let smonth = null; try { smonth = await rpc('crm_shield_month'); } catch (e) { smonth = null; }   // admin only: the monthly cap and what is used
  const shieldRows = Array.isArray(sraw) ? sraw : [], shieldOpen = shieldRows.filter((r) => r.status === 'open' || r.status === 'approved');
  if (!st.bucket) st.bucket = shieldOpen.length ? 'shield' : redoOpen.length ? 'redo' : missed.length ? 'missed' : 'due';
  const queue = followUpQueue(raw), counts = bucketCounts(queue), showMoney = money(ctx);
  const pick = (b) => queue.filter((l) => (b === 'due' ? l.bucket === 'overdue' || l.bucket === 'today' : l.bucket === b));
  const isShield = st.bucket === 'shield', isRedo = st.bucket === 'redo', isMissed = st.bucket === 'missed', isQuotes = st.bucket === 'quotes', isUnpaid = st.bucket === 'unpaid', rows = isShield ? shieldRows : isRedo ? redoRows : isUnpaid ? unpaid : isQuotes ? quotes : isMissed ? missed : pick(st.bucket), me = ctx.me;
  const tabs = BUCKETS.map(([k, t]) => { const n = k === 'shield' ? shieldOpen.length : k === 'redo' ? redoOpen.length : k === 'unpaid' ? unpaid.length : k === 'quotes' ? quotes.length : k === 'missed' ? missed.length : k === 'due' ? counts.overdue + counts.today : counts[k]; return `<button type="button" class="chip pick${k === st.bucket ? ' on' : ''}" data-fu-tab="${k}" aria-pressed="${k === st.bucket}">${esc(k === 'shield' ? 'Shield claims (' + n + ')' : k === 'redo' ? 'Redo requests (' + n + ')' : k === 'missed' ? 'Missed calls (' + n + ')' : k === 'quotes' ? 'Quotes waiting (' + n + ')' : k === 'unpaid' ? 'Not paid yet (' + n + ')' : t)}${k === 'shield' || k === 'redo' || k === 'missed' || k === 'quotes' || k === 'unpaid' ? '' : ' <b>' + n + '</b>'}</button>`; }).join('');
  const summary = `<p class="small muted">${counts.overdue} overdue · ${counts.today} due today · ${counts.later} later${counts.nodate ? ' · ' + counts.nodate + ' with no date' : ''}</p>`;
  root.innerHTML = head('Follow-ups', 'Overdue first, then due today. Call, message, snooze or close each one.') + summary + `<div class="filters fu-tabs" role="group">${tabs}</div>` +
    (isShield && smonth ? shieldMonthBar(smonth) : '') +
    (isShield && sOff ? emptyState({ title: 'Shield claims are not available yet.', text: 'The other tabs still work.' }) : isShield && !rows.length ? emptyState({ title: 'No Shield claims.', text: 'Customers can report damage from their tracking page within 48 hours of delivery.' }) : isRedo && rOff ? emptyState({ title: 'Redo requests are not available yet.', text: 'The other tabs still work.' }) : isRedo && !rows.length ? emptyState({ title: 'No redo requests.', text: 'Customers can ask from their tracking page within 30 days of a service.' }) : isUnpaid && uOff ? emptyState({ title: 'Not paid yet is not available yet.', text: 'The other tabs still work.' }) : isUnpaid && !rows.length ? emptyState({ title: 'No unpaid bookings.', text: 'Everyone who started a booking in the last 3 days has paid, or started under 15 minutes ago.' }) : isQuotes && qOff ? emptyState({ title: 'Quotes waiting is not available yet.', text: 'The other tabs still work.' }) : rows.length ? rows.map((l) => (isShield ? shieldCard(l, me, showMoney) : isRedo ? redoCard(l, me) : isUnpaid ? unpaidCard(l, me, showMoney) : isQuotes ? quoteCard(l, me, showMoney) : isMissed ? missedCard(l, me) : card(l, me, ctx, showMoney))).join('') : isQuotes ? emptyState({ title: 'No quotes waiting.', text: 'Every sent quote has an answer, or is under 2 hours old.' }) : emptyState({ title: isMissed ? 'No missed calls waiting.' : st.bucket === 'due' ? 'Nothing due. You are on top of it.' : 'Nothing here.', text: isMissed ? 'Every IVR call has been picked up or called back.' : st.bucket === 'due' ? 'Check Later for what is coming up.' : '' }));
  root.onclick = async (e) => {
    const t = e.target.closest('[data-fu-tab]'); if (t) { st.bucket = t.dataset.fuTab; return draw(root, ctx).catch((x) => toast(clean(x), true)); }
    if (e.target.closest('[data-shield-cap]')) return shieldCapDialog(smonth, () => draw(root, ctx));
    const sd = e.target.closest('[data-shield]'); if (sd) return shieldAct(sd.dataset.shield, sd.dataset.id, shieldRows.find((x) => x.id === sd.dataset.id), () => draw(root, ctx));
    const rd = e.target.closest('[data-redo]'); if (rd) return redoAct(rd.dataset.redo, rd.dataset.id, redoRows.find((x) => x.id === rd.dataset.id), ctx, () => draw(root, ctx));
    const b = e.target.closest('[data-fu]'); if (!b) return;
    const id = b.dataset.id, lead = queue.find((x) => x.id === id) || quotes.find((x) => x.id === id) || unpaid.find((x) => x.id === id), act = b.dataset.fu;
    if (act === 'call' || act === 'wa') return;   // plain links; the lead sheet logs the outcome
    if (act === 'open') return ctx.openLead(id, 'call');
    if (act === 'lost') return lostDialog(lead, ctx, () => draw(root, ctx));
    if (act === 'snooze') {
      const days = Number(b.dataset.days); b.disabled = true;
      try { await rpc('crm_log', { p_id: id, p_kind: 'note', p_body: 'Snoozed ' + (days === 1 ? 'until tomorrow' : days + ' days'), p_next_action: snoozeAt(days), p_status: null, p_lost_reason: null }); toast('Snoozed. It comes back ' + (days === 1 ? 'tomorrow' : 'in ' + days + ' days') + ' at 10 AM.'); await draw(root, ctx); }
      catch (err) { b.disabled = false; toast(clean(err), true); }
    }
  };
}

function shieldMonthBar(m) {
  const pct = m.cap > 0 ? Math.min(100, Math.round((Number(m.used) / Number(m.cap)) * 100)) : 0;
  return `<p class="small fu-card">This month, approved: <b>${rupee(m.used)}</b> of the <b>${rupee(m.cap)}</b> Shield cap (${pct}%). <button class="btn ghost" type="button" data-shield-cap="1">Change the cap</button></p>`;
}
function shieldCapDialog(m, done) {
  modal({
    title: 'Monthly Shield cap', intro: 'The most the company pays out in approved Shield claims in one calendar month. Approvals past it are refused until you raise it.', submit: 'Save the cap',
    body: field('Cap (₹ per month)', 'cap', { required: true, value: m ? String(m.cap) : '', hint: 'From 5,000 to 10,00,000.' }),
    onSubmit: async (f, v, close) => {
      const n = Number(v.cap); if (!(n >= 5000 && n <= 1000000)) throw new Error('The cap must be from 5,000 to 10,00,000.');
      await rpc('crm_shield_cap_set', { p_amount: n }); close(); toast('Cap saved.'); await done();
    },
  });
}
const SHIELD_LABEL = { open: 'Claim made', approved: 'Approved, to be paid', paid: 'Paid', declined: 'Declined' };
const RECOVER = [['none', 'Company bears it'], ['garage', 'Recover from the garage'], ['mechanic', 'Recover from the mechanic']];
function shieldCard(r, me, showMoney) {
  const when = r.created_at ? new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  const rec = (RECOVER.find((x) => x[0] === r.recover_from) || [])[1];
  return `<article class="fu-card fu-shield${r.status === 'open' ? ' fu-late' : ''}" data-id="${esc(r.lead_id)}">
    <div class="fu-main"><b>${esc(r.name || 'Customer')}</b> <small class="muted">${esc(r.ref || '')}</small>
      <p class="small">${chip(SHIELD_LABEL[r.status] + (r.status === 'open' ? ' ' + when : ''), r.status === 'declined' ? 'bad' : r.status === 'paid' ? '' : 'warn')} <span class="muted">${esc(r.area || '')}</span>${showMoney && r.amount != null ? ` <b>${rupee(r.amount)}</b>` : ''}${showMoney && rec && r.status !== 'declined' ? ` <span class="muted">${esc(rec)}</span>` : ''}</p>
      <p class="small">“${esc(r.description)}”${r.decision_note ? ` <span class="muted">Note: ${esc(r.decision_note)}</span>` : ''}</p>
      <p class="small muted">Check the pickup and delivery photos in the booking before you decide.</p></div>
    <div class="fu-act">
      <a class="btn call fu-bigcall" href="${telUrl(r.phone)}" data-fu="call" data-id="${esc(r.lead_id)}">Call</a>
      <a class="btn wa" href="${waUrl(r.phone, firstMessage({ name: r.name }, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(r.lead_id)}">WhatsApp</a>
      <button class="btn ghost" type="button" data-fu="open" data-id="${esc(r.lead_id)}">Open booking</button>
      ${r.status === 'open' && showMoney ? `<button class="btn" type="button" data-shield="approved" data-id="${esc(r.id)}">Approve</button>` : ''}
      ${r.status === 'approved' && showMoney ? `<button class="btn" type="button" data-shield="paid" data-id="${esc(r.id)}">Mark paid</button>` : ''}
      ${r.status === 'open' ? `<button class="btn ghost" type="button" data-shield="declined" data-id="${esc(r.id)}">Decline</button>` : ''}
    </div></article>`;
}

function shieldAct(decision, id, r, done) {
  if (!r) return;
  const label = { approved: 'Approve the claim', declined: 'Decline the claim', paid: 'Mark the claim paid' }[decision];
  modal({
    title: label + ' for ' + (r.name || 'customer'), intro: decision === 'approved' ? 'Up to ₹5,000 per job, paid by the company. Check the pickup and delivery photos first. The customer sees the amount and your note.' : decision === 'declined' ? 'The customer sees your reason on their tracking page.' : 'Record that the customer has been paid.', submit: label, danger: decision === 'declined',
    body: (decision === 'approved' ? field('Amount (₹, 1 to 5,000)', 'amount', { required: true, hint: 'Numbers only.' }) + field('Who bears the cost', 'recover', { type: 'select', blank: false, options: RECOVER }) : '') + field(decision === 'declined' ? 'Reason' : 'Note', 'note', { type: 'textarea', rows: 2, max: 300, required: decision === 'declined', hint: 'No Aadhaar, PAN or bank numbers.' }),
    onSubmit: async (f, v, close) => {
      if (decision === 'declined' && !String(v.note || '').trim()) throw new Error('Say why, so the customer knows.');
      const amt = decision === 'approved' ? Number(v.amount) : null;
      if (decision === 'approved' && !(amt >= 1 && amt <= 5000)) throw new Error('The amount must be from 1 to 5,000.');
      await rpc('crm_shield_decide', { p_id: id, p_decision: decision, p_amount: amt, p_note: String(v.note || '').trim() || null, p_recover: decision === 'approved' ? (v.recover || 'none') : 'none' });
      close(); toast('Saved.'); await done();
    },
  });
}

const REDO_TONE = { open: 'warn', approved: 'warn', declined: 'bad', done: '' };
function redoCard(r, me) {
  const live = r.status === 'open' || r.status === 'approved', when = r.created_at ? new Date(r.created_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
  return `<article class="fu-card fu-redo${r.status === 'open' ? ' fu-late' : ''}" data-id="${esc(r.lead_id)}">
    <div class="fu-main"><b>${esc(r.name || 'Customer')}</b> <small class="muted">${esc(r.ref || '')}</small>
      <p class="small">${chip(r.status === 'open' ? 'Redo asked ' + when : r.status === 'approved' ? 'Approved, to be done' : r.status === 'done' ? 'Done' : 'Declined', REDO_TONE[r.status] || '')} <span class="muted">${esc(r.area || '')}</span></p>
      <p class="small">“${esc(r.reason)}”${r.decision_note ? ` <span class="muted">Note: ${esc(r.decision_note)}</span>` : ''}</p></div>
    <div class="fu-act">
      <a class="btn call fu-bigcall" href="${telUrl(r.phone)}" data-fu="call" data-id="${esc(r.lead_id)}">Call</a>
      <a class="btn wa" href="${waUrl(r.phone, firstMessage({ name: r.name }, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(r.lead_id)}">WhatsApp</a>
      ${r.status === 'open' ? `<button class="btn" type="button" data-redo="approved" data-id="${esc(r.id)}">Approve</button><button class="btn ghost" type="button" data-redo="declined" data-id="${esc(r.id)}">Decline</button>` : ''}
      ${r.status === 'approved' ? `<button class="btn" type="button" data-redo="done" data-id="${esc(r.id)}">Mark done</button>` : ''}
      <button class="btn ghost" type="button" data-fu="open" data-id="${esc(r.lead_id)}">Open</button>
    </div></article>`;
}

function redoAct(decision, id, r, ctx, done) {
  if (!r) return;
  const label = { approved: 'Approve the redo', declined: 'Decline the redo', done: 'Mark the redo done' }[decision];
  modal({
    title: label + ' for ' + (r.name || 'customer'), intro: decision === 'declined' ? 'The customer sees your reason on their tracking page.' : 'The customer sees your note on their tracking page. Optional.', submit: label, danger: decision === 'declined',
    body: field(decision === 'declined' ? 'Reason' : 'Note', 'note', { type: 'textarea', rows: 2, max: 300, required: decision === 'declined', hint: 'No Aadhaar, PAN or bank numbers.' }),
    onSubmit: async (f, v, close) => {
      if (decision === 'declined' && !String(v.note || '').trim()) throw new Error('Say why, so the customer knows.');
      await rpc('crm_redo_decide', { p_id: id, p_decision: decision, p_note: String(v.note || '').trim() || null });
      close(); toast('Saved.'); await done();
    },
  });
}

function unpaidCard(l, me, showMoney) {
    return `<article class="fu-card fu-unpaid${l.older ? ' fu-late' : ''}" data-id="${esc(l.id)}">
    <div class="fu-main"><b>${esc(l.name || 'Customer')}</b> <small class="muted">${esc(l.ref || '')}</small>
      <p class="small">${vehicleTag(l.vehicle)} ${esc(l.service || "")} ${chip('Started booking ' + fmtMinutes(l.minutesWaiting) + ' ago', l.older ? 'bad' : 'warn')}${showMoney && l.confirm_fee != null ? ` <b>${rupee(l.confirm_fee)}</b>` : ''}</p></div>
    <div class="fu-act">
      <a class="btn call fu-bigcall" href="${telUrl(l.phone)}" data-fu="call" data-id="${esc(l.id)}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(l.id)}">WhatsApp</a>
      <button class="btn ghost" type="button" data-fu="open" data-id="${esc(l.id)}">Open</button>
      <button class="btn ghost" type="button" data-fu="lost" data-id="${esc(l.id)}">Mark lost</button>
    </div></article>`;
}

function quoteCard(l, me, showMoney) {
  return `<article class="fu-card fu-quote${l.stale ? ' fu-late' : ''}" data-id="${esc(l.id)}">
    <div class="fu-main"><b>${esc(l.name || 'Customer')}</b> <small class="muted">${esc(l.ref || '')}</small>
      <p class="small">${chip('Quote sent ' + fmtMinutes(l.minutesWaiting) + ' ago', l.stale ? 'bad' : 'warn')}${showMoney && l.total != null ? ` <b>${rupee(l.total)}</b>` : ''}</p></div>
    <div class="fu-act">
      <a class="btn call fu-bigcall" href="${telUrl(l.phone)}" data-fu="call" data-id="${esc(l.id)}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(l.id)}">WhatsApp</a>
      <button class="btn ghost" type="button" data-fu="open" data-id="${esc(l.id)}">Open</button>
      <button class="btn ghost" type="button" data-fu="lost" data-id="${esc(l.id)}">Mark lost</button>
    </div></article>`;
}

function missedCard(l, me) {
  const late = l.minutesWaiting > 60;
  return `<article class="fu-card fu-missed${late ? ' fu-late' : ''}" data-id="${esc(l.id)}">
    <div class="fu-main"><b>${esc(l.name || 'Unknown caller')}</b> <small class="muted">${esc(l.phone || '')}</small>
      <p class="small">${chip('Waiting ' + fmtMinutes(l.minutesWaiting), late ? 'bad' : 'warn')}</p></div>
    <div class="fu-act">
      <a class="btn call fu-bigcall" href="${telUrl(l.phone)}" data-fu="call" data-id="${esc(l.id)}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(l.id)}">WhatsApp</a>
      <button class="btn ghost" type="button" data-fu="lost" data-id="${esc(l.id)}">Mark lost</button>
    </div></article>`;
}

function card(l, me, ctx, showMoney) {
  const src = sourceName(l.utm_source || l.source), late = l.bucket === 'overdue';
  const due = l.crm_next_action_at ? new Date(l.crm_next_action_at).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : 'No follow-up date';
  const tone = late ? 'bad' : l.bucket === 'today' ? 'warn' : '';
  const who = ctx.can('view_all_leads') ? ` · ${esc(l.owner_name || 'No owner')}` : '';
  return `<article class="fu-card${late ? ' fu-late' : ''}" data-id="${esc(l.id)}">
    <div class="fu-main"><b>${esc(l.name)}</b>${vehicleTag(vehicleOf(l))} <small class="muted">${esc(src)}</small>
      <p class="small muted">${esc([l.bike, l.service_name, l.area].filter(Boolean).join(' · ') || 'No details yet')}</p>
      <p class="small">${chip((late ? 'Overdue · ' : l.bucket === 'today' ? 'Today · ' : '') + due, tone)}${showMoney && l.value ? ` <b>${rupee(l.value)}</b>` : ''}<span class="muted">${who}</span></p></div>
    <div class="fu-act">
      <a class="btn call" href="${telUrl(l.phone)}" data-fu="call" data-id="${esc(l.id)}">Call</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, me && me.name))}" target="_blank" rel="noopener" data-fu="wa" data-id="${esc(l.id)}">WhatsApp</a>
      <button class="btn" type="button" data-fu="snooze" data-days="1" data-id="${esc(l.id)}">Tomorrow</button>
      <button class="btn" type="button" data-fu="snooze" data-days="3" data-id="${esc(l.id)}">3 days</button>
      <button class="btn ghost" type="button" data-fu="open" data-id="${esc(l.id)}">Open</button>
      <button class="btn ghost" type="button" data-fu="lost" data-id="${esc(l.id)}">Mark lost</button>
    </div></article>`;
}

function lostDialog(lead, ctx, done) {
  if (!lead) return;
  modal({
    title: 'Mark ' + lead.name + ' as lost', intro: 'Pick the reason. This closes the lead.', submit: 'Mark lost', danger: true,
    body: field('Reason', 'reason', { type: 'select', options: LOST_REASONS.map((r) => [r, r]), required: true }) + field('Note', 'note', { type: 'textarea', rows: 2, hint: 'Needed for "Other". No Aadhaar, PAN or bank numbers.' }),
    onSubmit: async (f, v, close) => {
      const ok = lostReasonCheck(v.reason, v.note); if (!ok.ok) throw new Error(ok.error);
      await rpc('crm_log', { p_id: lead.id, p_kind: 'note', p_body: String(v.note || '').trim() || null, p_next_action: null, p_status: 'lost', p_lost_reason: v.reason });
      close(); toast('Marked lost.'); await done();
    },
  });
}
