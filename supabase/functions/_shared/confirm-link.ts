// The sales-call payment link for the confirmation fee. Used by desk-payment-link (Crew and Admin) and payment-link (Admin).
// The fee comes from the same function as the website path (confirm-fee.ts): never typed by hand, never from the browser. The link opens the website pay page with the reference filled in.
import { adminDb, env, getSetting } from './util.ts';
import { confirmFee, feeLine, FEE_IDS } from './confirm-fee.ts';
import { cleanEmail } from './email-address.ts';

type Db = ReturnType<typeof adminDb>;
export const CALL_SCRIPT = (amount: number) => `To confirm your slot, pay ₹${amount} on the link I'm sending now. The mechanic gets your address and you get the confirmation by email and WhatsApp. The ₹${amount} is adjusted in your final bill.`;
export const linkText = (first: string, amount: number, url: string) => `Hi ${first}, to confirm your slot pay ₹${amount} here: ${url}\nThe mechanic gets your address and you get the confirmation by email and WhatsApp. The ₹${amount} is adjusted in your final bill.`;

/** Works out the fee, saves it on the lead with the link, and sets the nudge. Does not send anything. Returns the link, the fee and a note for Crew when the fee needs a check. */
export async function prepareConfirmationLink(db: Db, lead: any, opts: { email?: unknown; actor?: string | null } = {}) {
  if (lead.confirm_paid_at || ['paid', 'scheduled', 'completed'].includes(lead.status)) throw new Error('This booking is already confirmed.');
  const typed = String(opts.email ?? '').trim();
  const email = typed ? cleanEmail(typed) : null;
  if (typed && !email) throw new Error('That email address does not look right.');
  if (email && lead.customer_id) await db.from('customers').update({ email }).eq('id', lead.customer_id);

  const [{ data: rows }, { data: bike }] = await Promise.all([
    db.from('services').select('id,price').in('id', [...FEE_IDS]).eq('active', true),
    lead.bike_id ? db.from('bikes').select('brand,model,engine_class').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const fee = confirmFee({ vehicle: lead.vehicle === 'car' ? 'car' : 'bike', model: (bike as any)?.model, engine: (bike as any)?.engine_class, rows: rows ?? [] });
  const url = `${env('SITE_URL', 'https://mechanixpro.in')}/pay/?ref=${encodeURIComponent(lead.ref)}`;
  const nudge = Math.max(5, Math.min(1440, Number(await getSetting(db, 'confirm_nudge_minutes', 30)) || 30));
  const now = new Date();
  const { error } = await db.from('leads').update({ confirm_fee: fee.amount, confirm_fee_review: fee.review, amount_due: fee.amount, payment_link: url, payment_link_id: null, payment_link_sent_at: now.toISOString(), status: lead.status === 'payment_sent' ? 'payment_sent' : 'payment_sent',
    followup_step: 2, next_followup_at: new Date(now.getTime() + nudge * 60_000).toISOString() }).eq('id', lead.id).is('confirm_paid_at', null);
  if (error) throw new Error('Could not save the link.');
  return { amount: fee.amount, url, review: fee.review, reason: fee.reason, feeLine: feeLine(lead.vehicle, fee.amount), nudgeMinutes: nudge, hasEmail: !!(email ?? lead.email) };
}
