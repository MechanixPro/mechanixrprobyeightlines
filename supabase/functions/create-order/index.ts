// POST /functions/v1/create-order  { ref, phone }
// Step 1 of online checkout (Razorpay Standard Checkout, or a Cashfree order when PAYMENT_GATEWAY=cashfree), used by the /pay/ page. Public, so the booking reference and the mobile number it was made with must both match.
// Creates a Razorpay order for what is due and returns what the checkout window needs. The key secret never leaves the server.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanOrderRequest, orderBody, slotFee } from '../_shared/checkout.ts';
import { isReturningCustomer } from '../_shared/customer.ts';
import { refFilter } from '../_shared/booking-id.ts';
import { gateway } from '../_shared/gateway.ts';
import { cashfreeReady, cashfreeMode, createCashfreeOrder, reusableOrder, isCashfreeOrderId, NOT_CONFIGURED } from '../_shared/cashfree.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  let gw: 'razorpay' | 'cashfree';
  try { gw = gateway(); } catch (e) { console.error((e as Error).message); return json(req, { error: 'Online payment is not available yet. Please pay through the link we send on WhatsApp.' }, 503); }
  const keyId = env('RAZORPAY_KEY_ID'), keySecret = env('RAZORPAY_KEY_SECRET');
  if (gw === 'cashfree' && !cashfreeReady()) { console.error(NOT_CONFIGURED); return json(req, { error: 'Online payment is not available yet. Please pay through the link we send on WhatsApp.' }, 503); }   // never falls back to Razorpay
  if (gw === 'razorpay' && (!keyId || !keySecret)) return json(req, { error: 'Online payment is not available yet. Please pay through the link we send on WhatsApp.' }, 503);

  const v = cleanOrderRequest(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Enter your booking reference (like MP-AB12CD) and the mobile number you booked with.' }, 400);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  const { data: lead } = await db.from('leads').select('id,ref,booking_id,name,phone,email,status,amount_due,paid_amount,confirm_fee,confirm_paid_at,rzp_order_id').or(refFilter(v.ref)).eq('phone', v.phone).maybeSingle();
  if (!lead) return json(req, { error: 'We could not find that booking. Check the reference and the number you booked with.' }, 404);
  if (lead.status === 'paid' || lead.status === 'completed') return json(req, { error: 'This booking is already paid. Thank you!' }, 409);
  if (lead.status === 'lost') return json(req, { error: 'This booking is closed. Message us on WhatsApp to start again.' }, 409);
  if (lead.confirm_paid_at) return json(req, { error: 'This booking is already paid. Thank you!' }, 409);
  // A confirmation-fee booking has one order: a second tap, a reload or a second device gets the same order, so it can only be paid once.
  // rzp_order_id holds the gateway's order id for whichever gateway made it; an id from the other gateway is never reused.
  if (lead.confirm_fee && lead.rzp_order_id && Number(lead.amount_due) === Number(lead.confirm_fee) && isCashfreeOrderId(lead.rzp_order_id) === (gw === 'cashfree')) {
    if (gw === 'razorpay') return json(req, { gateway: 'razorpay', order_id: lead.rzp_order_id, amount: Number(lead.confirm_fee) * 100, currency: 'INR', key_id: keyId, name: lead.name, booking_id: lead.booking_id ?? null, reused: true });
    const again = await reusableOrder(lead.rzp_order_id, Number(lead.confirm_fee));
    if (again && 'paid' in again) return json(req, { error: 'Your payment is being confirmed. We will message you on WhatsApp.' }, 409);
    if (again) return json(req, { gateway: 'cashfree', payment_session_id: again.payment_session_id, order_id: again.order_id, mode: cashfreeMode(), amount: again.amount, currency: 'INR', name: lead.name, booking_id: lead.booking_id ?? null, reused: true });
  }

  const { data: fees } = await db.from('services').select('id,price').in('id', ['advance', 'newfee']);
  const feeOf = (id: string) => Number(fees?.find((f: { id: string }) => f.id === id)?.price ?? 0);
  const returning = await isReturningCustomer(db, lead);
  const o = orderBody(lead, slotFee({ returning, advance: feeOf('advance'), newFee: feeOf('newfee') }), Date.now());
  if (!o.ok) return json(req, { error: o.error }, 400);

  if (gw === 'cashfree') {
    try {
      const cf = await createCashfreeOrder({ leadId: lead.id, ref: lead.ref, rupees: o.body.amount / 100, phone: lead.phone, email: lead.email, name: lead.name, note: lead.booking_id ? 'Mechanix Pro booking ' + lead.booking_id : 'Mechanix Pro booking', returnPath: '/pay/' });
      if (lead.confirm_fee) await db.from('leads').update({ rzp_order_id: cf.order_id }).eq('id', lead.id).is('confirm_paid_at', null);
      return json(req, { gateway: 'cashfree', payment_session_id: cf.payment_session_id, order_id: cf.order_id, mode: cashfreeMode(), amount: cf.amount, currency: 'INR', name: lead.name, booking_id: lead.booking_id ?? null });
    } catch (e) { console.error('cashfree order error', (e as Error).message); return json(req, { error: 'Could not start the payment. Please try again.' }, 500); }
  }
  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`), 'Content-Type': 'application/json' }, body: JSON.stringify(o.body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { console.error('razorpay auth failed'); return json(req, { error: 'Online payment is not set up correctly. Please pay through the link on WhatsApp.' }, 401); }
  if (!r.ok || !j.id) { console.error('razorpay order error', r.status, j?.error?.description); return json(req, { error: 'Could not start the payment. Please try again.' }, 500); }
  if (lead.confirm_fee) await db.from('leads').update({ rzp_order_id: j.id }).eq('id', lead.id).is('confirm_paid_at', null);
  return json(req, { gateway: 'razorpay', order_id: j.id, amount: j.amount, currency: j.currency, key_id: keyId, name: lead.name, booking_id: lead.booking_id ?? null });
});
