// POST /functions/v1/book-start  — the /book/ page. Public.
// Saves the booking details (vehicle, address, slot, contact, email) as a lead, works out the confirmation fee ON THE SERVER, and opens one Razorpay order for it.
// The booking is confirmed only when verify-payment (or the webhook) sees the payment. Idempotent: the same client_key never makes a second lead or a second order.
import { adminDb, env, json, corsHeaders, sha256Hex, priceBooking } from '../_shared/util.ts';
import { cleanLeadFields } from '../_shared/lead-fields.ts';
import { orderBody } from '../_shared/checkout.ts';
import { confirmFee, feeLine, FEE_IDS } from '../_shared/confirm-fee.ts';
import { cleanBooking } from '../_shared/book-form.ts';
import { vehicleCols } from '../_shared/vehicle.ts';
import { alertNewLead } from '../_shared/new-lead-alert.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const keyId = env('RAZORPAY_KEY_ID'), keySecret = env('RAZORPAY_KEY_SECRET');
  if (!keyId || !keySecret) return json(req, { error: 'Online payment is not available yet. Message us on WhatsApp and we will help you book.' }, 503);
  let raw: Record<string, unknown>;
  try { raw = await req.json(); } catch { return json(req, { error: 'Invalid request' }, 400); }
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

  const tsSecret = env('TURNSTILE_SECRET');
  if (tsSecret) {
    const form = new FormData(); form.append('secret', tsSecret); form.append('response', String(raw.turnstile_token ?? '').slice(0, 2048)); if (ip) form.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!v.success) return json(req, { error: 'Security check failed. Reload the page and try again.' }, 403);
  }

  const v = cleanBooking(raw, Date.now());
  if (!v.ok) return json(req, { error: v.error, field: v.field }, 400);
  const b = v.value, db = adminDb();
  const ipHash = ip ? await sha256Hex(ip + env('IP_SALT', 'mxp')) : null;

  const { data: feeRows } = await db.from('services').select('id,price').in('id', [...FEE_IDS]).eq('active', true);
  const fee = confirmFee({ vehicle: b.vehicle, model: b.model, engine: b.engine_class, rows: feeRows ?? [] });   // never from the browser

  // Same form, same lead: a double tap, a refresh or a retry finds the lead made the first time.
  const { data: existing } = await db.from('leads').select('id,ref,name,phone,status,confirm_fee,confirm_paid_at,rzp_order_id,booking_id').eq('client_key', b.client_key).maybeSingle();
  if (existing && existing.phone !== b.phone) return json(req, { error: 'This form was already used. Reload the page.' }, 409);
  if (existing?.confirm_paid_at) return json(req, { ok: true, status: 'paid', already: true, booking_id: existing.booking_id ?? null });

  let lead = existing as any;
  if (!lead) {
    const since10 = new Date(Date.now() - 10 * 60_000).toISOString(), since60 = new Date(Date.now() - 3600_000).toISOString();
    const [{ count: byPhone }, { count: byIp }] = await Promise.all([
      db.from('leads').select('id', { count: 'exact', head: true }).eq('phone', b.phone).gte('created_at', since10),
      ipHash ? db.from('leads').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since60) : Promise.resolve({ count: 0 }),
    ]);
    if ((byPhone ?? 0) >= 3 || (byIp ?? 0) >= 10) return json(req, { error: 'Too many tries. Please wait a few minutes or message us on WhatsApp.' }, 429);

    let est: number | null = null, serviceId: string | null = null, serviceName = '';
    if (b.vehicle === 'bike') {
      const priced = await priceBooking(db, b.service_id, [], b.engine_class === 'big', b.engine_class);
      if (!priced) return json(req, { error: 'Choose what your bike needs.' }, 400);
      est = priced.total; serviceId = priced.service.id; serviceName = priced.service.name;
    }
    const { data: cust, error: cErr } = await db.from('customers').upsert({ phone: b.phone, name: b.name, email: b.email }, { onConflict: 'phone' }).select('id,blocked').single();
    if (cErr) { console.error('book-start customer', cErr); return json(req, { error: 'Could not save. Please try again.' }, 500); }
    if (cust.blocked) return json(req, { error: 'We could not take this booking online. Please call us.' }, 403);
    const { data: bike } = await db.from('bikes').insert({ customer_id: cust.id, brand: b.brand, model: b.model, big_bike: b.engine_class === 'big', engine_class: b.vehicle === 'bike' ? b.engine_class : null }).select('id').single();
    const extra = cleanLeadFields({ note: b.note, lat: b.lat, lng: b.lng, utm: undefined, ref_code: b.ref_code, campaign: b.campaign });
    const { data: ins, error } = await db.from('leads').insert({
      customer_id: cust.id, bike_id: bike?.id ?? null, name: b.name, phone: b.phone, email: b.email, ...vehicleCols(b.vehicle), place: 'home', contact_pref: 'whatsapp',
      address: b.address, area: b.area, pincode: b.pincode, lat: extra.lat, lng: extra.lng, note: b.vehicle === 'car' ? [`Car: ${b.brand} ${b.model}`.trim(), b.need_text, extra.note].filter(Boolean).join('. ').slice(0, 300) : extra.note,
      ref_code: extra.ref_code, campaign: extra.campaign, service_id: serviceId, est_total: est, addons: [], preferred_date: b.preferred_date, preferred_slot: b.preferred_slot,
      source: 'website', page: '/book/', utm: b.utm, consent_whatsapp: b.consent_whatsapp, ip_hash: ipHash, status: 'payment_sent',
      confirm_fee: fee.amount, confirm_fee_review: fee.review, amount_due: fee.amount, client_key: b.client_key,
    }).select('id,ref,name,phone,status,confirm_fee,confirm_paid_at,rzp_order_id,booking_id').single();
    if (error) {
      if (error.code === '23505') { const { data: again } = await db.from('leads').select('id,ref,name,phone,status,confirm_fee,confirm_paid_at,rzp_order_id,booking_id').eq('client_key', b.client_key).maybeSingle(); lead = again; }
      else { console.error('book-start lead', error); return json(req, { error: 'Could not save. Please try again.' }, 500); }
    } else {
      lead = ins;
      await alertNewLead(db, { name: b.name, phone: b.phone, source: 'website', area: b.area, service: serviceName || (b.vehicle === 'car' ? 'Car service' : null), note: `Booking started: confirmation fee ₹${fee.amount} not paid yet` });
    }
  }
  if (!lead) return json(req, { error: 'Could not save. Please try again.' }, 500);

  // One order per lead. A saved order is reused, so a second tap or a reload never creates a second thing to pay.
  if (lead.rzp_order_id && Number(lead.confirm_fee) === fee.amount) {
    return json(req, { ok: true, order_id: lead.rzp_order_id, amount: fee.amount * 100, currency: 'INR', key_id: keyId, name: lead.name, fee: fee.amount, fee_line: feeLine(b.vehicle, fee.amount), reused: true });
  }
  const o = orderBody({ id: lead.id, ref: lead.ref, amount_due: fee.amount }, fee.amount, Date.now());
  if (!o.ok) return json(req, { error: o.error }, 400);
  const r = await fetch('https://api.razorpay.com/v1/orders', { method: 'POST', headers: { Authorization: 'Basic ' + btoa(`${keyId}:${keySecret}`), 'Content-Type': 'application/json' }, body: JSON.stringify(o.body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) { console.error('book-start razorpay', r.status, j?.error?.description); return json(req, { error: 'Could not start the payment. Please try again.' }, 502); }
  await db.from('leads').update({ rzp_order_id: j.id, confirm_fee: fee.amount, amount_due: fee.amount, confirm_fee_review: fee.review }).eq('id', lead.id).is('confirm_paid_at', null);
  return json(req, { ok: true, order_id: j.id, amount: j.amount, currency: j.currency, key_id: keyId, name: lead.name, fee: fee.amount, fee_line: feeLine(b.vehicle, fee.amount) });
});
