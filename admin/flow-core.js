// The paid-confirmation flow screens, shared by Crew and the Admin: Send payment link, the Call script, door code, mechanic assignment, the itemised quote with delivery estimate,
// phone approval, Ready and Delivered, the notification log with Resend, and the Dispatch list. ONE file: crm/flow-core.js is the source and admin/flow-core.js is a copy (a test checks they are identical).
// It holds no business rules of its own. Every action calls the same database functions and Edge Functions, which check who may do what (admins pass, agents and technicians keep their limits).
import { paidBadge, visitSub, callScript, quoteTotals, quoteCheck, QUOTE_KINDS, NOTICE_LABEL, resendable, dispatchOrder, confirmPending, confirmPaid, ISSUE_TYPES, seenLine, mapsUrl, issueOrder } from './flow-rules.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');
const SLOT = { asap: 'As soon as possible', morning: 'Morning 9 to 12', afternoon: 'Afternoon 12 to 4', evening: 'Evening 4 to 8' };
const STAGE = { on_the_way: 'On the way', arrived: 'Arrived', started: 'Door code verified', repair_doorstep: 'Repair at the door', picked_up: 'Picked up', ready: 'Ready', returned: 'Delivered' };
const DOOR = { none: 'No code yet', open: 'Code ready', locked: 'Locked after 5 wrong tries', expired: 'Code expired', verified: 'Verified at the door' };
const cleanErr = (e) => String((e && e.message) || e || 'Something went wrong').replace(/^Error:\s*/, '');

