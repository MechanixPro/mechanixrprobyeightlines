// The paid-confirmation flow screens, shared by Crew and the Admin: Send payment link, the Call script, door code, mechanic assignment, the itemised quote with delivery estimate,
// phone approval, Ready and Delivered, the notification log with Resend, and the Dispatch list. ONE file: crm/flow-core.js is the source and admin/flow-core.js is a copy (a test checks they are identical).
// It holds no business rules of its own. Every action calls the same database functions and Edge Functions, which check who may do what (admins pass, agents and technicians keep their limits).
import { chip, emptyState, errorState, NOTICE_TONE, ISSUE_TONE } from './ds.js';
import { paidBadge, visitSub, callScript, quoteTotals, quoteCheck, QUOTE_KINDS, PART_TYPES, NOTICE_LABEL, resendable, dispatchOrder, confirmPending, confirmPaid, ISSUE_TYPES, seenLine, mapsUrl, issueOrder } from './flow-rules.js';
import { quoteStatus, validityLabel } from './quote-doc.js';
import { garageLabel, garageSeenChip, garageStepChips, isHandled } from './garage-assign.js';
import { statusOptions, statusJump, stateFromLead, approvalInfo, approveCheck, rejectCheck, refundStatus, refundMax, refundCheck, DELIVERY_STAGES, deliveryStages, deliveryVisible, deliveryCheck, deliveryNotifies, timelineKind, istStamp, legacyTimeline } from './manage-rules.js';
import { tellMessage, tellUrl, toldInfo, toldLabel, notToldYet, toldNoteBody, mechanicWaPhone } from './tell-mechanic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const SLOT = { asap: 'As soon as possible', morning: 'Morning 9 to 12', afternoon: 'Afternoon 12 to 4', evening: 'Evening 4 to 8' };
const STAGE = { on_the_way: 'On the way', arrived: 'Arrived', started: 'Door code verified', repair_doorstep: 'Repair at the door', picked_up: 'Picked up', ready: 'Ready', returned: 'Delivered' };
const DOOR = { none: 'No code yet', open: 'Code ready', locked: 'Locked after 5 wrong tries', expired: 'Code expired', verified: 'Verified at the door' };
const cleanErr = (e) => { const m = String((e && e.message) || e || 'Something went wrong').replace(/^Error:\s*/, ''); const KNOWN = [[/waiting for the confirmation fee/i, 'This booking cannot go to a garage yet: the customer has not paid the confirmation fee. Send the payment link or record the payment on the booking, then assign.'], [/this lead is closed/i, 'This booking is closed (lost or junk). Restore it first.'], [/not paid|has not paid|unpaid/i, 'The customer has not paid the confirmation fee yet. Send the payment link or record the payment, then assign.'], [/already started this job/i, 'The garage has already started this job, so it cannot be moved.']]; const known = KNOWN.find((k) => k[0].test(m)); if (known) return known[1]; return /crm_garage_(assign|picker)/.test(m) && /find the function|schema cache|does not exist/i.test(m) ? 'Assign to garage is not available yet.' : m; };

