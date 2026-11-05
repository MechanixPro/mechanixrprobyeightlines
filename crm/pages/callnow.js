import { rpc, esc, head, empty, toast, clean, vehicleTag } from '../ui.js';
import { callQueue, waitInfo, sourceName, vehicleOf, telUrl, waUrl, firstMessage, WAIT_AMBER, WAIT_RED } from '../crm-rules.js';

// Call now: open leads nobody has contacted yet, oldest first, with a timer that keeps counting while the page is open.
// Colours: amber past 15 minutes, red past 2 hours, dark red past 24 hours. A lead with no owner can be taken in one tap.
let ticker = null;

export async function render(root, ctx) {
  clearInterval(ticker);
  const [raw, users] = await Promise.all([rpc('crm_call_queue'), ctx.can('assign_leads') ? ctx.users() : []]);
  const rows = callQueue(raw), me = ctx.me, tone = (t) => rows.filter((r) => r.wait.tone === t).length;
  const sum = rows.length ? `<p class="small muted">${rows.length} waiting · <b>${tone('amber')}</b> past ${WAIT_AMBER} min · <b>${tone('red')}</b> past ${WAIT_RED / 60} h · <b>${tone('dark')}</b> past 24 h · <b>${rows.filter((r) => r.unowned).length}</b> with no owner</p>` : '';
  const agents = (users || []).filter((u) => u.active);
  root.innerHTML = `${head('Call now', 'Leads nobody has contacted yet, oldest first. Call or message the first one, then log what happened. Every minute counts: leads called within ' + (me ? me.sla_minutes : 15) + ' minutes book far more often.')}
    ${sum}
    ${rows.length ? rows.map((l) => row(l, me, ctx, agents)).join('') : empty('Nobody is waiting for a first call. Well done.')}`;
  const tick = () => {
    if (!root.isConnected) return clearInterval(ticker);
    root.querySelectorAll('[data-created]').forEach((el) => {
      const w = waitInfo(el.dataset.created); el.textContent = w.label;
      const r = el.closest('.cq-row'); if (r) r.className = r.className.replace(/\bw-\w+/g, '') + ' w-' + w.tone;
    });
  };
  ticker = setInterval(tick, 20e3);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-cq]'); if (!b) return;
    const id = b.dataset.id;
    try {
      if (b.dataset.cq === 'open') return ctx.openLead(id, b.dataset.kind || 'call');
      if (b.dataset.cq === 'take') { await rpc('crm_claim', { p_id: id }); toast('It is yours. Call the customer now.'); await ctx.reload(); return ctx.openLead(id, 'call'); }
      if (b.dataset.cq === 'assign') {
        const to = root.querySelector('#as_' + id).value; if (!to) return toast('Choose who gets this lead.', true);
        await rpc('crm_assign', { p_id: id, p_user: to }); toast('Assigned.'); return ctx.reload();
      }
    } catch (err) { toast(clean(err), true); }
  });
}

function row(l, me, ctx, agents) {
  const src = sourceName(l.utm_source || l.source), mine = l.crm_owner && me && l.crm_owner === me.user_id;
  const take = l.unowned && ctx.can('take_leads'), assign = l.unowned && ctx.can('assign_leads') && agents.length;
  return `<article class="cq-row w-${l.wait.tone}${l.unowned ? ' unowned' : ''}" data-id="${l.id}">
    <div class="cq-wait" data-created="${esc(l.created_at)}" title="Time since the lead arrived">${esc(l.wait.label)}</div>
    <div><b>${esc(l.name)}</b>${vehicleTag(vehicleOf(l))} <small class="muted">${esc(src)}</small>
      <p class="small muted">${esc([l.bike, l.service_name, l.area].filter(Boolean).join(' · ') || 'No details yet')}</p>
      <p class="small">${l.unowned ? '<b class="badtxt">No owner yet</b>' : mine ? 'With you' : 'With ' + esc(l.owner_name || 'a colleague')}</p></div>
    <div class="cq-act">
      <a class="btn call" href="${telUrl(l.phone)}" data-cq="open" data-kind="call" data-id="${l.id}">Call now</a>
      <a class="btn wa" href="${waUrl(l.phone, firstMessage(l, me && me.name))}" target="_blank" rel="noopener" data-cq="open" data-kind="whatsapp" data-id="${l.id}">WhatsApp</a>
      ${take ? `<button class="btn primary" type="button" data-cq="take" data-id="${l.id}">Take this lead</button>` : ''}
      ${assign ? `<span class="cq-assign"><label class="tiny muted" for="as_${l.id}">Assign to</label><select id="as_${l.id}"><option value="">Choose</option>${agents.map((u) => `<option value="${u.user_id}">${esc(u.name)}</option>`).join('')}</select><button class="btn" type="button" data-cq="assign" data-id="${l.id}">Assign</button></span>` : ''}
    </div></article>`;
}
