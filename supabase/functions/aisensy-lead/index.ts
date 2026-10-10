// POST /functions/v1/aisensy-lead — called by an AiSensy chatbot flow (its "API / webhook" step) when a customer has given booking details on WhatsApp.
// Secured by a shared secret in the x-aisensy-secret header (secret AISENSY_WEBHOOK_SECRET). Saves the booking into the admin like the website form does.
import { adminDb, env, json, safeEqual, last10, priceBooking } from '../_shared/util.ts';
import { cleanAisensyLead } from '../_shared/aisensy.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('AISENSY_WEBHOOK_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-aisensy-secret') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const v = cleanAisensyLead(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Invalid ' + v.error }, 400);
  const x = v.value, db = adminDb();

  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('phone', x.phone).gte('created_at', since);
  if ((count ?? 0) >= 3) return json(req, { error: 'Too many requests' }, 429);

  let est: number | null = null, serviceId: string | null = null;
  if (x.service_id) { const p = await priceBooking(db, x.service_id, [], false); if (p) { est = p.total; serviceId = p.service.id; } }
  const { data: cust, error: ce } = await db.from('customers').upsert({ phone: x.phone, name: x.name }, { onConflict: 'phone' }).select('id,blocked').single();
  if (ce) { console.error(ce); return json(req, { error: 'Could not save' }, 500); }
  if (cust.blocked) return json(req, { ok: true, ref: null });
  let bikeId: string | null = null;
  if (x.bike_brand || x.bike_model) {
    const { data: b } = await db.from('bikes').insert({ customer_id: cust.id, brand: x.bike_brand, model: x.bike_model, nickname: x.bike_nickname, big_bike: false }).select('id').single();
    bikeId = b?.id ?? null;
  }
  const { data: lead, error } = await db.from('leads').insert({
    customer_id: cust.id, bike_id: bikeId, name: x.name, phone: last10(x.phone), source: 'whatsapp', status: 'new', consent_whatsapp: true,
    service_id: serviceId, est_total: est, area: x.area, pincode: x.pincode, address: x.address, preferred_date: x.preferred_date, preferred_slot: x.preferred_slot,
    note: x.note, campaign: x.campaign, ref_code: x.ref_code, page: 'whatsapp-chatbot',
  }).select('ref').single();
  if (error) { console.error(error); return json(req, { error: 'Could not save' }, 500); }
  return json(req, { ok: true, ref: lead.ref, estimate: est });
});
