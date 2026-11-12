// What a confirmed gateway payment does to our records. Gateway-neutral: the caller says which gateway (`method`) and passes the gateway's own payment id.
// Used by the Cashfree path (verify-payment and cashfree-webhook). The Razorpay functions keep their own proven copies of these steps.
// Every step is idempotent: the unique ledger gateway_txn_id plus the audit and final_paid_at guards make a repeat delivery harmless.
// No Deno-only imports here: the messaging steps come in as `Deps`, so Node can run these against a fake database. payment-effects-live.ts wires the real ones.
import { bookingId } from './booking-id.ts';

type Db = any;
export type Deps = {
  /** WhatsApp "payment received" for a booking payment. Must never throw. */
  paidMessage: (db: Db, lead: any, bid: string | null, amount: number) => Promise<void>;
  /** Email, receipt, WhatsApp and team alert for a paid confirmation fee. Must never throw. */
  afterPaid: (db: Db, leadId: string) => Promise<unknown>;
};
export type Paid = { leadId: string; paymentId: string; orderId: string; amount: number; fee: number; method: string; via: string };
export type Effect = { ok: true; already: boolean; bookingId?: string | null; amount: number; leadRef?: string } | { ok: false; status: number; error: string };

const note = (db: Db, leadId: string, body: string) => db.from('crm_activities').insert({ lead_id: leadId, actor: null, kind: 'note', body }).then(() => {}, () => {});

/** A booking payment (confirmation fee checkout, or an amount link): ledger row, status paid, booking ID, WhatsApp, and the confirmation messages. */
export async function applyBookingPaid(db: Db, p: Paid, d: Deps): Promise<Effect> {
  const { data: lead } = await db.from('leads').select('*').eq('id', p.leadId).maybeSingle();
  if (!lead) return { ok: false, status: 404, error: 'Booking not found.' };
  const { data: seen } = await db.from('audit_log').select('id').eq('action', 'payment_received').eq('details->>payment_id', p.paymentId).limit(1);
  if (seen && seen.length) { await d.afterPaid(db, lead.id); return { ok: true, already: true, bookingId: bookingId(lead), amount: p.amount, leadRef: lead.ref }; }
  const { error } = await db.from('ledger_entries').insert({ lead_id: lead.id, entry_type: 'customer_payment', amount: p.amount, collected_by: 'company_portal', method: p.method, reference: p.paymentId, gateway_txn_id: p.paymentId, gateway_fee: p.fee, source: 'gateway', settlement_status: 'pending' });
  if (error && error.code === '23505') { await d.afterPaid(db, lead.id); return { ok: true, already: true, bookingId: bookingId(lead), amount: p.amount, leadRef: lead.ref }; }   // another delivery got here first: it sends the messages
  if (error) { console.error('ledger insert failed', error.code); return { ok: false, status: 500, error: 'Could not record the payment.' }; }
  await db.from('leads').update({ status: lead.status === 'completed' ? 'completed' : 'paid', next_followup_at: null }).eq('id', lead.id);
  const { data: ided } = await db.from('leads').select('booking_id').eq('id', lead.id).maybeSingle();
  const bid = bookingId(ided) ?? bookingId(lead);
  await db.from('audit_log').insert({ actor: null, action: 'payment_received', details: { lead: lead.ref, amount: p.amount, payment_id: p.paymentId, order_id: p.orderId, via: p.via } });
  await d.paidMessage(db, lead, bid, p.amount);
  await d.afterPaid(db, lead.id);
  return { ok: true, already: false, bookingId: bid, amount: p.amount, leadRef: lead.ref };
}

/** The final bill paid online from the technician or garage screen: ledger row, job marked paid. No slot-confirmed message. */
export async function applyFinalPaid(db: Db, p: Paid): Promise<Effect> {
  const { data: fl } = await db.from('leads').select('id,ref,final_paid_at').eq('id', p.leadId).maybeSingle();
  if (!fl) return { ok: false, status: 404, error: 'Booking not found.' };
  if (fl.final_paid_at) return { ok: true, already: true, amount: p.amount, leadRef: fl.ref };
  const { error } = await db.from('ledger_entries').insert({ lead_id: fl.id, entry_type: 'customer_payment', amount: p.amount, collected_by: 'company_portal', method: p.method + ' payment link', reference: p.paymentId, gateway_txn_id: p.paymentId, gateway_fee: p.fee, source: 'gateway', settlement_status: 'pending' });
  if (error && error.code === '23505') return { ok: true, already: true, amount: p.amount, leadRef: fl.ref };
  if (error) { console.error('final insert failed', error.code); return { ok: false, status: 500, error: 'Could not record the payment.' }; }
  await db.from('leads').update({ final_paid_at: new Date().toISOString(), final_paid_method: 'online', final_paid_amount: p.amount }).eq('id', fl.id).is('final_paid_at', null);
  await note(db, fl.id, `Paid online: Rs ${p.amount} (final bill).`);
  await db.from('audit_log').insert({ actor: null, action: 'final_paid_online', details: { lead: fl.ref, amount: p.amount, payment_id: p.paymentId, order_id: p.orderId } });   // order_id lets admin-refund find the order to refund
  return { ok: true, already: false, amount: p.amount, leadRef: fl.ref };
}

/** A mechanic paying the company's share: a remittance for that mechanic and booking. The booking stays as it is. */
export async function applyRemittance(db: Db, p: Paid & { mechanicId: string }): Promise<Effect> {
  const { error } = await db.from('ledger_entries').insert({ lead_id: p.leadId, mechanic_id: p.mechanicId, entry_type: 'remittance', amount: p.amount, method: p.method + ' payment link', reference: p.paymentId, gateway_txn_id: p.paymentId, source: 'gateway', note: 'Company share paid by the mechanic through a payment link' });
  if (error && error.code === '23505') return { ok: true, already: true, amount: p.amount };
  if (error) { console.error('remittance insert failed', error.code); return { ok: false, status: 500, error: 'Could not record the payment.' }; }
  await db.from('audit_log').insert({ actor: null, action: 'mechanic_remitted', details: { lead: p.leadId, amount: p.amount, payment_id: p.paymentId } });
  return { ok: true, already: false, amount: p.amount };
}