/** deps: { refundNow?(leadId) (Admin only: called after a refund was sent, reloads), rpc(name, args), invoke(fn, body), toast(msg, bad), can(action), reload(), mechanics?() , openLead?(id) } */
export function createFlow(deps) {
  const { rpc, invoke, toast } = deps;
  const call = async (fn, body) => { const r = await invoke(fn, body); if (r && r.error) throw new Error(r.error); return r; };

  /* ----- a small modal of our own, so Crew and the Admin look and behave the same ----- */
  const dialog = (o) => (deps.dialogImpl ? deps.dialogImpl(o) : ownDialog(o));   // tests pass dialogImpl; the pages use the modal below
  function ownDialog({ title, intro, body, submit, onSubmit, onOpen }) {
    const wrap = document.createElement('div'); wrap.className = 'flow-modal'; wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', title);
    wrap.innerHTML = `<form class="flow-box" novalidate><h3>${esc(title)}</h3>${intro ? `<p class="flow-muted">${intro}</p>` : ''}${body || ''}<p class="flow-err" role="alert"></p><div class="flow-btns"><button class="flow-btn flow-ghost" type="button" data-close>Close</button>${submit ? `<button class="flow-btn flow-primary" type="submit">${esc(submit)}</button>` : ''}</div></form>`;
    document.body.appendChild(wrap);
    const form = wrap.firstElementChild, err = form.querySelector('.flow-err'), close = () => { wrap.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); if (!onSubmit) return; const btn = form.querySelector('button[type=submit]'); err.textContent = ''; btn.disabled = true;
      try { await onSubmit(form, { close, say: (m) => { err.textContent = m; } }); } catch (x) { err.textContent = cleanErr(x); } finally { btn.disabled = false; }
    });
    if (onOpen) onOpen(form, { close });
    const first = form.querySelector('input,select,textarea,button'); if (first) first.focus();
    return { form, close };
  }
  const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copied.'); } catch (e) { toast('Copy failed. Select the text and copy it.', true); } };

  /* ----- what the card needs, fetched in one go. Each part may fail on its own (an older database) without breaking the sheet. ----- */
  async function load(leadId) {
    // A part that fails is NOT shown as "none yet": its name goes into `failed`, and the card says so with a Retry button.
    const failed = [], safe = (name, p) => p.then((x) => x, () => { failed.push(name); return null; });
    // The newer parts (state, assignment, estimates, refunds) fail on their own: their section says "could not load" with Retry, and nothing else is blanked.
    const failedParts = [], part = (name, p) => p.then((x) => x, () => { failedParts.push(name); return null; });
    const gd = deps.garageDesk && deps.garageDesk.visible();   // partner garage: only for people who may manage garages
    const [conf, notes, quote, updates, seen, garage, check, cancel, state, info, est, refunds] = await Promise.all([safe('payment status', rpc('crm_confirmation', { p_lead: leadId })), safe('messages', rpc('crm_notifications', { p_lead: leadId })), safe('quote', rpc('crm_quote_get', { p_lead: leadId })),
      safe('customer details', rpc('crm_booking_updates', { p_lead: leadId })), safe('mechanic location', rpc('crm_tech_location', { p_lead: leadId })),
      gd ? safe('partner garage', deps.garageDesk.forLead(leadId)) : Promise.resolve(null), safe('Pro Check', rpc('crm_job_check', { p_lead: leadId })), safe('cancellation', rpc('crm_cancel_info', { p_lead: leadId })),
      part('status', rpc('crm_booking_state', { p_lead: leadId })), gd ? part('garage or partner', rpc('crm_assignment_info', { p_lead: leadId })) : Promise.resolve(null),
      part('estimates', rpc('crm_booking_estimates', { p_lead: leadId })), part('refunds', rpc('crm_booking_refunds', { p_lead: leadId }))]);
    return { conf, notes: notes || [], quote, updates, seen, garage, check, cancel, state, info, est, refunds, failedParts, failed };
  }
  /** Fold the confirmation fields into the lead the step bar reads. */
  const withFlow = (lead, flow) => (flow && flow.conf ? { ...lead, confirm_fee: flow.conf.fee, confirm_paid_at: flow.conf.paid ? (flow.conf.paid_at || 'paid') : null, visit_stage: flow.conf.stage, quote_state: flow.conf.quote ? flow.conf.quote.status : null } : lead);

  /* ----- the card ----- */
  function card(lead, flow) {
    const l = withFlow(lead, flow), c = flow && flow.conf, can = deps.can;
    if (['lost', 'junk'].includes(l.status)) return '';
    if (l.status === 'cancelled') return cancelledCard(flow && flow.cancel, flow);
    const badge = paidBadge(l), sub = visitSub(l), bt = [];
    const open = !confirmPaid(l) && !['completed'].includes(l.status);
    const amount = c && c.fee != null ? c.fee : null;
    if (badge) bt.push(chip(badge.text, badge.tone));
    if (c && c.review) bt.push(chip('Fee needs a check', 'warn'));
    if (sub) bt.push(chip(sub.label));
    let h = `<section class="flow-card" aria-label="Paid confirmation"><h3>Paid confirmation ${bt.join(' ')}</h3>`;
    if (flow && flow.failed && flow.failed.length) h += `<div data-flow-failed>${errorState({ title: 'Could not load: ' + flow.failed.join(', '), detail: 'What you see may be incomplete.', retry: { label: 'Retry', attr: 'data-flow="reloadFlow"' } })}</div>`;
    if (open && (can('send_payment_link') || can('assign_leads'))) {
      h += `<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-flow="payLink">${confirmPending(l) ? 'Resend payment link' : 'Send payment link'}</button></div>`;
      h += `<details class="flow-script" open><summary>Call script</summary><p>${esc(callScript(amount ?? '49 to 99'))}</p><button class="flow-btn flow-ghost" type="button" data-flow="copyScript" data-amount="${esc(amount ?? '')}">Copy script</button></details>`;
      if (c && c.link_sent_at) h += `<p class="flow-muted">Link sent ${esc(when(c.link_sent_at))}. If it is unpaid after ${esc(c.nudge_minutes)} minutes the team is reminded.</p>`;
    }
    if (confirmPaid(l)) {
      if (c) h += `<p class="flow-muted">Paid ${esc(when(c && c.paid_at))}. Door code: <b>${esc(DOOR[c && c.door] || '')}</b>${c && c.stage ? ' · Visit: <b>' + esc(STAGE[c.stage] || c.stage) + '</b>' : ''}</p>`;
      const row = [];
      if ((can('assign_leads') || can('manage_technicians')) && l.mechanic_name) row.push('<button class="flow-btn" type="button" data-flow="jobLink">Job link for the mechanic</button>');
      if (c && c.door !== 'verified') row.push('<button class="flow-btn" type="button" data-flow="doorCode">Show customer code</button><button class="flow-btn" type="button" data-flow="newDoorCode">New code</button>');
      if (row.length) h += `<div class="flow-row">${row.join('')}</div>`;
      h += quoteBlock(l, flow) + checkBlock(flow);
      if (deps.garageDesk && deps.garageDesk.visible()) h += assignBlock(l, flow);
      h += deliveryBlock(l, flow);
    }
    h += seenBlock(l, flow) + customerBlock(flow);
    const rs = resendable(flow && flow.notes);
    if (flow && flow.notes && flow.notes.length) {
      h += `<h4>Messages</h4><ul class="flow-list">${flow.notes.map((n) => { const k = String(n.kind).split(':'); return `<li>${chip(n.status, NOTICE_TONE[n.status] || '')} ${esc(NOTICE_LABEL[k[0]] || n.kind)}${k[1] ? ' v' + esc(k[1]) : ''} <small class="flow-muted">${esc(when(n.at))}${n.error ? ' · ' + esc(n.error) : ''}</small>${rs.includes(n) ? ` <button class="flow-btn flow-sm" type="button" data-flow="resend" data-kind="${esc(k[0])}" data-n="${esc(k[1] || '')}">Resend</button>` : ''}</li>`; }).join('')}</ul>`;
    }
    if ((confirmPaid(l) || ['paid', 'scheduled'].includes(l.status)) && l.status !== 'completed') h += '<div class="flow-row"><button class="flow-btn flow-ghost" type="button" data-flow="cancel">Cancel booking</button></div>';
    if (flow && flow.refunds && flow.refunds.rows && flow.refunds.rows.length) h += refundBlock(null, flow);
    return h + '</section>';
  }
  const CANCEL_KIND = [['customer', 'The customer cancelled'], ['company', 'We cancelled'], ['unreachable', 'We could not reach the customer']];
  const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN');
  /** The booking is cancelled: the badge, why and who, and the refund history. Only the Admin host (deps.openRefund) gets the Refund button. */
  function cancelledCard(c, flow) {
    const kind = (CANCEL_KIND.find((k) => k[0] === (c && c.kind)) || [0, ''])[1];
    let h = `<section class="flow-card" aria-label="Cancelled booking"><h3>Cancelled ${chip('Cancelled', 'warn')}</h3>`;
    if (!c) return h + '<p class="flow-muted">Cancellation details could not be loaded.</p></section>';
    h += `<p>${esc(kind)}${c.reason ? ': ' + esc(c.reason) : ''}${c.at ? ' · ' + esc(when(c.at)) : ''}${c.by_name || c.by ? ' · by ' + esc(c.by_name || c.by) : ''}</p>`;
    if (c.refund_outstanding > 0) h += `<p><b>Refund due ${inr(c.refund_outstanding)}.</b> ${deps.openRefund ? '' : 'An Admin approves and records it.'}</p>`;
    else h += `<p class="flow-muted">${c.refund_due > 0 ? 'The refund has been recorded.' : 'No refund is due.'}</p>`;
    h += refundBlock(c, flow);
    return h + '</section>';
  }
  /** Cancellation and refund: history table from crm_booking_refunds. The Refund button, gateway reference and manual record exist for the Admin host only. */
  function refundBlock(c, flow) {
    const r = flow && flow.refunds, admin = !!deps.openRefund;
    let h = '<h4>Cancellation and refund</h4>';
    if (!r) return h + `<div data-flow-part="refunds">${partFailed(flow, 'refunds', 'The refund history could not load.')}</div>`;
    h += `<p class="flow-muted">Paid ${esc(inr(r.paid))} · Refunded ${esc(inr(r.refunded))} · Can still be refunded ${esc(inr(r.refundable))}${r.refund_due > 0 ? ' · <b>Refund due ' + esc(inr(r.refund_due)) + '</b>' : ''}</p>`;
    const rows = r.rows || [];
    if (rows.length) h += `<div class="flow-scroll"><table class="gd-lines" data-refunds><thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Status</th>${admin ? '<th>Reference</th>' : ''}<th>By</th></tr></thead><tbody>${rows.map((x) => { const [t, tone] = refundStatus(x.status); return `<tr><td>${esc(when(x.created_at))}</td><td class="gd-n">${esc(inr(x.amount))}</td><td>${esc(x.kind === 'manual' ? 'Manual' : x.method || x.kind || '')}</td><td>${chip(t, tone)}</td>${admin ? `<td>${esc(x.reference || '')}</td>` : ''}<td>${esc(x.created_by_name || '')}${x.reason ? '<br><small class="flow-muted">' + esc(x.reason) + '</small>' : ''}</td></tr>`; }).join('')}</tbody></table></div>`;
    else h += '<p class="flow-muted">No refund has been made.</p>';
    if (admin && refundMax(r) > 0) h += '<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-flow="refundOpen">Refund</button></div>';
    return h;
  }
  /** A small inline "could not load" with Retry, for one section. Never blanks the sheet. */
  const partFailed = (flow, name, text) => (flow && flow.failedParts && flow.failedParts.includes(name) ? `<p class="flow-muted" role="alert">${esc(text)} <button class="flow-btn flow-sm" type="button" data-flow="reloadFlow">Retry</button></p>` : '');
  const outcomeHtml = (o) => `<b>${esc(o.reason)}</b><br>${o.refundable && o.amount > 0 ? 'Refund due: <b>' + inr(o.amount) + '</b>. An Admin approves and records it.' : o.paid > 0 ? 'No refund. ' + inr(o.paid) + ' is kept.' : 'Nothing was paid, so no refund.'}<br><small>The slot start is estimated from the slot name (morning 9:00, afternoon 12:00, evening 16:00).</small>`;
  /* Pro Check 20 result: counts, the points that need attention and the test ride. Read only; the mechanic or garage fills it in the app. */
  const CHK_RIDE = { done_fine: 'Test ride done, all fine', done_note: 'Test ride done, something to note', not_done: 'Test ride not done' };
  function checkBlock(flow) {
    const c = flow && flow.check, r = c && c.results; if (!r || !r.points || !Object.keys(r.points).length) return '';
    const pts = Object.entries(r.points), ok = pts.filter(([, v]) => v.r === 'ok').length, att = pts.filter(([, v]) => v.r === 'needs_attention'), sk = pts.length - ok - att.length;
    const nice = (k) => k.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
    let h = `<h4>Pro Check 20 ${c.complete ? chip('Complete', 'good') : chip(pts.length + ' of 20 so far', 'warn')}</h4><p class="flow-muted">${ok} OK${att.length ? ', <b>' + att.length + ' need attention</b>' : ''}${sk ? ', ' + sk + ' skipped' : ''}.${r.test_ride ? ' ' + esc(CHK_RIDE[r.test_ride.r] || '') + (r.test_ride.r === 'not_done' && r.test_ride.why ? ' (' + esc(String(r.test_ride.why).replace(/_/g, ' ')) + ')' : '') + '.' : ''}</p>`;
    if (att.length) h += `<ul class="flow-list">${att.map(([k, v]) => `<li><b>${esc(nice(k))}</b>${v.n ? ': ' + esc(v.n) : ''}</li>`).join('')}</ul>`;
    return h;
  }
  /* Mechanic last seen: only while On the way or Arrived. The same line is in the Dispatch list. */
  function seenBlock(l, flow) {
    const sn = flow && flow.seen, stage = flow && flow.conf && flow.conf.stage;
    if (!l.mechanic_name || !['on_the_way', 'arrived'].includes(stage)) return '';
    if (!sn || !sn.seen) return stage === 'on_the_way' ? '<p class="flow-muted" data-seen>No live location shared yet. The mechanic taps Share my live location on the job page.</p>' : '';
    const line = seenLine(sn.age_s), url = mapsUrl(sn.lat, sn.lng);
    return `<p data-seen><b>${esc(line)}</b>${url ? ` · <a href="${esc(url)}" target="_blank" rel="noopener">Open in Maps</a>` : ''}</p>`;
  }
  /* What the customer added (details, photos) and the issues they reported, with Resolve. */
  function customerBlock(flow) {
    const u = flow && flow.updates; if (!u) return '';
    const d = u.details || {}, rows = [['Landmark', d.landmark], ['Gate or parking', d.access_note], ['Registration', d.reg_no], ['Kilometres', d.kms != null ? String(d.kms) : null], ['About the vehicle', d.vehicle_note], ['What the customer says is wrong', d.issue_text]].filter((r) => r[1]);
    const issues = u.issues || [], open = issues.filter((i) => i.status === 'open').length;
    if (!rows.length && !u.photo_count && !issues.length) return '';
    let h = `<h4>Added by customer ${open ? chip(`${open} open ${open === 1 ? 'issue' : 'issues'}`, 'bad') : ''}</h4>`;
    if (rows.length) h += `<dl class="flow-kv">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`;
    if (u.photo_count) h += u.photos && u.photos.length ? `<div class="flow-row"><button class="flow-btn" type="button" data-flow="showPhotos">See ${esc(u.photos.length)} customer ${u.photos.length === 1 ? 'photo' : 'photos'}</button></div>` : `<p class="flow-muted">${esc(u.photo_count)} customer ${u.photo_count === 1 ? 'photo' : 'photos'} (supervisors and the Technician lead can open them).</p>`;
    if (issues.length) h += `<ul class="flow-list">${issues.map((i) => `<li>${chip(i.status === 'open' ? 'Open' : 'Resolved', ISSUE_TONE[i.status] || 'good')} <b>${esc(ISSUE_TYPES[i.category] || i.category)}</b>: ${esc(i.body)}<br><span class="flow-muted">${esc(when(i.created_at))}${i.status === 'resolved' ? ` · resolved by ${esc(i.resolved_by || 'the team')} ${esc(when(i.resolved_at))}${i.note ? ' · ' + esc(i.note) : ''}` : ''}</span>${i.status === 'open' ? ` <button class="flow-btn flow-sm" type="button" data-flow="resolveIssue" data-id="${esc(i.id)}">Resolve</button>` : ''}</li>`).join('')}</ul>`;
    return h;
  }
  /* The one "Garage or partner" section: who has the job, its step, seen or not, return ETA, who assigned it and when, the history, and the single Assign / Reassign button (one dialog, shared with Dispatch and the Garage app tab). */
  function assignBlock(l, flow) {
    const info = flow && flow.info;
    let h = '<h4>Garage or partner</h4>';
    if (!info) return h + (partFailed(flow, 'garage or partner', 'The garage or partner could not load.') || '<p class="flow-muted">Not loaded.</p>') + '<div class="flow-row"><button class="flow-btn" type="button" data-flow="garageAssign">Assign</button></div>';
    const g = info.garage, hist = info.history || [], has = !!(g || info.outside);
    if (g) {
      const row = { garage_id: g.id, garage_seen_at: g.seen_at, garage_status: g.status, garage_assigned_at: g.assigned_at, preferred_date: l.preferred_date };
      const seenC = garageSeenChip(row, deps.now ? deps.now() : new Date()), steps = garageStepChips(row, deps.now ? deps.now() : new Date());
      const [t, tone] = ASSIGN_STEP[g.status] || [String(g.status || ''), ''];
      h += `<p data-assigned><b>${esc(g.name)}</b>${g.code ? ' <span class="flow-muted">' + esc(g.code) + '</span>' : ''} ${g.status ? chip(t, tone) : ''} ${seenC ? chip(seenC.text, seenC.tone) : ''} ${steps.filter((x) => x.tone === 'bad').map((x) => chip(x.text, x.tone)).join(' ')}</p>`;
      const meta = [g.eta ? 'Return expected ' + when(g.eta) : '', g.assigned_by_name || g.assigned_at ? 'Assigned' + (g.assigned_by_name ? ' by ' + g.assigned_by_name : '') + (g.assigned_at ? ' on ' + when(g.assigned_at) : '') : ''].filter(Boolean);
      if (meta.length) h += `<p class="flow-muted">${meta.map(esc).join(' · ')}</p>`;
      if (deps.adminView && g.phone_for_admin) h += `<p class="flow-muted">Garage phone (Admin only): <a href="tel:${esc(String(g.phone_for_admin).replace(/[^0-9+]/g, ''))}">${esc(g.phone_for_admin)}</a></p>`;
      if (g.notes) h += `<p class="flow-muted">Note: ${esc(g.notes)}</p>`;
    } else if (info.outside) h += `<p data-assigned><b>${esc(info.outside)}</b> ${chip('Outside partner', 'info')}</p>`;
    else h += '<p class="flow-muted" data-assigned>Not assigned yet.</p>';
    h += `<div class="flow-row"><button class="flow-btn${has ? '' : ' flow-primary'}" type="button" data-flow="garageAssign"${g ? ` data-move="${esc(g.id)}"` : ''}${has ? ' data-re="1"' : ''}>${has ? 'Reassign' : 'Assign'}</button></div>`;
    if (hist.length) h += `<details class="flow-script"><summary>Assignment history (${hist.length})</summary><ul class="flow-list">${hist.map((x) => `<li>${esc(x.garage)} · ${esc((ASSIGN_STEP[x.status] || [x.status])[0])} <small class="flow-muted">${esc(when(x.at))}</small></li>`).join('')}</ul></details>`;
    return h;
  }
  const ASSIGN_STEP = { sent: ['Sent', 'info'], received: ['Received', 'info'], in_work: ['In work', 'warn'], ready: ['Ready', 'good'], returned: ['Returned', 'good'], cancelled: ['Moved or removed', ''], outside: ['Outside partner', 'info'] };

  /* Delivery management: only the buttons that make sense for the state. */
  const stateOf = (l, flow) => (flow && flow.state && flow.state.state) || stateFromLead(l);
  function deliveryBlock(l, flow) {
    const st = stateOf(l, flow); if (!deliveryVisible(st)) return '';
    const stages = deliveryStages(st);
    let h = '<h4>Delivery management</h4>';
    if (flow && flow.failedParts && flow.failedParts.includes('status')) h += partFailed(flow, 'status', 'The booking status could not load.');
    h += `<p class="flow-muted" data-delivery-state>${esc(((flow && flow.state && flow.state.label) || (statusOptions(st).find((o) => o.value === st) || {}).label) || '')}</p>`;
    if (!stages.length) return h + '<p class="flow-muted">Nothing more to do: the booking is closed.</p>';
    return h + `<div class="flow-row">${stages.map((k) => `<button class="flow-btn${k === 'delivered' ? ' flow-primary' : ''}" type="button" data-flow="deliver" data-stage="${k}">${esc(DELIVERY_STAGES[k].button)}</button>`).join('')}</div>`;
  }

  /* Estimate pieces: customer approval, garage estimates to review, and the full history. */
  const estLines = (lines) => `<table class="gd-lines"><tbody>${(lines || []).map((x) => `<tr><td>${esc(({ parts: 'Parts', labour: 'Labour', other: 'Other' })[x.kind] || x.kind || '')}</td><td>${esc(x.name)}</td><td class="gd-n">${esc(inr(x.amount))}</td></tr>`).join('')}</tbody></table>`;
  const EST_LABEL = { submitted: ['To review', 'warn'], converted: ['Approved', 'good'], rejected: ['Rejected', 'bad'] };
  function approvalBlock(flow) {
    const est = flow && flow.est; if (!est) return partFailed(flow, 'estimates', 'The estimates could not load.');
    const ap = approvalInfo(est.approval); if (!ap) return '';
    const bits = [ap.detail, est.approval && est.approval.decided_at ? when(est.approval.decided_at) : ''].filter(Boolean).join(' · ');
    return `<p data-approval>${chip(ap.text, ap.tone)}${bits ? ' <span class="flow-muted">' + esc(bits) + '</span>' : ''}${ap.remarks ? `<br><span class="flow-muted">${esc(ap.remarks)}</span>` : ''}</p>`;
  }
  function garageEstimates(l, flow) {
    const est = flow && flow.est; if (!est) return '';
    const mayReview = !!(deps.garageDesk && deps.garageDesk.visible());
    return (est.garage_estimates || []).filter((e) => e.status === 'submitted').map((e) => {
      const sub = (e.lines || []).reduce((n, x) => n + (Number(x.amount) || 0), 0);
      return `<div class="flow-est" data-estimate="${esc(e.id)}"><p><b>Garage estimate</b> from ${esc(e.garage)} ${chip('To review', 'warn')}</p>${estLines(e.lines)}<p>Before GST ${esc(inr(sub))}</p><p class="flow-muted">${e.hours ? 'About ' + esc(e.hours) + ' hours' : e.return_day ? 'Return on ' + esc(e.return_day) : 'No time given'} · sent ${esc(when(e.submitted_at))}</p>${e.notes ? `<p>${esc(e.notes)}</p>` : ''}
        ${mayReview ? `<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-flow="estApprove" data-est="${esc(e.id)}">Approve</button><button class="flow-btn flow-ghost" type="button" data-flow="estReject" data-est="${esc(e.id)}">Reject</button><button class="flow-btn" type="button" data-flow="estEdit" data-est="${esc(e.id)}">Edit estimate</button></div>` : ''}</div>`;
    }).join('');
  }
  function estimateHistory(flow) {
    const est = flow && flow.est; if (!est) return '';
    const items = [...(est.quotes || []).map((q) => ({ at: q.decided_at || q.sent_at, k: 'q', q })), ...(est.garage_estimates || []).map((e) => ({ at: e.reviewed_at || e.submitted_at, k: 'g', e }))].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    if (!items.length) return '';
    return `<details class="flow-script" data-est-history><summary>View estimate history (${items.length})</summary><ul class="flow-list">${items.map((it) => {
      if (it.k === 'q') { const q = it.q, ql = quoteStatus(q); const who = q.decided_by_name ? ' · ' + q.decided_by_name + (q.decided_method ? ' (' + (q.decided_method === 'whatsapp' ? 'WhatsApp' : q.decided_method === 'phone' ? 'phone' : q.decided_method) + ')' : '') : q.decided_via === 'customer' ? ' · the customer' : '';
        return `<li>${chip(ql.label, ql.tone)} <b>Quote v${esc(q.version)}</b>${q.quote_no ? ' · ' + esc(q.quote_no) : ''} · ${esc(inr(q.total))}<br><small class="flow-muted">${q.sent_at ? 'Sent ' + esc(when(q.sent_at)) : ''}${q.decided_at ? ' · decided ' + esc(when(q.decided_at)) : ''}${esc(who)}${q.decided_remarks ? ' · ' + esc(q.decided_remarks) : ''}${q.change_request ? ' · asked: ' + esc(q.change_request) : ''}</small></li>`; }
      const e = it.e, [t, tone] = EST_LABEL[e.status] || [e.status, ''];
      return `<li>${chip(t, tone)} <b>Garage estimate</b> · ${esc(e.garage)}<br><small class="flow-muted">Sent ${esc(when(e.submitted_at))}${e.reviewed_at ? ' · reviewed ' + esc(when(e.reviewed_at)) : ''}${e.reviewed_by_name ? ' by ' + esc(e.reviewed_by_name) : ''}${e.review_note ? ' · ' + esc(e.review_note) : ''}</small></li>`; }).join('')}</ul></details>`;
  }
  function quoteBlock(l, flow) {
    const q = flow && flow.quote, latest = q && q.latest, c = flow && flow.conf, can = deps.can;
    if (!(can('assign_leads') || can('manage_technicians') || can('edit_leads'))) return '';
    const stageOk = ['started', 'repair_doorstep', 'picked_up', 'ready'].includes(c && c.stage);
    let h = '<h4>Quote and delivery estimate</h4>';
    if (!latest) h += `<p class="flow-muted">${stageOk ? 'The mechanic has checked the vehicle. Build the itemised quote.' : 'The quote comes after the mechanic arrives and the customer’s code is verified.'}</p>`;
    else h += `<p>Version <b>${esc(latest.version)}</b> · <b>${esc(quoteStatus(latest).label)}</b>${latest.quote_no ? ' · ' + esc(latest.quote_no) : ''}${latest.valid_until ? ' · ' + esc(validityLabel(latest)) : ''} · total ${esc(inr(latest.total))} incl. GST · balance ${esc(inr(latest.balance))}<br><span class="flow-muted">Delivery: ${esc(latest.eta_text || 'not set')}</span></p>`;
    h += approvalBlock(flow) + garageEstimates(l, flow);
    const row = [];
    if (stageOk) row.push(`<button class="flow-btn flow-primary" type="button" data-flow="quote">${latest && latest.status !== 'draft' ? 'Revise quote' : 'Build quote'}</button>`);
    if (latest && latest.status === 'draft') row.push('<button class="flow-btn flow-primary" type="button" data-flow="sendDraft">Send approved estimate to customer</button>');
    const pending = flow && flow.est ? flow.est.approval && flow.est.approval.status === 'pending' : !!(latest && latest.status === 'sent');
    if (pending) row.push('<button class="flow-btn flow-primary" type="button" data-flow="approveOnBehalf">APPROVE ON BEHALF OF CUSTOMER</button>');
    if (latest && ['sent', 'approved'].includes(latest.status)) row.push('<button class="flow-btn" type="button" data-flow="eta">Update delivery estimate</button>');
    if (latest && latest.status !== 'draft' && deps.quoteDoc) { if (deps.quoteDoc.open) row.push('<button class="flow-btn" type="button" data-flow="quoteDoc">Quote document</button>'); row.push('<button class="flow-btn" type="button" data-flow="quoteLink">Copy customer link</button>'); }
    if (latest && latest.status === 'changes_requested' && latest.change_request && !(flow.est && approvalInfo(flow.est.approval) && approvalInfo(flow.est.approval).remarks)) h += `<p class="flow-muted">Customer asked for changes: ${esc(latest.change_request)}</p>`;
    if (row.length) h += `<div class="flow-row">${row.join('')}</div>`;
    h += estimateHistory(flow);
    if (!(flow && flow.est) && q && q.versions && q.versions.length > 1) h += `<ul class="flow-list">${q.versions.map((v) => `<li>v${esc(v.version)} ${esc(quoteStatus(v).label)}${v.decided_via ? ' · by ' + esc(v.decided_via === 'phone' ? 'phone, recorded by ' + (v.decided_by || 'the team') : 'the customer') : ''}${v.decline_reason ? ' · ' + esc(v.decline_reason) : ''}</li>`).join('')}</ul>`;
    return h;
  }

  /* ----- actions ----- */
  const actions = {
    quoteDoc(lead) { if (deps.quoteDoc && deps.quoteDoc.open) return deps.quoteDoc.open(lead.id); },
    quoteLink(lead) { if (deps.quoteDoc) return deps.quoteDoc.copyLink(lead.id); },
    async payLink(lead) {
      dialog({ title: 'Send the payment link', intro: `The confirmation fee for ${esc(lead.name)} is worked out from the vehicle and engine size. You cannot type another amount here.`,
        body: `<label class="flow-label" for="fl-email">Customer email (needed for the confirmation and code)</label><input id="fl-email" name="email" type="email" inputmode="email" autocomplete="off" placeholder="name@example.com"><label class="flow-check"><input type="checkbox" name="wa" checked> Send it on WhatsApp now</label><div id="fl-res"></div>`,
        submit: 'Create and send link', onSubmit: async (f, d) => {
          const r = await call(deps.paymentFn || 'desk-payment-link', { lead_id: lead.id, purpose: 'confirm', email: f.email.value.trim() || undefined, send_whatsapp: f.wa.checked });
          const note = r.whatsapp_sent ? 'Sent on WhatsApp.' : r.whatsapp_note === 'not_connected' ? 'WhatsApp sending is not connected, so share the message yourself.' : 'Not sent on WhatsApp. Share the message yourself.';
          f.querySelector('#fl-res').innerHTML = `<p class="flow-ok"><b>₹${esc(r.amount)}</b> link ready. ${esc(note)}${r.review ? ' The engine size is not clear: please check the fee.' : ''}${r.has_email ? '' : ' No email yet: the confirmation will wait until you add one.'}</p><p class="flow-box2">${esc(r.url)}</p>
            <div class="flow-row"><button class="flow-btn" type="button" id="fl-copy">Copy message</button><a class="flow-btn" target="_blank" rel="noopener" href="https://wa.me/91${esc(String(lead.phone).slice(-10))}?text=${encodeURIComponent(r.whatsapp_text)}">Open in WhatsApp</a></div>`;
          f.querySelector('#fl-copy').addEventListener('click', () => copy(r.whatsapp_text)); f.querySelector('button[type=submit]').remove(); deps.reload();
        } });
    },
    reloadFlow() { deps.reload(); },
    refund(lead) { return deps.openRefund && deps.openRefund(lead.id); },
    /** Admin only (the host provides deps.openRefund): the Refund button on the Cancellation and refund block. */
    refundOpen(lead, flow) { return deps.openRefund && refundDialog({ lead_id: lead.id, label: [lead.booking_id, lead.area].filter(Boolean).join(' · '), outstanding: refundMax(flow && flow.refunds, Number(flow && flow.cancel && flow.cancel.refund_outstanding) || 0) }); },
    /** Admin only (the host provides deps.refundNow): refund through the payment gateway in one step. The server checks the Admin again and what can be refunded. */
    refundNow(lead, flow) { return deps.refundNow && refundDialog({ lead_id: lead.id, label: [lead.booking_id, lead.area].filter(Boolean).join(' · '), outstanding: refundMax(flow && flow.refunds, Number(flow && flow.cancel && flow.cancel.refund_outstanding) || 0) }); },
    /** Cancel a booking: who cancelled, what the refund policy says, a reason. Admin may overrule the refund; the database checks it again. */
    async cancel(lead) {
      const canOver = !!(deps.canOverrideRefund && deps.canOverrideRefund());
      const first = await rpc('cancel_outcome', { p_lead: lead.id, p_kind: 'customer' });
      dialog({ title: 'Cancel this booking', intro: esc([lead.booking_id, lead.area].filter(Boolean).join(' · ') || 'This booking'),
        body: `<label class="flow-label" for="cx-kind">Who cancelled</label><select id="cx-kind" name="kind">${CANCEL_KIND.map((k) => `<option value="${k[0]}">${esc(k[1])}</option>`).join('')}</select>
          <p class="flow-muted" id="cx-out" aria-live="polite">${outcomeHtml(first)}</p>
          ${canOver ? '<label class="flow-label" for="cx-refund">Refund decision</label><select id="cx-refund" name="refund"><option value="">Follow the policy above</option><option value="yes">Refund the fee in full</option><option value="no">No refund</option></select>' : ''}
          <label class="flow-label" for="cx-why">Reason (required)</label><input id="cx-why" name="why" maxlength="200" autocomplete="off">`,
        submit: 'Cancel booking',
        onOpen: (f) => { f.kind.addEventListener('change', async () => { try { f.querySelector('#cx-out').innerHTML = outcomeHtml(await rpc('cancel_outcome', { p_lead: lead.id, p_kind: f.kind.value })); } catch (e) { /* keep the last text */ } }); },
        onSubmit: async (f, d) => {
          if (f.why.value.trim().length < 3) throw new Error('Write a short reason.');
          const r = await rpc('crm_cancel_booking', { p_lead: lead.id, p_kind: f.kind.value, p_reason: f.why.value.trim(), p_refund: canOver && f.refund && f.refund.value ? f.refund.value === 'yes' : null });
          d.close(); toast(r && r.refund_due > 0 ? 'Booking cancelled. Refund due ' + inr(r.refund_due) + ': an Admin records it.' : 'Booking cancelled. No refund due.'); deps.reload();
        } });
    },
    garageAssign(lead, flow, btn) { const ds = (btn && btn.dataset) || {}; return deps.garageDesk.assignDialog({ lead, moveFrom: ds.move || undefined, reassign: !!ds.re }); },
    copyScript(lead, flow, btn) { copy(callScript(btn.dataset.amount || '49 to 99')); },
    /* Every job goes to a partner garage or an outside partner, through the one assignment dialog (garage-desk assign -> crm_assign_booking). Picking a mechanic was retired. */
    async assignPick(lead) { return actions.garageAssign(lead); },
    async jobLink(lead) { const url = await rpc('crm_tech_link', { p_lead: lead.id }); dialog({ title: 'Job link', intro: 'Send this link to the mechanic on WhatsApp. It shows the job, takes the customer’s code and the visit steps.', body: `<p class="flow-box2">${esc(url)}</p><div class="flow-row"><button class="flow-btn" type="button" id="fl-c">Copy link</button></div>`, onOpen: (f) => f.querySelector('#fl-c').addEventListener('click', () => copy(url)) }); },
    async doorCode(lead) { const code = await rpc('crm_door_code', { p_lead: lead.id }); dialog({ title: 'Customer code', intro: 'Only for reading to the customer or sending it again. Never tell it to the mechanic.', body: code ? `<p class="flow-code">${esc(code)}</p>` : '<p class="flow-muted">There is no open code. Press New code.</p>' }); },
    async newDoorCode(lead) { const r = await rpc('crm_handover_code', { p_lead: lead.id, p_kind: 'start' }); dialog({ title: 'New customer code', intro: 'The old code no longer works. The customer’s tracking page shows the new one.', body: `<p class="flow-code">${esc(r.code)}</p>` }); deps.reload(); },
    markReady(lead) { return deliveryDialog(lead, 'ready'); },
    markDelivered(lead) { return deliveryDialog(lead, 'delivered'); },
    deliver(lead, flow, btn) { return deliveryDialog(lead, btn.dataset.stage); },
    async resend(lead, flow, btn) { const body = { action: 'resend', lead_id: lead.id, kind: btn.dataset.kind }; if (btn.dataset.n) body.n = Number(btn.dataset.n); const r = await call('booking-notify', body); toast(r.result === 'sent' ? 'Sent.' : 'Tried again: ' + (r.result || 'done')); deps.reload(); },
    async showPhotos(lead, flow) {
      const list = (flow.updates && flow.updates.photos) || []; if (!list.length) return;
      const urls = (await Promise.all(list.map((p) => (deps.photoUrl ? deps.photoUrl(p.path) : null).catch(() => null)))).filter(Boolean);
      dialog({ title: 'Customer photos', intro: 'Private. These links stop working after 10 minutes.', body: urls.length ? `<div class="flow-photos">${urls.map((u, i) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Customer photo ${i + 1}"></a>`).join('')}</div>` : '<p class="flow-muted">The photos could not be opened. You may not have access.</p>', submit: 'Close', onSubmit: async (f, d) => d.close() });
    },
    async resolveIssue(lead, flow, btn, after) {
      const id = btn.dataset.id;
      dialog({ title: 'Resolve this issue', intro: 'Your name and the time are saved with it. The customer is not messaged automatically.', body: '<label class="flow-label" for="fl-rn">What was done (optional)</label><input id="fl-rn" name="note" maxlength="200" autocomplete="off">',
        submit: 'Mark resolved', onSubmit: async (f, d) => { await rpc('crm_issue_resolve', { p_issue: id, p_note: f.note.value.trim() || null }); toast('Issue resolved.'); d.close(); if (after) after(); else deps.reload(); } });
    },
    approveOnBehalf(lead) { return approveDialog(lead); },
    /** Approve the garage's estimate (existing review function, then the quote goes to the customer), or reject it with a reason. Edit opens the quote builder filled from the estimate. */
    estApprove(lead, flow, btn) { const e = estimateOf(lead, flow, btn); return e && deps.garageDesk.actions.review(e, true); },
    estReject(lead, flow, btn) { const e = estimateOf(lead, flow, btn); return e && deps.garageDesk.actions.review(e, false); },
    estEdit(lead, flow, btn) { return actions.quote(lead, flow, btn); },
    async sendDraft(lead) { const r = await call('booking-notify', { action: 'quote_send', lead_id: lead.id }); toast('Estimate v' + r.version + ' sent to the customer.'); deps.reload(); },
    async eta(lead, flow) {
      const z = flow.quote && flow.quote.latest || {};
      dialog({ title: 'Update delivery estimate', intro: 'The customer is told once when it changes.', body: etaFields(z), submit: 'Update and tell the customer', onSubmit: async (f, d) => {
        const eta = readEta(f); const g = quoteCheck([{ kind: 'other', name: 'x', amount: 0 }], eta); if (!g.ok) throw new Error(g.error);
        const r = await call('booking-notify', { action: 'eta', lead_id: lead.id, eta }); toast(r.changed ? 'Updated. The customer was told.' : 'No change.'); d.close(); deps.reload(); }, onOpen: (f) => bindEta(f) });
    },
    async quote(lead, flow, btn) {
      const ge = btn && btn.dataset && btn.dataset.est ? estimateOf(lead, flow, btn) : null;
      const z0 = flow.quote && flow.quote.latest, fee = flow.conf && flow.conf.paid ? flow.conf.fee : 0;
      // Edit estimate: the builder starts from the garage's lines and hours or return day.
      const z = ge ? { ...(z0 || {}), status: 'draft', lines: (ge.lines || []).map((x) => ({ kind: x.kind || 'other', name: x.name, amount: x.amount, part_type: x.part_type })), ...(ge.hours ? { eta_kind: 'hours', eta_hours: ge.hours } : ge.return_day ? { eta_kind: 'date', eta_date: ge.return_day } : {}) } : z0;
      const seed = z && z.lines && z.lines.length ? z.lines : [{ kind: 'parts', name: '', amount: '' }, { kind: 'labour', name: '', amount: '' }];
      const rowHtml = (x, i) => `<div class="flow-line" data-i="${i}"><select name="k" aria-label="Type">${QUOTE_KINDS.map(([k, t]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${t}</option>`).join('')}</select><select name="pt" aria-label="Genuine or Equivalent"${x.kind === 'parts' ? '' : ' hidden'}><option value="">Genuine or Equivalent?</option>${PART_TYPES.map(([k, t]) => `<option value="${k}"${x.part_type === k ? ' selected' : ''}>${t}</option>`).join('')}</select><input name="n" maxlength="80" placeholder="Item" aria-label="Item" value="${esc(x.name)}"><input name="a" inputmode="decimal" placeholder="₹ before GST" aria-label="Amount before GST" value="${esc(x.amount)}"><button class="flow-btn flow-sm" type="button" data-rm aria-label="Remove line">×</button></div>`;
      dialog({ title: ge ? 'Edit the garage estimate' : z && z.status !== 'draft' ? 'Revised quote' : 'Build the quote', intro: 'Amounts are before GST. GST at 18% is added. The confirmation fee already paid is taken off. Nothing starts until the customer approves.',
        body: `<div id="fl-lines">${seed.map(rowHtml).join('')}</div><button class="flow-btn flow-sm" type="button" id="fl-add">Add a line</button><div class="flow-sum" id="fl-sum" aria-live="polite"></div>${etaFields(z || {})}`,
        submit: 'Save and send to the customer', onSubmit: async (f, d) => {
          const lines = readLines(f), eta = readEta(f), g = quoteCheck(lines, eta); if (!g.ok) throw new Error(g.error);
          await rpc('crm_quote_save', { p_lead: lead.id, p_lines: lines.map((x) => (x.kind === 'parts' ? { kind: x.kind, name: x.name.trim(), amount: Number(x.amount), part_type: x.part_type } : { kind: x.kind, name: x.name.trim(), amount: Number(x.amount) })), p_eta: eta });
          const r = await call('booking-notify', { action: 'quote_send', lead_id: lead.id }); toast('Quote v' + r.version + ' sent.'); d.close(); deps.reload();
        },
        onOpen: (f) => {
          bindEta(f); const sum = () => { const t = quoteTotals(readLines(f).filter((x) => x.amount !== ''), fee); f.querySelector('#fl-sum').innerHTML = `Subtotal ${esc(inr(t.subtotal))} · GST 18% ${esc(inr(t.gst))} · <b>Total ${esc(inr(t.total))}</b>${fee ? ` · Fee paid −${esc(inr(t.feeCredit))} · <b>Balance ${esc(inr(t.balance))}</b>` : ''}`; };
          f.addEventListener('input', sum); f.addEventListener('change', (e) => { const r = e.target.closest('.flow-line'); if (r && e.target.name === 'k') r.querySelector('[name=pt]').hidden = e.target.value !== 'parts'; }); sum();
          f.querySelector('#fl-add').addEventListener('click', () => { f.querySelector('#fl-lines').insertAdjacentHTML('beforeend', rowHtml({ kind: 'parts', name: '', amount: '' }, 99)); });
          f.querySelector('#fl-lines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b && f.querySelectorAll('.flow-line').length > 1) { b.closest('.flow-line').remove(); sum(); } });
        } });
    },
  };
  /** The garage estimate a button points at (data-est), shaped for the review dialog. */
  const estimateOf = (lead, flow, btn) => { const e = ((flow && flow.est && flow.est.garage_estimates) || []).find((x) => x.id === btn.dataset.est); return e ? { ...e, lead_id: lead.id, booking_id: lead.booking_id } : null; };
  const nowStamp = () => new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) + ' (India time)';
  const adminName = () => { const m = deps.me && deps.me(); return (m && (m.name || m.email)) || 'You'; };
  /** The notice goes after the database change. If it fails the change stays and the dialog says so, with a Resend button. */
  function afterNotice(d, f, okText, send, saved = 'Saved') {
    return send().then(() => { d.close(); toast(okText); }, (x) => {
      d.say('');
      const err = f.querySelector('.flow-err'); err.innerHTML = `${esc(saved + ', but the notice could not be sent: ' + cleanErr(x).slice(0, 120) + ' ')}<button class="flow-btn flow-sm" type="button" data-resend-notice>Resend</button>`;
      err.querySelector('[data-resend-notice]').addEventListener('click', async (ev) => { ev.preventDefault(); try { await send(); d.close(); toast(okText); } catch (y) { err.firstChild.textContent = saved + ', but the notice could not be sent: ' + cleanErr(y).slice(0, 120) + ' '; } });
      const sub = f.querySelector('button[type=submit]'); if (sub) sub.remove();
    });
  }
  /** APPROVE ON BEHALF OF CUSTOMER: method and remarks are required, the admin's name and the time are shown (and saved by the database), the notice is sent after. */
  function approveDialog(lead) {
    return dialog({ title: 'Approve on behalf of the customer', intro: esc([lead.booking_id, lead.area].filter(Boolean).join(' · ') || 'This booking') + '. Only after the customer clearly said yes. This is recorded with your name.',
      body: `<label class="flow-label" for="ap-m">How did the customer confirm</label><select id="ap-m" name="method"><option value="phone">Phone call</option><option value="whatsapp">WhatsApp</option></select>
        <label class="flow-label" for="ap-r">What the customer said (required)</label><input id="ap-r" name="remarks" maxlength="300" autocomplete="off" placeholder="Like: said yes on the call at 11:40">
        <dl class="flow-kv"><dt>Approved by</dt><dd data-ap-name>${esc(adminName())}</dd><dt>Date and time</dt><dd data-ap-time>${esc(nowStamp())}</dd></dl>
        <p class="flow-muted">A confirmation is sent to the customer and the garage is notified.</p>`,
      submit: 'Approve on behalf', onSubmit: async (f, d) => {
        const ck = approveCheck({ method: f.method.value, remarks: f.remarks.value }); if (!ck.ok) throw new Error(ck.error);
        await rpc('crm_quote_admin_approve', { p_lead: lead.id, p_method: ck.method, p_remarks: ck.remarks, p_version: null });
        deps.reload();
        await afterNotice(d, f, 'Approved. The customer and the garage are being told.', async () => { await call('booking-notify', { action: 'approval_notice', lead_id: lead.id }); }, 'Approved');
      } });
  }
  /** One path for Done, Ready and Delivered and Close: the dialog (name, time, remarks), crm_delivery_set, then the customer notice for Ready and Delivered. */
  function deliveryDialog(lead, stage) {
    const D = DELIVERY_STAGES[stage]; if (!D) return;
    return dialog({ title: D.title, intro: esc([lead.booking_id, lead.area].filter(Boolean).join(' · ') || 'This booking'),
      body: `<dl class="flow-kv"><dt>Marked by</dt><dd data-dl-name>${esc(adminName())}</dd><dt>Date and time</dt><dd data-dl-time>${esc(nowStamp())}</dd></dl>
        <label class="flow-label" for="dl-r">Remarks${stage === 'delivered' ? ' (required)' : ' (optional)'}</label><input id="dl-r" name="remarks" maxlength="300" autocomplete="off">
        ${deliveryNotifies(stage) ? '<p class="flow-muted">The customer is told on WhatsApp and by email.</p>' : ''}`,
      submit: D.submit, onSubmit: async (f, d) => {
        const ck = deliveryCheck(stage, f.remarks.value); if (!ck.ok) throw new Error(ck.error);
        await rpc('crm_delivery_set', { p_lead: lead.id, p_stage: stage, p_remarks: ck.remarks });
        if (deps.afterDelivery) { try { await deps.afterDelivery(lead.id, stage); } catch (x) { /* the host's follow-up must not undo the step */ } }
        deps.reload();
        if (deliveryNotifies(stage)) await afterNotice(d, f, D.title + ': saved and the customer was told.', async () => { await call('booking-notify', { action: 'delivery_update', lead_id: lead.id, stage }); }, stage === 'ready' ? 'Marked ready' : 'Marked delivered');
        else { d.close(); toast(stage === 'done' ? 'Service marked done.' : 'Booking closed.'); }
      } });
  }
  const readLines = (f) => [...f.querySelectorAll('.flow-line')].map((r) => ({ kind: r.querySelector('[name=k]').value, name: r.querySelector('[name=n]').value, amount: r.querySelector('[name=a]').value.trim(), part_type: r.querySelector('[name=k]').value === 'parts' ? r.querySelector('[name=pt]').value : undefined }));
  const etaFields = (z) => `<fieldset class="flow-eta"><legend>Estimated delivery (required)</legend><label class="flow-check"><input type="radio" name="ek" value="hours"${z.eta_kind !== 'date' ? ' checked' : ''}> Repair at the door: hours</label><input name="eh" inputmode="numeric" maxlength="2" placeholder="Hours, 1 to 72" value="${esc(z.eta_hours ?? '')}" aria-label="Hours">
    <label class="flow-check"><input type="radio" name="ek" value="date"${z.eta_kind === 'date' ? ' checked' : ''}> Pickup: expected return day</label><input name="ed" type="date" value="${esc(z.eta_date ?? '')}" aria-label="Return day"><input name="ew" maxlength="40" placeholder="Time window, like afternoon" value="${esc(z.eta_window ?? '')}" aria-label="Time window"></fieldset>`;
  const readEta = (f) => { const k = f.querySelector('[name=ek]:checked'); return k && k.value === 'date' ? { kind: 'date', date: f.ed.value, window: f.ew.value.trim() } : { kind: 'hours', hours: Number(f.eh.value) }; };
  const bindEta = (f) => { const fix = () => { const date = f.querySelector('[name=ek]:checked').value === 'date'; f.eh.disabled = date; f.ed.disabled = !date; f.ew.disabled = !date; }; f.addEventListener('change', fix); fix(); };

  /** Wire a container. getLead() and getFlow() return the current lead and flow. */
  function bind(root, getLead, getFlow) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-flow]'); if (!b || b.dataset.busy) return; const fn = actions[b.dataset.flow]; if (!fn) return;
      b.dataset.busy = '1';
      try { await fn(getLead(), getFlow(), b); } catch (x) { toast(cleanErr(x), true); } finally { delete b.dataset.busy; }
    });
  }

  /* ----- Dispatch ----- */
  const garageRow = (r) => { const l = garageLabel(r); if (!l) return ''; const c = garageSeenChip(r, deps.now ? deps.now() : new Date()); const st = garageStepChips(r, deps.now ? deps.now() : new Date()).map((x) => chip(x.text, x.tone)).join(' '); return `<div data-garage><b>${esc(l)}</b> ${c ? chip(c.text, c.tone) : ''} ${st}</div>`; };
  const seenRow = (s) => (s ? `<div class="flow-muted" data-seen>${esc(seenLine(s.age_s) || '')}${mapsUrl(s.lat, s.lng) ? ` · <a href="${esc(mapsUrl(s.lat, s.lng))}" target="_blank" rel="noopener">Open in Maps</a>` : ''}</div>` : '');
  // Per assigned booking: the mechanic's phone and the "Mechanic told" note, read once from crm_lead (the Dispatch list does not carry them). One failed read leaves that card without the chip, never blanks the list.
  async function loadTell(rows) {
    const out = {};
    await Promise.all((rows || []).filter((r) => r.mechanic_id).map(async (r) => {
      try { const d = await rpc('crm_lead', { p_id: r.id }); const l = (d && d.lead) || {}; out[r.id] = { phone: l.mechanic_phone || '', told: toldInfo(d && d.activities, r.mechanic_name) }; } catch (e) { /* no chip for this card */ }
    }));
    return out;
  }
  const tellBlock = (r, tell) => {
    const t = tell && tell[r.id]; if (!r.mechanic_id || !t) return '';
    const state = t.told ? chip(toldLabel(t.told.at), 'good', 'flow-told') : notToldYet(r, null) ? chip('Mechanic not told yet', 'bad', 'flow-nottold') : '';
    const btn = mechanicWaPhone(t.phone) ? `<button class="flow-btn ${t.told ? '' : 'flow-primary'}" type="button" data-dispatch="tell">${t.told ? 'Tell mechanic again' : 'Tell mechanic'}</button>` : '<button class="flow-btn flow-primary" type="button" data-dispatch="open">Add the mechanic’s phone</button>';
    return `<div class="flow-row flow-tell">${state}${btn}</div>`;
  };
  // Opens WhatsApp with the job message, then notes it on the booking. The window opens first, while the tap still counts.
  async function tellMechanic(row, tell) {
    const t = tell && tell[row.id]; if (!t || !mechanicWaPhone(t.phone)) return deps.openLead && deps.openLead(row.id);
    const win = window.open('about:blank', '_blank'); let url = null;
    try { url = await rpc('crm_tech_link', { p_lead: row.id }); } catch (e) { toast('The job link could not be made: ' + cleanErr(e) + ' The message says the link will follow.', true); }
    const wa = tellUrl(t.phone, tellMessage(row, url));
    if (win) { win.opener = null; win.location.href = wa; } else window.open(wa, '_blank', 'noopener');
    try { await rpc('crm_log', { p_id: row.id, p_kind: 'note', p_body: toldNoteBody(row.mechanic_name), p_next_action: null, p_status: null, p_lost_reason: null }); t.told = { at: new Date().toISOString() }; } catch (e) { toast('WhatsApp opened, but the note could not be saved: ' + cleanErr(e), true); }
  }
  function dispatchHtml(rows, seen, tell) {
    const list = dispatchOrder(rows || []);
    if (!list.length) return emptyState({ title: 'No paid bookings waiting', text: 'New paid bookings appear here first.' });
    const un = list.filter((r) => !isHandled(r)), on = list.filter(isHandled);
    const gdOk = !!(deps.garageDesk && deps.garageDesk.visible());
    const li = (r) => `<li class="flow-d flow-d-paid ${isHandled(r) ? '' : 'flow-d-open'}" data-id="${esc(r.id)}"><div><b>${esc(r.booking_id || 'Booking')}</b> ${chip(String(r.vehicle || 'bike').toUpperCase())} ${r.confirm_fee != null ? chip('PAID ₹' + r.confirm_fee, 'good', 'flow-paid') : ''} ${r.review ? chip('Fee needs a check', 'warn') : ''}</div>
      <div>${esc(r.first_name || '')} · ${esc([r.area, r.pincode].filter(Boolean).join(' ') || 'No area')}</div><div class="flow-muted">${esc(r.preferred_date || '')} · ${esc(SLOT[r.preferred_slot] || r.preferred_slot || '')}${r.bike ? ' · ' + esc(r.bike) : ''}${r.service_name ? ' · ' + esc(r.service_name) : ''}</div>
      <div>${r.mechanic_name ? `Mechanic: <b>${esc(r.mechanic_name)}</b>${r.visit_stage ? ' · ' + esc(STAGE[r.visit_stage] || r.visit_stage) : ''}` : (r.garage_id ? '' : '<b class="flow-bad">Unassigned</b>')}</div>${garageRow(r)}${seenRow(seen && seen[r.id])}${tellBlock(r, tell)}
      <div class="flow-row">${gdOk ? `<button class="flow-btn ${isHandled(r) ? '' : 'flow-primary'}" type="button" data-dispatch="garage">${isHandled(r) ? 'Reassign' : 'Assign'}</button>` : ''}<button class="flow-btn flow-ghost" type="button" data-dispatch="open">Open</button></div></li>`;
    const head = (t, n, cls) => `<h3 class="flow-dhead ${cls}">${t} <span class="flow-dcount">${n}</span></h3>`;
    return `${un.length ? head('Paid, needs a mechanic', un.length, 'flow-dhead-paid') + `<ul class="flow-dispatch">${un.map(li).join('')}</ul>` : ''}${on.length ? (un.length ? head('Assigned', on.length, '') : '') + `<ul class="flow-dispatch">${on.map(li).join('')}</ul>` : ''}`;
  }
  /* ----- Issues: what customers reported, open first, with who resolved the others ----- */
  function issuesHtml(rows) {
    const list = issueOrder(rows || []);
    if (!list.length) return emptyState({ title: 'No issues here', text: 'When a customer reports a problem it appears here and the team is emailed.' });
    return `<ul class="flow-dispatch" data-issues>${list.map((i) => `<li class="flow-d ${i.status === 'open' ? 'flow-d-open' : ''}" data-id="${esc(i.id)}" data-lead="${esc(i.lead_id)}"><div><b>${esc(i.booking_id || 'Booking')}</b> ${chip(i.status === 'open' ? 'Open' : 'Resolved', ISSUE_TONE[i.status] || 'good')} ${chip(ISSUE_TYPES[i.category] || i.category)}</div>
      <div>${esc(i.first_name || '')} · ${esc(i.area || 'No area')}</div><div>${esc(i.body)}</div><div class="flow-muted">Reported ${esc(when(i.created_at))}${i.status === 'resolved' ? ` · resolved by ${esc(i.resolved_by || 'the team')} ${esc(when(i.resolved_at))}${i.note ? ' · ' + esc(i.note) : ''}` : ''}</div>
      <div class="flow-row">${i.status === 'open' ? '<button class="flow-btn flow-primary" type="button" data-issue="resolve">Resolve</button>' : ''}<button class="flow-btn flow-ghost" type="button" data-issue="open">Open booking</button></div></li>`).join('')}</ul>`;
  }
  function bindIssues(root, reload) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-issue]'); if (!b) return; const li = b.closest('[data-id]');
      try {
        if (b.dataset.issue === 'open' && deps.openLead) return deps.openLead(li.dataset.lead);
        if (b.dataset.issue === 'resolve') await actions.resolveIssue(null, null, { dataset: { id: li.dataset.id } }, reload);
      } catch (x) { toast(cleanErr(x), true); }
    });
  }
  function bindDispatch(root, getRows, getTell, redraw) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dispatch]'); if (!b) return; const id = b.closest('[data-id]').dataset.id, row = getRows().find((x) => x.id === id); if (!row) return;
      try { if (b.dataset.dispatch === 'open' && deps.openLead) return deps.openLead(id); if (b.dataset.dispatch === 'garage') { if (!deps.garageDesk || !deps.garageDesk.visible()) return; await actions.garageAssign({ id, booking_id: row.booking_id, area: row.area }, null, { dataset: { ...(row.garage_id ? { move: row.garage_id } : {}), ...(isHandled(row) ? { re: '1' } : {}) } }); return; } if (b.dataset.dispatch === 'tell') { await tellMechanic(row, getTell && getTell()); if (redraw) redraw(); return; } } catch (x) { toast(cleanErr(x), true); }
    });
  }
  /** Send the current sent-ready draft quote to the customer (marks it sent, then WhatsApp and email). Used when a garage estimate is approved. */
  const sendQuote = async (leadId) => { const r = await call('booking-notify', { action: 'quote_send', lead_id: leadId }); return r; };
  /** The refund dialog (Admin only). Full fills the refundable amount; Partial lets the Admin type an amount, never more than refundable. Gateway refunds (Cashfree) or a manual record with its reference. */
  function refundDialog({ lead_id, label, outstanding }) {
    if (!deps.refundNow) return;
    const max = Math.max(0, Number(outstanding) || 0), manual = !!deps.recordRefund;
    dialog({ title: 'Refund to customer', intro: esc(label || 'This booking'),
      body: `<fieldset class="flow-eta"><legend>How much (at most ${esc(inr(max))})</legend><label class="flow-check"><input type="radio" name="mode" value="full" checked> Full refund: ${esc(inr(max))}</label><label class="flow-check"><input type="radio" name="mode" value="partial"> Partial refund</label></fieldset>
        <label class="flow-label" for="rn-amt">Amount to refund (₹)</label><input id="rn-amt" name="amount" inputmode="decimal" autocomplete="off" value="${esc(max)}" readonly>
        ${manual ? '<label class="flow-label" for="rn-how">Refund method</label><select id="rn-how" name="how"><option value="gateway">Refund to customer now (Cashfree)</option><option value="manual">Record a refund already paid (manual)</option></select><div data-rn-ref hidden><label class="flow-label" for="rn-ref">Reference (UPI or bank reference)</label><input id="rn-ref" name="reference" maxlength="80" autocomplete="off"></div>' : ''}
        <label class="flow-label" for="rn-why">Reason (required)</label><input id="rn-why" name="why" maxlength="200" autocomplete="off">
        <p class="flow-muted" data-rn-note>Money goes back to the customer's original payment method within 5 to 7 working days. This cannot be undone.</p>
        ${!manual && deps.openRefund ? '<div class="flow-row"><button class="flow-btn flow-ghost" type="button" data-rn-manual>Record a manual refund instead</button></div>' : ''}`,
      submit: 'Refund now',
      onOpen: (f, d) => {
        const sync = () => { const part = f.querySelector('[name=mode]:checked').value === 'partial'; f.amount.readOnly = !part; if (!part) f.amount.value = max; };
        f.addEventListener('change', (e) => { if (e.target.name === 'mode') sync(); if (e.target.name === 'how') { const m = e.target.value === 'manual'; f.querySelector('[data-rn-ref]').hidden = !m; f.querySelector('[data-rn-note]').hidden = m; f.querySelector('button[type=submit]').textContent = m ? 'Record refund' : 'Refund now'; } });
        const mb = f.querySelector('[data-rn-manual]'); if (mb) mb.addEventListener('click', () => { d.close(); deps.openRefund(lead_id); });
      },
      onSubmit: async (f, d) => {
        const ck = refundCheck({ mode: f.querySelector('[name=mode]:checked').value, amount: f.amount.value, max }); if (!ck.ok) throw new Error(ck.error.replace(/more than (\d+(\.\d+)?)\./, (m, n) => 'more than ' + inr(Number(n)) + '.'));
        if (f.why.value.trim().length < 3) throw new Error('Write a short reason.');
        if (f.how && f.how.value === 'manual') {
          if (f.reference.value.trim().length < 3) throw new Error('Enter the reference of the refund you already paid.');
          await deps.recordRefund({ lead_id, amount: ck.amount, reference: f.reference.value.trim(), reason: f.why.value.trim() });
          d.close(); toast('Refund of ' + inr(ck.amount) + ' recorded.'); await deps.refundNow(lead_id); return;
        }
        const r = await call('admin-refund', { lead_id, amount: ck.amount, reason: f.why.value.trim() });
        d.close(); toast(r && r.already ? 'This refund was already sent.' : 'Refund of ' + inr(ck.amount) + ' sent to Cashfree. The customer gets it in 5 to 7 working days.'); await deps.refundNow(lead_id);   // the host reloads the screen
      } });
  }
  /* ----- Booking history: the full activity feed (crm_booking_timeline). Falls back to the older history when the function is missing. ----- */
  const TL_PAGE = 20;
  function timelineHtml(rows, shown, more) {
    if (!rows.length) return '<p class="flow-muted">Nothing has happened on this booking yet.</p>';
    return `<ul class="flow-tl" data-timeline>${rows.slice(0, shown).map((r) => { const [k, tone] = timelineKind(r.kind), st = istStamp(r.at);
      return `<li class="flow-tl-${esc(r.kind || 'update')}" data-kind="${esc(r.kind || '')}"><span class="flow-tl-dot flow-tl-${tone || 'plain'}" aria-hidden="true"></span><div><div>${chip(k, tone)} <b>${esc(r.title)}</b></div>${r.detail ? `<div>${esc(r.detail)}</div>` : ''}<small class="flow-muted">${esc(st.date)}${st.time ? ' · ' + esc(st.time) : ''}${r.by_name ? ' · ' + esc(r.by_name) : ''}</small></div></li>`; }).join('')}</ul>${more ? '<div class="flow-row"><button class="flow-btn flow-ghost" type="button" data-tl-more>Show more</button></div>' : ''}`;
  }
  /** Fill `el` with the activity feed of one booking. Show more asks the database for another page. */
  async function mountTimeline(el, leadId) {
    if (!el) return; let limit = TL_PAGE, rows = [], legacy = false;
    const draw = (msg) => { el.innerHTML = `<h3>Booking history</h3>${msg || timelineHtml(rows, rows.length, !legacy && rows.length >= limit)}`; };
    const get = async () => {
      try { rows = (await rpc('crm_booking_timeline', { p_lead: leadId, p_limit: limit })) || []; legacy = false; }
      catch (e) { legacy = true; try { rows = deps.timelineFallback ? legacyTimeline(await deps.timelineFallback(leadId)) : []; } catch (x) { rows = []; draw(`<p class="flow-muted" role="alert">The history could not load. <button class="flow-btn flow-sm" type="button" data-tl-retry>Retry</button></p>`); return false; } }
      return true;
    };
    if (await get()) draw();
    el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-tl-retry]')) { if (await get()) draw(); return; }
      if (e.target.closest('[data-tl-more]')) { limit += TL_PAGE; if (await get()) draw(); }
    });
  }
  return { timelineHtml, mountTimeline, statusOptions, statusJump, deliveryDialog, approveDialog, refundDialog, load, withFlow, card, bind, dispatchHtml, loadTell, bindDispatch, issuesHtml, bindIssues, actions, dialog, sendQuote };
}
