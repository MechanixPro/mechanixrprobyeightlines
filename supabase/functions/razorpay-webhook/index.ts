// Razorpay webhook: marks the booking paid, stops reminders, and confirms on WhatsApp.
// In Razorpay Dashboard → Webhooks, subscribe to "payment_link.paid". Deploy with --no-verify-jwt.
import { adminDb, env, hmacSha256Hex, safeEqual, rupee } from '../_shared/util.ts';
import { sendSmart, TPL } from '../_shared/whatsapp.ts';
import { bookingId } from '../_shared/booking-id.ts';
import { afterConfirmationPaid } from '../_shared/after-payment.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  const expected = await hmacSha256Hex(env('RAZORPAY_WEBHOOK_SECRET'), raw);
  if (!env('RAZORPAY_WEBHOOK_SECRET') || !safeEqual(req.headers.get('x-razorpay-signature') ?? '', expected)) return new Response('Bad signature', { status: 401 });

  const evt = JSON.parse(raw);
  // A closed browser tab after paying must still confirm the booking: Standard Checkout orders are confirmed here too (idempotent with verify-payment).
  if (evt.event === 'order.paid' || evt.event === 'payment.captured') return await orderPaid(evt);
  if (evt.event !== 'payment_link.paid') return new Response('ignored');
  const pl = evt.payload?.payment_link?.entity, pay = evt.payload?.payment?.entity;
  const leadId = pl?.notes?.lead_id;
  if (!leadId) return new Response('no lead');
  const db = adminDb();
  // A mechanic paying the company's share: record a remittance for that mechanic and booking. The booking itself stays as it is.
  if (pl?.notes?.purpose === 'remittance' && pl?.notes?.mechanic_id) {
    const amt = (pay?.amount ?? pl?.amount_paid ?? 0) / 100;
    const { error } = await db.from('ledger_entries').insert({ lead_id: leadId, mechanic_id: pl.notes.mechanic_id, entry_type: 'remittance', amount: amt, method: 'Razorpay payment link', reference: pay?.id ?? null, gateway_txn_id: pay?.id ?? null, source: 'gateway', note: 'Company share paid by the mechanic through a payment link' });
    if (error && error.code !== '23505') { console.error('remittance insert failed', error); return new Response('retry', { status: 500 }); }
    await db.from('audit_log').insert({ actor: null, action: 'mechanic_remitted', details: { lead: leadId, amount: amt, payment_id: pay?.id } });
    return new Response('ok');
  }
  // The final bill paid online from the technician or garage screen: record it, mark the job paid, and do NOT send the slot-confirmed message again.
  if (pl?.notes?.purpose === 'final') {
    const amt = (pay?.amount ?? pl?.amount_paid ?? 0) / 100;
    const { data: fl } = await db.from('leads').select('id,ref,final_paid_at').eq('id', leadId).maybeSingle();
    if (!fl || fl.final_paid_at) return new Response('ok');
    const { error } = await db.from('ledger_entries').insert({ lead_id: fl.id, entry_type: 'customer_payment', amount: amt, collected_by: 'company_portal', method: 'Razorpay payment link', reference: pay?.id ?? null, gateway_txn_id: pay?.id ?? null, gateway_fee: Math.round(Number(pay?.fee ?? 0)) / 100, source: 'gateway', settlement_status: 'pending' });
    if (error && error.code !== '23505') { console.error('final insert failed', error); return new Response('retry', { status: 500 }); }
    await db.from('leads').update({ final_paid_at: new Date().toISOString(), final_paid_method: 'online', final_paid_amount: amt }).eq('id', fl.id).is('final_paid_at', null);
    await db.from('crm_activities').insert({ lead_id: fl.id, actor: null, kind: 'note', body: `Paid online: Rs ${amt} (final bill).` }).then(() => {}, () => {});
    await db.from('audit_log').insert({ actor: null, action: 'final_paid_online', details: { lead: fl.ref, amount: amt, payment_id: pay?.id } });
    return new Response('ok');
  }
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead || lead.status === 'paid') { if (lead) await afterConfirmationPaid(db, lead.id); return new Response('ok'); }

  const amount = Math.round((pay?.amount ?? pl?.amount_paid ?? 0) / 100);
  const { error: ledgerErr } = await db.from('ledger_entries').insert({ lead_id: lead.id, entry_type: 'customer_payment', amount, collected_by: 'company_portal', method: 'Razorpay payment link', reference: pay?.id ?? null, gateway_txn_id: pay?.id ?? null, gateway_fee: Math.round(Number(pay?.fee ?? 0)) / 100, source: 'gateway', settlement_status: 'pending' });
  if (ledgerErr && ledgerErr.code !== '23505') console.error('ledger insert failed', ledgerErr);
  await db.from('leads').update({ status: 'paid', next_followup_at: null }).eq('id', lead.id);
  // The payment gives the booking its ID (database trigger): read it back so the message can carry it.
  const { data: ided } = await db.from('leads').select('booking_id').eq('id', lead.id).maybeSingle();
  const bid = bookingId(ided) ?? bookingId(lead);
  await db.from('audit_log').insert({ actor: null, action: 'payment_received', details: { lead: lead.ref, amount, payment_id: pay?.id } });
  await sendSmart(db, lead, `Payment of ${rupee(amount)} received for ${bid ? 'booking ' + bid : 'your request'}. Your slot is confirmed — we will share your mechanic's details before the visit. Thank you!`, { name: TPL.paid(), params: [String(amount), bid ?? 'request'] }, 'system');
  await afterConfirmationPaid(db, lead.id);
  return new Response('ok');
});

