// POST /functions/v1/verify-payment  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
// Step 3 of Razorpay Standard Checkout. Marks a booking paid only when the signature is genuine AND Razorpay confirms the payment is captured for that order.
import { adminDb, env, json, corsHeaders, rupee } from '../_shared/util.ts';
import { cleanVerify, validSignature, paymentState } from '../_shared/checkout.ts';
import { sendSmart, TPL } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const keyId = env('RAZORPAY_KEY_ID'), keySecret = env('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json(req, { error: 'Online payment is not available yet.' }, 503);

  const v = cleanVerify(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Missing or invalid payment details.' }, 400);
  if (!(await validSignature(v.order_id, v.payment_id, v.signature, keySecret))) return json(req, { error: 'Payment signature did not match. Nothing was marked as paid.' }, 400);

  // The signature proves Razorpay issued these ids. Also ask Razorpay for the payment itself: it must belong to this order and be captured.
  const auth = 'Basic ' + btoa(`${keyId}:${keySecret}`);
  const pr = await fetch(`https://api.razorpay.com/v1/payments/${v.payment_id}`, { headers: { Authorization: auth } });
  const pay = await pr.json().catch(() => ({}));
  if (!pr.ok || pay.order_id !== v.order_id) return json(req, { error: 'Could not confirm this payment with Razorpay.' }, 400);
  const state = paymentState(pay);
  if (state === 'pending') return json(req, { ok: true, status: 'pending', message: 'Your payment is being confirmed. We will message you on WhatsApp.' }, 202);
  if (state !== 'paid') return json(req, { error: 'This payment was not completed. Nothing was marked as paid.' }, 400);

  const or = await fetch(`https://api.razorpay.com/v1/orders/${v.order_id}`, { headers: { Authorization: auth } });
  const order = await or.json().catch(() => ({}));
  const leadId = order?.notes?.lead_id;
  if (!or.ok || !leadId) return json(req, { error: 'Could not match this payment to a booking.' }, 400);

  const db = adminDb();
  const { data: seen } = await db.from('audit_log').select('id').eq('action', 'payment_received').eq('details->>payment_id', v.payment_id).limit(1);
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found.' }, 404);
  if (seen && seen.length) return json(req, { ok: true, status: 'paid', ref: lead.ref, already: true }); // the same payment verified twice counts once

  const amount = Math.round(Number(pay.amount) / 100);
  await db.from('leads').update({ status: lead.status === 'completed' ? 'completed' : 'paid', paid_amount: (lead.paid_amount ?? 0) + amount, paid_at: new Date().toISOString(), next_followup_at: null }).eq('id', lead.id);
  await db.from('audit_log').insert({ actor: null, action: 'payment_received', details: { lead: lead.ref, amount, payment_id: v.payment_id, order_id: v.order_id, via: 'checkout' } });
  try { await sendSmart(db, lead, `Payment of ${rupee(amount)} received for booking ${lead.ref}. Your slot is confirmed. We will share your mechanic's details before the visit. Thank you!`, { name: TPL.paid(), params: [String(amount), lead.ref] }, 'system'); } catch (e) { console.error('whatsapp confirm failed', e); }
  return json(req, { ok: true, status: 'paid', ref: lead.ref, amount });
});
