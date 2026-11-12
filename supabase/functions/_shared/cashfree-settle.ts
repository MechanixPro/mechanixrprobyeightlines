// Confirms a Cashfree order with Cashfree itself, then applies the same effects as the Razorpay paths. Shared by verify-payment (browser) and cashfree-webhook.
// The browser's word is never used: only what Cashfree's API says about the order and its payments.
import { confirmOrderPayment, getCashfreeLink, isOurLinkId, rupees2, type Confirmed } from './cashfree.ts';
import { applyBookingPaid, applyFinalPaid, applyRemittance, type Effect, type Deps } from './payment-effects.ts';

export type Settled =
  | { kind: 'paid'; effect: Extract<Effect, { ok: true }>; leadId: string; purpose: string }
  | { kind: 'pending' | 'unpaid' | 'ignored' }
  | { kind: 'rejected'; reason: string }          // permanent: do not retry (amount mismatch, unknown link)
  | { kind: 'retry'; reason: string };            // transient: ask Cashfree to deliver again

export async function settleCashfreeOrder(db: any, orderId: string, via: string, deps: Deps, expectedRupees?: number): Promise<Settled> {
  let c: Confirmed;
  try { c = await confirmOrderPayment(orderId, expectedRupees); } catch (e) { console.error('cashfree confirm', (e as Error).message); return { kind: 'retry', reason: 'could not reach Cashfree' }; }
  if (c.state === 'foreign') return { kind: 'ignored' };
  if (c.state === 'pending' || c.state === 'unpaid') return { kind: c.state };
  if (c.state === 'mismatch') { console.error('cashfree amount mismatch', orderId, c.reason); await db.from('audit_log').insert({ actor: null, action: 'payment_rejected', details: { order_id: orderId, reason: c.reason, gateway: 'cashfree' } }).then(() => {}, () => {}); return { kind: 'rejected', reason: 'amount mismatch' }; }

  // Who is this for? A checkout order carries the booking in its tags; a Payment Link order carries our link id and the booking is in the link's notes.
  let leadId = c.tags.lead_id ?? '', purpose = 'booking', mechanicId = '', via2 = via;
  if (!leadId && c.tags.link_id) {
    if (!isOurLinkId(c.tags.link_id)) return { kind: 'ignored' };
    let link: any;
    try { link = await getCashfreeLink(c.tags.link_id); } catch (e) { console.error('cashfree link lookup', (e as Error).message); return { kind: 'retry', reason: 'could not read the payment link' }; }
    const n = link?.link_notes ?? {};
    leadId = String(n.lead_id ?? ''); purpose = String(n.purpose ?? 'booking'); mechanicId = String(n.mechanic_id ?? ''); via2 = via + '_link';
    if (!leadId) return { kind: 'rejected', reason: 'payment link has no booking' };
    if (rupees2(link.link_amount) !== c.amount) { console.error('cashfree link amount mismatch', c.tags.link_id); await db.from('audit_log').insert({ actor: null, action: 'payment_rejected', details: { order_id: orderId, reason: 'link amount differs', gateway: 'cashfree' } }).then(() => {}, () => {}); return { kind: 'rejected', reason: 'amount mismatch' }; }
  }
  if (!leadId) return { kind: 'ignored' };
  const p = { leadId, paymentId: c.paymentId, orderId, amount: c.amount, fee: c.fee, method: 'Cashfree', via: via2 };
  const effect = purpose === 'remittance' && mechanicId ? await applyRemittance(db, { ...p, mechanicId }) : purpose === 'final' ? await applyFinalPaid(db, p) : await applyBookingPaid(db, p, deps);
  if (!effect.ok) return effect.status === 404 ? { kind: 'rejected', reason: effect.error } : { kind: 'retry', reason: effect.error };
  return { kind: 'paid', effect, leadId, purpose };
}