// order.paid / payment.captured for a Standard Checkout order. Same steps as verify-payment; the payment id makes a repeat harmless, so Razorpay retrying the webhook never double-counts or double-sends.
async function orderPaid(evt: any): Promise<Response> {
  const pay = evt.payload?.payment?.entity, order = evt.payload?.order?.entity;
  const leadId = order?.notes?.lead_id ?? pay?.notes?.lead_id;
  if (!leadId || !pay?.id || pay.status !== 'captured') return new Response('ignored');
  const db = adminDb();
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead) return new Response('no lead');
  const { data: seen } = await db.from('audit_log').select('id').eq('action', 'payment_received').eq('details->>payment_id', pay.id).limit(1);
  if (seen && seen.length) { await afterConfirmationPaid(db, lead.id); return new Response('ok'); }
  const amount = Math.round(Number(pay.amount) / 100);
  const { error: ledgerErr } = await db.from('ledger_entries').insert({ lead_id: lead.id, entry_type: 'customer_payment', amount, collected_by: 'company_portal', method: 'Razorpay', reference: pay.id, gateway_txn_id: pay.id, gateway_fee: Math.round(Number(pay.fee ?? 0)) / 100, source: 'gateway', settlement_status: 'pending' });
  if (ledgerErr && ledgerErr.code !== '23505') { console.error('ledger insert failed', ledgerErr); return new Response('retry', { status: 500 }); }
  await db.from('leads').update({ status: lead.status === 'completed' ? 'completed' : 'paid', next_followup_at: null }).eq('id', lead.id);
  const { data: ided } = await db.from('leads').select('booking_id').eq('id', lead.id).maybeSingle();
  const bid = bookingId(ided) ?? bookingId(lead);
  await db.from('audit_log').insert({ actor: null, action: 'payment_received', details: { lead: lead.ref, amount, payment_id: pay.id, order_id: order?.id ?? pay.order_id, via: 'webhook_order' } });
  try { await sendSmart(db, lead, `Payment of ${rupee(amount)} received for ${bid ? 'booking ' + bid : 'your request'}. Your slot is confirmed. Thank you!`, { name: TPL.paid(), params: [String(amount), bid ?? 'request'] }, 'system'); } catch (e) { console.error('whatsapp confirm failed', e); }
  await afterConfirmationPaid(db, lead.id);
  return new Response('ok');
}