/** deps: { rpc(name, args), invoke(fn, body), toast(msg, bad), can(action), reload(), mechanics?() , openLead?(id) } */
export function createFlow(deps) {
  const { rpc, invoke, toast } = deps;
  const call = async (fn, body) => { const r = await invoke(fn, body); if (r && r.error) throw new Error(r.error); return r; };

  /* ----- a small modal of our own, so Crew and the Admin look and behave the same ----- */
  function dialog({ title, intro, body, submit, onSubmit, onOpen }) {
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
    const [conf, notes, quote, updates, seen] = await Promise.all([safe('payment status', rpc('crm_confirmation', { p_lead: leadId })), safe('messages', rpc('crm_notifications', { p_lead: leadId })), safe('quote', rpc('crm_quote_get', { p_lead: leadId })),
      safe('customer details', rpc('crm_booking_updates', { p_lead: leadId })), safe('mechanic location', rpc('crm_tech_location', { p_lead: leadId }))]);
    return { conf, notes: notes || [], quote, updates, seen, failed };
  }
  /** Fold the confirmation fields into the lead the step bar reads. */
  const withFlow = (lead, flow) => (flow && flow.conf ? { ...lead, confirm_fee: flow.conf.fee, confirm_paid_at: flow.conf.paid ? (flow.conf.paid_at || 'paid') : null, visit_stage: flow.conf.stage, quote_state: flow.conf.quote ? flow.conf.quote.status : null } : lead);

  /* ----- the card ----- */
  function card(lead, flow) {
    const l = withFlow(lead, flow), c = flow && flow.conf, can = deps.can;
    if (['lost', 'junk'].includes(l.status)) return '';
    const badge = paidBadge(l), sub = visitSub(l), bt = [];
    const open = !confirmPaid(l) && !['completed'].includes(l.status);
    const amount = c && c.fee != null ? c.fee : null;
    if (badge) bt.push(`<span class="flow-chip ${badge.tone}">${esc(badge.text)}</span>`);
    if (c && c.review) bt.push('<span class="flow-chip warn" title="Engine size was not clear, so the fee needs a check">Fee needs a check</span>');
    if (sub) bt.push(`<span class="flow-chip">${esc(sub.label)}</span>`);
    let h = `<section class="flow-card" aria-label="Paid confirmation"><h3>Paid confirmation ${bt.join(' ')}</h3>`;
    if (flow && flow.failed && flow.failed.length) h += `<p class="flow-warn" role="alert" data-flow-failed>Could not load: ${esc(flow.failed.join(', '))}. What you see may be incomplete. <button class="flow-btn flow-sm" type="button" data-flow="reloadFlow">Retry</button></p>`;
    if (open && (can('send_payment_link') || can('assign_leads'))) {
      h += `<div class="flow-row"><button class="flow-btn flow-primary" type="button" data-flow="payLink">${confirmPending(l) ? 'Resend payment link' : 'Send payment link'}</button></div>`;
      h += `<details class="flow-script" open><summary>Call script</summary><p>${esc(callScript(amount ?? '49 to 99'))}</p><button class="flow-btn flow-ghost" type="button" data-flow="copyScript" data-amount="${esc(amount ?? '')}">Copy script</button></details>`;
      if (c && c.link_sent_at) h += `<p class="flow-muted">Link sent ${esc(when(c.link_sent_at))}. If it is unpaid after ${esc(c.nudge_minutes)} minutes the team is reminded.</p>`;
    }
    if (confirmPaid(l)) {
      if (c) h += `<p class="flow-muted">Paid ${esc(when(c && c.paid_at))}. Door code: <b>${esc(DOOR[c && c.door] || '')}</b>${c && c.stage ? ' · Visit: <b>' + esc(STAGE[c.stage] || c.stage) + '</b>' : ''}</p>`;
      const row = [];
      if (can('assign_leads') || can('manage_technicians')) row.push(`<button class="flow-btn" type="button" data-flow="assign">${l.mechanic_name ? 'Reassign mechanic' : 'Assign mechanic'}</button>`);
      if ((can('assign_leads') || can('manage_technicians')) && l.mechanic_name) row.push('<button class="flow-btn" type="button" data-flow="jobLink">Job link for the mechanic</button>');
      if (c && c.door !== 'verified') row.push('<button class="flow-btn" type="button" data-flow="doorCode">Show customer code</button><button class="flow-btn" type="button" data-flow="newDoorCode">New code</button>');
      if (['repair_doorstep', 'picked_up'].includes(c && c.stage)) row.push('<button class="flow-btn" type="button" data-flow="markReady">Mark ready</button>');
      if ((c && c.stage) === 'ready' && l.job_place !== 'garage') row.push('<button class="flow-btn" type="button" data-flow="markDelivered">Mark delivered</button>');
      if (row.length) h += `<div class="flow-row">${row.join('')}</div>`;
      h += quoteBlock(l, flow);
    }
    h += seenBlock(l, flow) + customerBlock(flow);
    const rs = resendable(flow && flow.notes);
    if (flow && flow.notes && flow.notes.length) {
      h += `<h4>Messages</h4><ul class="flow-list">${flow.notes.map((n) => { const k = String(n.kind).split(':'); return `<li><span class="flow-chip ${n.status === 'sent' ? 'good' : n.status === 'failed' ? 'bad' : n.status === 'skipped' ? 'warn' : ''}">${esc(n.status)}</span> ${esc(NOTICE_LABEL[k[0]] || n.kind)}${k[1] ? ' v' + esc(k[1]) : ''} <small class="flow-muted">${esc(when(n.at))}${n.error ? ' · ' + esc(n.error) : ''}</small>${rs.includes(n) ? ` <button class="flow-btn flow-sm" type="button" data-flow="resend" data-kind="${esc(k[0])}" data-n="${esc(k[1] || '')}">Resend</button>` : ''}</li>`; }).join('')}</ul>`;
    }
    return h + '</section>';
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
    let h = `<h4>Added by customer ${open ? `<span class="flow-chip bad">${open} open ${open === 1 ? 'issue' : 'issues'}</span>` : ''}</h4>`;
    if (rows.length) h += `<dl class="flow-kv">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${esc(r[1])}</dd>`).join('')}</dl>`;
    if (u.photo_count) h += u.photos && u.photos.length ? `<div class="flow-row"><button class="flow-btn" type="button" data-flow="showPhotos">See ${esc(u.photos.length)} customer ${u.photos.length === 1 ? 'photo' : 'photos'}</button></div>` : `<p class="flow-muted">${esc(u.photo_count)} customer ${u.photo_count === 1 ? 'photo' : 'photos'} (supervisors and the Technician lead can open them).</p>`;
    if (issues.length) h += `<ul class="flow-list">${issues.map((i) => `<li><span class="flow-chip ${i.status === 'open' ? 'bad' : 'good'}">${i.status === 'open' ? 'Open' : 'Resolved'}</span> <b>${esc(ISSUE_TYPES[i.category] || i.category)}</b>: ${esc(i.body)}<br><span class="flow-muted">${esc(when(i.created_at))}${i.status === 'resolved' ? ` · resolved by ${esc(i.resolved_by || 'the team')} ${esc(when(i.resolved_at))}${i.note ? ' · ' + esc(i.note) : ''}` : ''}</span>${i.status === 'open' ? ` <button class="flow-btn flow-sm" type="button" data-flow="resolveIssue" data-id="${esc(i.id)}">Resolve</button>` : ''}</li>`).join('')}</ul>`;
    return h;
  }
  function quoteBlock(l, flow) {
    const q = flow && flow.quote, latest = q && q.latest, c = flow && flow.conf, can = deps.can;
    if (!(can('assign_leads') || can('manage_technicians') || can('edit_leads'))) return '';
    const stageOk = ['started', 'repair_doorstep', 'picked_up', 'ready'].includes(c && c.stage);
    let h = '<h4>Quote and delivery estimate</h4>';
    if (!latest) h += `<p class="flow-muted">${stageOk ? 'The mechanic has checked the vehicle. Build the itemised quote.' : 'The quote comes after the mechanic arrives and the customer’s code is verified.'}</p>`;
    else h += `<p>Version <b>${esc(latest.version)}</b> · <b>${esc(latest.status)}</b> · total ${esc(inr(latest.total))} incl. GST · balance ${esc(inr(latest.balance))}<br><span class="flow-muted">Delivery: ${esc(latest.eta_text || 'not set')}</span></p>`;
    const row = [];
    if (stageOk) row.push(`<button class="flow-btn flow-primary" type="button" data-flow="quote">${latest && latest.status !== 'draft' ? 'Revise quote' : 'Build quote'}</button>`);
    if (latest && latest.status === 'sent') row.push('<button class="flow-btn" type="button" data-flow="phoneApprove">Record phone approval</button>');
    if (latest && ['sent', 'approved'].includes(latest.status)) row.push('<button class="flow-btn" type="button" data-flow="eta">Update delivery estimate</button>');
    if (row.length) h += `<div class="flow-row">${row.join('')}</div>`;
    if (q && q.versions && q.versions.length > 1) h += `<ul class="flow-list">${q.versions.map((v) => `<li>v${esc(v.version)} ${esc(v.status)}${v.decided_via ? ' · by ' + esc(v.decided_via === 'phone' ? 'phone, recorded by ' + (v.decided_by || 'the team') : 'the customer') : ''}${v.decline_reason ? ' · ' + esc(v.decline_reason) : ''}</li>`).join('')}</ul>`;
    return h;
  }

  /* ----- actions ----- */
  const actions = {
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
    copyScript(lead, flow, btn) { copy(callScript(btn.dataset.amount || '49 to 99')); },
    async assign(lead) {
      const list = await (deps.mechanics ? deps.mechanics() : rpc('crm_mechanic_picker'));
      dialog({ title: lead.mechanic_name ? 'Reassign the mechanic' : 'Assign a mechanic', intro: esc([lead.area, lead.pincode].filter(Boolean).join(' ') || 'Area not given'),
        body: `<label class="flow-label" for="fl-m">Mechanic</label><select id="fl-m" name="m"><option value="">Choose</option>${(list || []).map((m) => `<option value="${esc(m.id)}">${esc(m.name)}${m.area ? ' · ' + esc(m.area) : ''}</option>`).join('')}</select>`,
        submit: 'Assign', onSubmit: async (f, d) => { if (!f.m.value) throw new Error('Choose a mechanic.'); await rpc('crm_assign_technician', { p_id: lead.id, p_mechanic: f.m.value, p_note: null, p_next_action: null }); toast('Mechanic assigned.'); d.close(); deps.reload(); } });
    },
    async jobLink(lead) { const url = await rpc('crm_tech_link', { p_lead: lead.id }); dialog({ title: 'Job link', intro: 'Send this link to the mechanic on WhatsApp. It shows the job, takes the customer’s code and the visit steps.', body: `<p class="flow-box2">${esc(url)}</p><div class="flow-row"><button class="flow-btn" type="button" id="fl-c">Copy link</button></div>`, onOpen: (f) => f.querySelector('#fl-c').addEventListener('click', () => copy(url)) }); },
    async doorCode(lead) { const code = await rpc('crm_door_code', { p_lead: lead.id }); dialog({ title: 'Customer code', intro: 'Only for reading to the customer or sending it again. Never tell it to the mechanic.', body: code ? `<p class="flow-code">${esc(code)}</p>` : '<p class="flow-muted">There is no open code. Press New code.</p>' }); },
    async newDoorCode(lead) { const r = await rpc('crm_handover_code', { p_lead: lead.id, p_kind: 'start' }); dialog({ title: 'New customer code', intro: 'The old code no longer works. The customer’s tracking page shows the new one.', body: `<p class="flow-code">${esc(r.code)}</p>` }); deps.reload(); },
    async markReady(lead) { await rpc('crm_visit_mark', { p_lead: lead.id, p_stage: 'ready' }); toast('Marked ready.'); deps.reload(); },
    async markDelivered(lead) { await rpc('crm_visit_mark', { p_lead: lead.id, p_stage: 'returned' }); toast('Marked delivered.'); deps.reload(); },
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
    async phoneApprove(lead) {
      dialog({ title: 'Record phone approval', intro: 'Only after the customer clearly said yes on the call. Your name goes on the record.', body: '<label class="flow-label" for="fl-n">Note (optional)</label><input id="fl-n" name="note" maxlength="200" autocomplete="off" placeholder="Like: said yes at 11:40">',
        submit: 'Record approval', onSubmit: async (f, d) => { await rpc('crm_quote_phone_approve', { p_lead: lead.id, p_note: f.note.value.trim() || null }); toast('Approval recorded. The mechanic can start.'); d.close(); deps.reload(); } });
    },
    async eta(lead, flow) {
      const z = flow.quote && flow.quote.latest || {};
      dialog({ title: 'Update delivery estimate', intro: 'The customer is told once when it changes.', body: etaFields(z), submit: 'Update and tell the customer', onSubmit: async (f, d) => {
        const eta = readEta(f); const g = quoteCheck([{ kind: 'other', name: 'x', amount: 0 }], eta); if (!g.ok) throw new Error(g.error);
        const r = await call('booking-notify', { action: 'eta', lead_id: lead.id, eta }); toast(r.changed ? 'Updated. The customer was told.' : 'No change.'); d.close(); deps.reload(); }, onOpen: (f) => bindEta(f) });
    },
    async quote(lead, flow) {
      const z = flow.quote && flow.quote.latest, fee = flow.conf && flow.conf.paid ? flow.conf.fee : 0;
      const seed = z && z.lines && z.lines.length ? z.lines : [{ kind: 'parts', name: '', amount: '' }, { kind: 'labour', name: '', amount: '' }];
      const rowHtml = (x, i) => `<div class="flow-line" data-i="${i}"><select name="k" aria-label="Type">${QUOTE_KINDS.map(([k, t]) => `<option value="${k}"${x.kind === k ? ' selected' : ''}>${t}</option>`).join('')}</select><input name="n" maxlength="80" placeholder="Item" aria-label="Item" value="${esc(x.name)}"><input name="a" inputmode="decimal" placeholder="₹ before GST" aria-label="Amount before GST" value="${esc(x.amount)}"><button class="flow-btn flow-sm" type="button" data-rm aria-label="Remove line">×</button></div>`;
      dialog({ title: z && z.status !== 'draft' ? 'Revised quote' : 'Build the quote', intro: 'Amounts are before GST. GST at 18% is added. The confirmation fee already paid is taken off. Nothing starts until the customer approves.',
        body: `<div id="fl-lines">${seed.map(rowHtml).join('')}</div><button class="flow-btn flow-sm" type="button" id="fl-add">Add a line</button><div class="flow-sum" id="fl-sum" aria-live="polite"></div>${etaFields(z || {})}`,
        submit: 'Save and send to the customer', onSubmit: async (f, d) => {
          const lines = readLines(f), eta = readEta(f), g = quoteCheck(lines, eta); if (!g.ok) throw new Error(g.error);
          await rpc('crm_quote_save', { p_lead: lead.id, p_lines: lines.map((x) => ({ kind: x.kind, name: x.name.trim(), amount: Number(x.amount) })), p_eta: eta });
          const r = await call('booking-notify', { action: 'quote_send', lead_id: lead.id }); toast('Quote v' + r.version + ' sent.'); d.close(); deps.reload();
        },
        onOpen: (f) => {
          bindEta(f); const sum = () => { const t = quoteTotals(readLines(f).filter((x) => x.amount !== ''), fee); f.querySelector('#fl-sum').innerHTML = `Subtotal ${esc(inr(t.subtotal))} · GST 18% ${esc(inr(t.gst))} · <b>Total ${esc(inr(t.total))}</b>${fee ? ` · Fee paid −${esc(inr(t.feeCredit))} · <b>Balance ${esc(inr(t.balance))}</b>` : ''}`; };
          f.addEventListener('input', sum); sum();
          f.querySelector('#fl-add').addEventListener('click', () => { f.querySelector('#fl-lines').insertAdjacentHTML('beforeend', rowHtml({ kind: 'parts', name: '', amount: '' }, 99)); });
          f.querySelector('#fl-lines').addEventListener('click', (e) => { const b = e.target.closest('[data-rm]'); if (b && f.querySelectorAll('.flow-line').length > 1) { b.closest('.flow-line').remove(); sum(); } });
        } });
    },
  };
  const readLines = (f) => [...f.querySelectorAll('.flow-line')].map((r) => ({ kind: r.querySelector('[name=k]').value, name: r.querySelector('[name=n]').value, amount: r.querySelector('[name=a]').value.trim() }));
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
  const seenRow = (s) => (s ? `<div class="flow-muted" data-seen>${esc(seenLine(s.age_s) || '')}${mapsUrl(s.lat, s.lng) ? ` · <a href="${esc(mapsUrl(s.lat, s.lng))}" target="_blank" rel="noopener">Open in Maps</a>` : ''}</div>` : '');
  function dispatchHtml(rows, seen) {
    const list = dispatchOrder(rows || []);
    if (!list.length) return '<p class="flow-empty">No paid bookings waiting. New paid bookings appear here first.</p>';
    return `<ul class="flow-dispatch">${list.map((r) => `<li class="flow-d ${r.mechanic_id ? '' : 'flow-d-open'}" data-id="${esc(r.id)}"><div><b>${esc(r.booking_id || 'Booking')}</b> <span class="flow-chip">${esc(String(r.vehicle || 'bike').toUpperCase())}</span> ${r.confirm_fee != null ? `<span class="flow-chip good">Paid ₹${esc(r.confirm_fee)}</span>` : ''} ${r.review ? '<span class="flow-chip warn">Fee needs a check</span>' : ''}</div>
      <div>${esc(r.first_name || '')} · ${esc([r.area, r.pincode].filter(Boolean).join(' ') || 'No area')}</div><div class="flow-muted">${esc(r.preferred_date || '')} · ${esc(SLOT[r.preferred_slot] || r.preferred_slot || '')}${r.bike ? ' · ' + esc(r.bike) : ''}${r.service_name ? ' · ' + esc(r.service_name) : ''}</div>
      <div>${r.mechanic_name ? `Mechanic: <b>${esc(r.mechanic_name)}</b>${r.visit_stage ? ' · ' + esc(STAGE[r.visit_stage] || r.visit_stage) : ''}` : '<b class="flow-bad">Unassigned</b>'}</div>${seenRow(seen && seen[r.id])}
      <div class="flow-row"><button class="flow-btn ${r.mechanic_id ? '' : 'flow-primary'}" type="button" data-dispatch="assign">${r.mechanic_id ? 'Reassign' : 'Assign mechanic'}</button><button class="flow-btn flow-ghost" type="button" data-dispatch="open">Open</button></div></li>`).join('')}</ul>`;
  }
  /* ----- Issues: what customers reported, open first, with who resolved the others ----- */
  function issuesHtml(rows) {
    const list = issueOrder(rows || []);
    if (!list.length) return '<p class="flow-empty">No issues here. When a customer reports a problem it appears here and the team is emailed.</p>';
    return `<ul class="flow-dispatch" data-issues>${list.map((i) => `<li class="flow-d ${i.status === 'open' ? 'flow-d-open' : ''}" data-id="${esc(i.id)}" data-lead="${esc(i.lead_id)}"><div><b>${esc(i.booking_id || 'Booking')}</b> <span class="flow-chip ${i.status === 'open' ? 'bad' : 'good'}">${i.status === 'open' ? 'Open' : 'Resolved'}</span> <span class="flow-chip">${esc(ISSUE_TYPES[i.category] || i.category)}</span></div>
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
  function bindDispatch(root, getRows) {
    root.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-dispatch]'); if (!b) return; const id = b.closest('[data-id]').dataset.id, row = getRows().find((x) => x.id === id); if (!row) return;
      try { if (b.dataset.dispatch === 'open' && deps.openLead) return deps.openLead(id); if (b.dataset.dispatch === 'assign') await actions.assign({ id, name: row.first_name, area: row.area, pincode: row.pincode, mechanic_name: row.mechanic_name }); } catch (x) { toast(cleanErr(x), true); }
    });
  }
  return { load, withFlow, card, bind, dispatchHtml, bindDispatch, issuesHtml, bindIssues, actions, dialog };
}
