import { rpc, esc, head, empty, when, toast, clean } from '../ui.js';
import { ago } from '../crm-rules.js';

// Customers who wrote on the desk's WhatsApp number and have not had an answer yet.
// There is no webhook, so the desk learns this by asking AiSensy every few minutes about each open lead (see desk-poll-replies).
export async function render(root, ctx) {
  const [list, links] = await Promise.all([rpc('crm_replies_waiting'), rpc('crm_wa_links').catch(() => ({}))]);
  const live = links?.live_chat;
  root.innerHTML = `${head('Inbox', 'Customers who wrote on WhatsApp and are waiting for an answer. Oldest first. This list updates every few minutes.',
    `${live ? `<a class="btn wa" href="${esc(live)}" target="_blank" rel="noopener">Open AiSensy Live Chat</a>` : ''}<button class="btn" type="button" id="refresh">Refresh</button>`)}
    ${list.length ? `<div class="cards">${list.map((c) => card(c, ctx)).join('')}</div>` : empty('Nobody is waiting. Every customer who wrote has had an answer.')}
    <p class="small muted">A new number that has never been a lead shows only in AiSensy Live Chat. Open it there, then add the customer here with <b>+ Lead</b> or <b>+ Booking</b>. The words customers type are read in AiSensy Live Chat; replies can be sent here.</p>`;
  root.querySelector('#refresh').addEventListener('click', () => ctx.reload());
  root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => ctx.openLead(b.dataset.open, 'whatsapp')));
  root.querySelectorAll('[data-take]').forEach((b) => b.addEventListener('click', async () => { try { await rpc('crm_claim', { p_id: b.dataset.take }); toast('It is yours. Reply now.'); ctx.reload(); ctx.openLead(b.dataset.take, 'whatsapp'); } catch (e) { toast(clean(e), true); } }));
}

const mins = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60e3));
function card(c, ctx) {
  const m = mins(c.wrote_at), late = m > 15;
  return `<article class="lead-card tone-${late ? 'late' : 'new'}"><div class="lc-top"><div><h2>${esc(c.name)}</h2><p class="muted small">${esc(c.ref)} · wrote ${when(c.wrote_at)}</p></div>${c.unassigned ? '<span class="chip late">Unassigned</span>' : `<span class="chip soft">${esc(c.owner || '')}</span>`}</div>
    <div class="timer t-${late ? 'late' : 'new'}">Waiting ${ago(c.wrote_at).replace(' ago', '')}${late ? '. Reply now' : ''}</div>
    <div class="lc-actions">${c.unassigned && ctx.can('take_leads') ? `<button class="btn primary" type="button" data-take="${c.id}">Take and reply</button>` : ''}<button class="btn ${c.unassigned ? 'ghost' : 'primary'}" type="button" data-open="${c.id}">Open and reply</button></div></article>`;
}
