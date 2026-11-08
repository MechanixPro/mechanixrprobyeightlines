import { rpc, esc, head, toast, clean, modal, field, vehicleTag } from '../ui.js';
import { emptyState, errorState, skeleton, chip } from '../ds.js';
import { LOST_REASONS, lostReasonCheck, sourceName, vehicleOf, telUrl, waUrl, firstMessage } from '../crm-rules.js';
import { followUpQueue, bucketCounts, snoozeAt, missedCallQueue, fmtMinutes, quotesWaiting, unpaidBookings } from '../speed.js';

// Follow-ups: open leads whose next follow-up is due, overdue first, then today, then later. One tap to call, WhatsApp, snooze or mark lost.
// Mine for an agent, everyone's for a supervisor. Money shows only to the admin (supervisors never see it).
const st = { bucket: null };
const BUCKETS = [['quotes', 'Quotes waiting'], ['unpaid', 'Not paid yet'], ['missed', 'Missed calls'], ['due', 'Overdue and today'], ['overdue', 'Overdue'], ['today', 'Today'], ['later', 'Later'], ['nodate', 'No date set']];
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
  if (!st.bucket) st.bucket = missed.length ? 'missed' : 'due';
  const queue = followUpQueue(raw), counts = bucketCounts(queue), showMoney = money(ctx);
  const pick = (b) => queue.filter((l) => (b === 'due' ? l.bucket === 'overdue' || l.bucket === 'today' : l.bucket === b));
  const isMissed = st.bucket === 'missed', isQuotes = st.bucket === 'quotes', isUnpaid = st.bucket === 'unpaid', rows = isUnpaid ? unpaid : isQuotes ? quotes : isMissed ? missed : pick(st.bucket), me = ctx.me;
  const tabs = BUCKETS.map(([k, t]) => { const n = k === 'unpaid' ? unpaid.length : k === 'quotes' ? quotes.length : k === 'missed' ? missed.length : k === 'due' ? counts.overdue + counts.today : counts[k]; return `<button type="button" class="chip pick${k === st.bucket ? ' on' : ''}" data-fu-tab="${k}" aria-pressed="${k === st.bucket}">${esc(k === 'missed' ? 'Missed calls (' + n + ')' : k === 'quotes' ? 'Quotes waiting (' + n + ')' : k === 'unpaid' ? 'Not paid yet (' + n + ')' : t)}${k === 'missed' || k === 'quotes' || k === 'unpaid' ? '' : ' <b>' + n + '</b>'}</button>`; }).join('');
  const summary = `<p class="small muted">${counts.overdue} overdue · ${counts.today} due today · ${counts.later} later${counts.nodate ? ' · ' + counts.nodate + ' with no date' : ''}</p>`;
  root.innerHTML = head('Follow-ups', 'Overdue first, then due today. Call, message, snooze or close each one.') + summary + `<div class="filters fu-tabs" role="group">${tabs}</div>` +
    (isUnpaid && uOff ? emptyState({ title: 'Not paid yet is not available yet.', text: 'The other tabs still work.' }) : isUnpaid && !rows.length ? emptyState({ title: 'No unpaid bookings.', text: 'Everyone who started a booking in the last 3 days has paid, or started under 15 minutes ago.' }) : isQuotes && qOff ? emptyState({ title: 'Quotes waiting is not available yet.', text: 'The other tabs still work.' }) : rows.length ? rows.map((l) => (isUnpaid ? unpaidCard(l, me, showMoney) : isQuotes ? quoteCard(l, me, showMoney) : isMissed ? missedCard(l, me) : card(l, me, ctx, showMoney))).join('') : isQuotes ? emptyState({ title: 'No quotes waiting.', text: 'Every sent quote has an answer, or is under 2 hours old.' }) : emptyState({ title: isMissed ? 'No missed calls waiting.' : st.bucket === 'due' ? 'Nothing due. You are on top of it.' : 'Nothing here.', text: isMissed ? 'Every IVR call has been picked up or called back.' : st.bucket === 'due' ? 'Check Later for what is coming up.' : '' }));
  root.onclick = async (e) => {
    const t = e.target.closest('[data-fu-tab]'); if (t) { st.bucket = t.dataset.fuTab; return draw(root, ctx).catch((x) => toast(clean(x), true)); }
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
