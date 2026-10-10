// POST /functions/v1/submit-lead — called by the website booking builder.
// Validates input, blocks bots (Turnstile) and spam (rate limits), prices on the server, saves the lead.
import { adminDb, env, json, corsHeaders, sha256Hex, priceBooking, respectQuietHours, rupee } from '../_shared/util.ts';
import { whatsappReady, sendTemplate, TPL } from '../_shared/whatsapp.ts';
import { cleanLeadFields } from '../_shared/lead-fields.ts';
import { applyCoupon, normalizeCode } from '../_shared/coupons.ts';
import { sendEmail, FROM_BOOKING } from '../_shared/resend.ts';
import { bookingReceived } from '../_shared/email-templates.ts';
import { formatWhen } from '../_shared/when.ts';

const SLOTS = ['morning', 'afternoon', 'evening', 'asap'];
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { error: 'Invalid request' }, 400); }

  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';

  // 1) Bot check (Cloudflare Turnstile) — enforced once TURNSTILE_SECRET is set.
  const tsSecret = env('TURNSTILE_SECRET');
  if (tsSecret) {
    const form = new FormData();
    form.append('secret', tsSecret); form.append('response', clean(b.turnstile_token, 2048)); if (ip) form.append('remoteip', ip);
    const v = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ success: false }));
    if (!v.success) return json(req, { error: 'Security check failed' }, 403);
  }

  // 2) Validate
  const name = clean(b.name, 60);
  const phone = String(b.phone ?? '').replace(/\D/g, '').slice(-10);
  const serviceId = clean(b.service_id, 30);
  const addons = Array.isArray(b.addons) ? b.addons.map((a) => clean(a, 30)).slice(0, 10) : [];
  const slot = clean(b.preferred_slot, 12);
  const date = clean(b.preferred_date, 10);
  const extra = cleanLeadFields(b);
  const isCallback = extra.request_type === 'callback'; // a call-back request needs only name, number and service
  if (name.length < 2) return json(req, { error: 'Enter your name' }, 400);
  if (!/^[6-9]\d{9}$/.test(phone)) return json(req, { error: 'Enter a valid mobile number' }, 400);
  const now = Date.now();
  if (!(isCallback || SLOTS.includes(slot))) return json(req, { error: 'Pick a time slot' }, 400);
  if (!(isCallback || /^\d{4}-\d{2}-\d{2}$/.test(date))) return json(req, { error: 'Pick a day' }, 400);
  const day = new Date(date + 'T00:00:00+05:30');
  if (!isCallback && (day.getTime() < now - 36 * 3600_000 || day.getTime() > now + 30 * 24 * 3600_000)) return json(req, { error: 'Pick a day within the next 30 days' }, 400);
  const prefDate = isCallback ? new Date(now + 330 * 60_000).toISOString().slice(0, 10) : date;
  const prefSlot = isCallback ? 'asap' : slot;

  const db = adminDb();
  const ipHash = ip ? await sha256Hex(ip + env('IP_SALT', 'mxp')) : null;

  // 3) Rate limits: 3 bookings per number per 10 min, 10 per IP per hour.
  const since10 = new Date(now - 10 * 60_000).toISOString(), since60 = new Date(now - 3600_000).toISOString();
  const [{ count: byPhone }, { count: byIp }] = await Promise.all([
    db.from('leads').select('id', { count: 'exact', head: true }).eq('phone', phone).gte('created_at', since10),
    ipHash ? db.from('leads').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', since60) : Promise.resolve({ count: 0 }),
  ]);
  if ((byPhone ?? 0) >= 3 || (byIp ?? 0) >= 10) return json(req, { error: 'Too many requests' }, 429);

  // 4) Price on the server
  const priced = await priceBooking(db, serviceId, addons, b.big_bike === true);
  if (!priced) return json(req, { error: 'Choose a valid service' }, 400);

  // 5) Customer + bike (shared with the future app)
  const { data: cust, error: cErr } = await db.from('customers').upsert({ phone, name }, { onConflict: 'phone' }).select('id, blocked').single();
  if (cErr) { console.error(cErr); return json(req, { error: 'Could not save. Please message us on WhatsApp.' }, 500); }
  // A blocked customer's booking is not saved. They still reach WhatsApp from the website, so nobody is left stuck.
  if (cust.blocked) return json(req, { ok: true, ref: null, total: priced.total });
  const { data: bike } = await db.from('bikes').insert({
    customer_id: cust.id, brand: clean(b.bike_brand, 30), model: clean(b.bike_model, 40), nickname: clean(b.bike_nickname, 24) || null, big_bike: b.big_bike === true,
  }).select('id').single();

  // Coupon: checked here, never trusted from the browser. A bad code simply gives no discount.
  const couponCode = normalizeCode(b.coupon_code);
  let couponDiscount = 0;
  if (couponCode) {
    const { data: coupon } = await db.from('coupons').select('*').eq('code', couponCode).maybeSingle();
    const { count: usedCount } = coupon ? await db.from('leads').select('id', { count: 'exact', head: true }).eq('coupon_code', couponCode).in('status', ['paid', 'scheduled', 'completed']) : { count: 0 };
    couponDiscount = applyCoupon(coupon, priced.total, usedCount ?? 0).discount;
  }

  const consent = b.consent_whatsapp === true;
  const { data: lead, error } = await db.from('leads').insert({
    customer_id: cust.id, bike_id: bike?.id ?? null, ...extra, coupon_code: couponCode || null, coupon_discount: couponDiscount, name, phone,
    area: clean(b.area, 40), service_id: priced.service.id, addons: priced.addons.map((a) => a.id), est_total: priced.total,
    preferred_date: prefDate, preferred_slot: prefSlot, source: 'website', page: clean(b.page, 120),
    utm: typeof b.utm === 'object' && b.utm ? b.utm : {}, consent_whatsapp: consent, ip_hash: ipHash,
    // First automated nudge only if the customer does not continue on WhatsApp within 15 minutes.
    next_followup_at: consent ? respectQuietHours(new Date(now + 15 * 60_000)).toISOString() : null,
  }).select('id, ref').single();
  if (error) { console.error(error); return json(req, { error: 'Could not save. Please message us on WhatsApp.' }, 500); }

  // Confirmation email (optional, only when the customer gave an address). It can never block or fail the booking.
  if (extra.email) {
    try {
      const upd: Record<string, unknown> = { email: extra.email };
      if (extra.email_marketing) { upd.email_marketing_consent = true; upd.email_unsubscribed_at = null; }
      await db.from('customers').update(upd).eq('id', cust.id);
      const { data: feeRow } = await db.from('services').select('price').eq('id', 'advance').maybeSingle();
      const brand = clean(b.bike_brand, 30), model = clean(b.bike_model, 40), nick = clean(b.bike_nickname, 24);
      const buildQ = new URLSearchParams({ ...(brand && brand !== 'Other' ? { brand } : {}), ...(model ? { model } : {}), ...(nick ? { nick } : {}), service: serviceId }).toString();
      const mail = bookingReceived({ checkupFee: feeRow?.price ?? null, nick: nick || null, buildUrl: env('SITE_URL', 'https://mechanixpro.in') + '/book/?' + buildQ,
        siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 83106 21498'), phoneTel: env('PHONE_TEL', '+918310621498'),
        whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918310621498'), email: 'hello@mechanixpro.in',
        name, ref: lead.ref, bike: (() => { const base = [brand, model].filter((x) => x && x !== 'Other').join(' ') || 'Your bike'; return nick ? `"${nick}" (${base})` : base; })(),
        service: priced.service.name, area: clean(b.area, 40) || 'Bengaluru', whenText: isCallback ? 'We will call you back soon' : formatWhen(date, slot, extra.preferred_time), estimate: priced.total,
      });
      const r = await sendEmail({ to: extra.email, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template: 'booking_received' } });
      await db.from('email_log').insert({ lead_id: lead.id, to_email: extra.email, template: 'booking_received', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    } catch (e) { console.error('email failed', e); }
  }

  // 6) Optional instant confirmation template (only if enabled and consented).
  if (consent && whatsappReady() && env('SEND_RECEIVED_TEMPLATE') === 'true') {
    const id = await sendTemplate(phone, TPL.received(), [name.split(' ')[0], lead.ref, priced.service.name]);
    await db.from('messages').insert({ lead_id: lead.id, phone, direction: 'out', sender: 'system', body: `Template ${TPL.received()}: booking ${lead.ref} received (${priced.service.name}, ${rupee(priced.total)})`, wa_message_id: id });
  }
  return json(req, { ok: true, ref: lead.ref, total: priced.total, coupon_discount: couponDiscount });
});
