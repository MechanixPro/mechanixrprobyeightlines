// POST /functions/v1/create-order  { ref, phone }
// Step 1 of Razorpay Standard Checkout, used by the /pay/ page. Public, so the booking reference and the mobile number it was made with must both match.
// Creates a Razorpay order for what is due and returns what the checkout window needs. The key secret never leaves the server.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanOrderRequest, orderBody, slotFee } from '../_shared/checkout.ts';
import { isReturningCustomer } from '../_shared/customer.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const keyId = env('RAZORPAY_KEY_ID'), keySecret = env('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json(req, { error: 'Online payment is not available yet. Please pay through the link we send on WhatsApp.' }, 503);

  const v = cleanOrderRequest(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Enter your booking reference (like MP-AB12CD) and the mobile number you booked with.' }, 400);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  const { data: lead } = await db.from('leads').select('id,ref,name,phone,status,amount_due,paid_amount').eq('ref', v.ref).eq('phone', v.phone).maybeSingle();
  if (!lead) return json(req, { error: 'We could not find that booking. Check the reference and the number you booked with.' }, 404);
  if (lead.status === 'paid' || lead.status === 'completed') return json(req, { error: 'This booking is already paid. Thank you!' }, 409);
  if (lead.status === 'lost') return json(req, { error: 'This booking is closed. Message us on WhatsApp to start again.' }, 409);

  const { data: fees } = await db.from('services').select('id,price').in('id', ['advance', 'newfee']);
  const feeOf = (id: string) => Number(fees?.find((f: { id: string }) => f.id === id)?.price ?? 0);
  const returning = await isReturningCustomer(db, lead);
  const o = orderBody(lead, slotFee({ returning, advance: feeOf('advance'), newFee: feeOf('newfee') }), Date.now());
  if (!o.ok) return json(req, { error: o.error }, 400);

  const r = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`), 'Content-Type': 'application/json' }, body: JSON.stringify(o.body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) { console.error('razorpay auth failed'); return json(req, { error: 'Online payment is not set up correctly. Please pay through the link on WhatsApp.' }, 401); }
  if (!r.ok || !j.id) { console.error('razorpay order error', r.status, j?.error?.description); return json(req, { error: 'Could not start the payment. Please try again.' }, 500); }
  return json(req, { order_id: j.id, amount: j.amount, currency: j.currency, key_id: keyId, name: lead.name, ref: lead.ref });
});
