import { supabase, modal, field, esc, rupee, toast, clean } from '../ui.js';

/** The first payment: a secure link for the slot fee, sent from the desk's WhatsApp number when it is connected. */
export function sendPaymentLink(ctx, lead, done) {
  const m = modal({ title: 'Send the payment link', intro: `For ${esc(lead.name)} (${esc(lead.ref)}). Leave the amount empty to use the standard slot fee.`,
    body: `${field('Amount in rupees', 'amount', { type: 'number', min: 1, max: 100000, hint: ctx.can('assign_leads') ? 'As a supervisor you can send any amount up to ₹1,00,000.' : 'You can send up to the slot fee or the quote, whichever is higher.' })}
      <label class="check"><input type="checkbox" name="wa" checked><span>Send it on WhatsApp now</span></label><div id="result"></div>`,
    submit: 'Create and send link', onSubmit: async (f, d) => {
      const { data, error } = await supabase().functions.invoke('desk-payment-link', { body: { lead_id: lead.id, amount: d.amount ? Number(d.amount) : null, send_whatsapp: f.wa.checked } });
      if (error || data?.error) { let msg = data?.error; if (!msg && error?.context?.json) { try { msg = (await error.context.json()).error; } catch (x) { /* ignore */ } } throw new Error(msg || 'Could not create the link.'); }
      const box = f.querySelector('#result');
      const note = data.whatsapp_sent ? 'Sent on WhatsApp.' : data.whatsapp_note === 'not_connected' ? 'WhatsApp sending is not connected yet, so share the link yourself.' : (data.whatsapp_note ? 'WhatsApp did not send: ' + esc(data.whatsapp_note) : 'Not sent on WhatsApp.');
      box.innerHTML = `<p class="alert ${data.whatsapp_sent ? 'good' : ''}"><b>${rupee(data.amount)}</b> link ready. ${note}</p><p class="note-box">${esc(data.url)}</p>
        <div class="row wrap"><button class="btn" type="button" id="copy">Copy message</button><a class="btn wa" target="_blank" rel="noopener" href="https://wa.me/91${String(lead.phone).slice(-10)}?text=${encodeURIComponent(data.whatsapp_text)}">Open in WhatsApp</a></div>`;
      f.querySelector('#copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(data.whatsapp_text); toast('Copied.'); } catch (x) { toast('Copy failed. Select the link and copy it.', true); } });
      f.querySelector('button[type=submit]').remove(); const c = f.querySelector('[data-close]'); if (c) c.textContent = 'Done';
      done();
    } });
  return m;
}
