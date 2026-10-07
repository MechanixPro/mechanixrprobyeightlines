// POST /functions/v1/submit-lead — called by the website booking builder.
// Validates input, blocks bots (Turnstile) and spam (rate limits), prices on the server, saves the lead.
import { adminDb, env, json, corsHeaders, sha256Hex, priceBooking, respectQuietHours, rupee } from '../_shared/util.ts';
import { whatsappReady, sendTemplate, TPL } from '../_shared/whatsapp.ts';

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
  if (name.length < 2) return json(req, { error: 'Enter your name' }, 400);
  if (!/^[6-9]\d{9}$/.test(phone)) return json(req, { error: 'Enter a valid mobile number' }, 400);
  if (!SLOTS.includes(slot)) return json(req, { error: 'Pick a time slot' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(req, { error: 'Pick a day' }, 400);
  const day = new Date(date + 'T00:00:00+05:30'), now = Date.now();
  if (day.getTime() < now - 36 * 3600_000 || day.getTime() > now + 30 * 24 * 3600_000) return json(req, { error: 'Pick a day within the next 30 days' }, 400);

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
  const { data: cust, error: cErr } = await db.from('customers').upsert({ phone, name }, { onConflict: 'phone' }).select('id').single();
  if (cErr) { console.error(cErr); return json(req, { error: 'Could not save. Please message us on WhatsApp.' }, 500); }
  const { data: bike } = await db.from('bikes').insert({
    customer_id: cust.id, brand: clean(b.bike_brand, 30), model: clean(b.bike_model, 40), nickname: clean(b.bike_nickname, 24) || null, big_bike: b.big_bike === true,
  }).select('id').single();

  const consent = b.consent_whatsapp === true;
  const { data: lead, error } = await db.from('leads').insert({
    customer_id: cust.id, bike_id: bike?.id ?? null, name, phone,
    area: clean(b.area, 40), service_id: priced.service.id, addons: priced.addons.map((a) => a.id), est_total: priced.total,
    preferred_date: date, preferred_slot: slot, source: 'website', page: clean(b.page, 120),
    utm: typeof b.utm === 'object' && b.utm ? b.utm : {}, consent_whatsapp: consent, ip_hash: ipHash,
    // First automated nudge only if the customer does not continue on WhatsApp within 15 minutes.
    next_followup_at: consent ? respectQuietHours(new Date(now + 15 * 60_000)).toISOString() : null,
  }).select('id, ref').single();
  if (error) { console.error(error); return json(req, { error: 'Could not save. Please message us on WhatsApp.' }, 500); }

  // 6) Optional instant confirmation template (only if enabled and consented).
  if (consent && whatsappReady() && env('SEND_RECEIVED_TEMPLATE') === 'true') {
    const id = await sendTemplate(phone, TPL.received(), [name.split(' ')[0], lead.ref, priced.service.name]);
    await db.from('messages').insert({ lead_id: lead.id, phone, direction: 'out', sender: 'system', body: `Template ${TPL.received()}: booking ${lead.ref} received (${priced.service.name}, ${rupee(priced.total)})`, wa_message_id: id });
  }
  return json(req, { ok: true, ref: lead.ref, total: priced.total });
});
