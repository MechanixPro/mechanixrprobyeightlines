// POST /functions/v1/track-booking  { ref, phone }  or  { t }
// Public, for the /track/ page. Two ways in:
//  - the reference and the booking's mobile number (progress only, as before);
//  - the secret tracking link token t from the confirmation email (adds the door code, the address the customer gave, and the itemised quote with Approve and Decline).
// Both must match; the answer is the same for "no such booking" and "wrong number" so nobody can probe which references exist.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanLookup, trackView, journeyView } from '../_shared/track.ts';
import { refFilter } from '../_shared/booking-id.ts';
import { doorState } from '../_shared/handover.ts';

const COLS = 'id,booking_id,status,phone,area,pincode,address,service_id,preferred_date,preferred_slot,preferred_time,est_total,bike_id,mechanic_id,confirm_fee,confirm_paid_at,visit_stage,job_place,vehicle,lat,lng';
const NOT_FOUND = 'We could not find that booking. Check the reference and the number you booked with.';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({}));
  const token = /^[0-9a-f]{32}$/.test(String(body?.t ?? '')) ? String(body.t) : null;
  const v = token ? null : cleanLookup(body);
  if (!token && !v?.ok) return json(req, { error: 'Enter your booking reference (like MP-AB12CD) and the mobile number you booked with.' }, 400);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  // The secret link has 128 bits, so it cannot be guessed; the page polls it every 20 to 30 seconds while it is open, so it gets a much higher limit than the reference-and-phone lookup.
  if ((count ?? 0) >= (token ? 150 : 20)) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  let lead: any = null, secret: { code: string | null; address: string | null } | null = null;
  if (token) {
    const { data: sec } = await db.from('booking_secrets').select('lead_id,door_code').eq('track_token', token).maybeSingle();
    if (!sec) return json(req, { error: 'This link is not valid.' }, 404);
    const { data } = await db.from('leads').select(COLS).eq('id', sec.lead_id).is('deleted_at', null).maybeSingle();
    lead = data; secret = { code: sec.door_code ?? null, address: data ? [data.address, data.area, data.pincode].filter(Boolean).join(', ') || null : null };
    if (!lead) return json(req, { error: 'This link is not valid.' }, 404);
  } else {
    const { data } = await db.from('leads').select(COLS).or(refFilter(v!.ok ? v!.ref : '')).eq('phone', v!.ok ? v!.phone : '').is('deleted_at', null).maybeSingle();
    lead = data;
    if (!lead) return json(req, { error: NOT_FOUND }, 404);
  }
  const [svc, bike, mech, hand, quote, garage] = await Promise.all([
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model,nickname').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name,certified').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.confirm_fee != null ? db.from('handovers').select('kind,verified_at,locked_at,attempts,code_expires_at').eq('lead_id', lead.id).order('created_at', { ascending: false }) : Promise.resolve({ data: [] }),
    lead.confirm_fee != null ? db.from('job_quotes').select('status,version,eta_text,lines,subtotal,gst,total,fee_credit,balance,quote_no,valid_until,terms,change_request').eq('lead_id', lead.id).in('status', ['sent', 'approved', 'declined', 'changes_requested']).order('version', { ascending: false }).limit(1).maybeSingle() : Promise.resolve({ data: null }),
    db.from('garage_assignments').select('status').eq('lead_id', lead.id).in('status', ['sent', 'received', 'in_work', 'ready']).maybeSingle(),   // status only: never the garage's name
  ]);
  const b = bike.data as { brand?: string; model?: string; nickname?: string } | null;
  const doorVerified = doorState((hand.data ?? []) as any[]) === 'verified';
  const out = trackView(lead, {
    service: (svc.data as { name?: string } | null)?.name ?? null,
    bike: b ? [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') : null, nick: b?.nickname ?? null,
    mechanic: (mech.data as { name?: string } | null)?.name ?? null, certified: (mech.data as { certified?: boolean } | null)?.certified,
    doorVerified, secret, vehicle: lead.vehicle, quote: quote.data ? { ...(quote.data as any), expired: (quote.data as any).status === 'sent' && !!(quote.data as any).valid_until && Date.parse((quote.data as any).valid_until) < Date.now() } as any : null, garage: (garage.data as { status?: string } | null)?.status ?? null,
  });
  if (!token) return json(req, out);
  // After payment: the pieces only the holder of the private link gets (see journeyView).
  const live = ['on_the_way', 'arrived'].includes(String(lead.visit_stage ?? ''));
  const rpc = async (fn: string, args: Record<string, unknown>) => { const { data, error } = await db.rpc(fn, args); if (error) { console.error('track-booking', fn, error.code); return null; } return data as any; };
  const [details, loc, docs, hist, rate] = await Promise.all([
    rpc('booking_details_get', { p_token: token }), live ? rpc('booking_tech_location', { p_token: token }) : Promise.resolve(null),
    rpc('booking_documents', { p_token: token }), rpc('booking_history', { p_token: token }),
    lead.status === 'completed' ? db.from('lead_ratings').select('rating,comment').eq('lead_id', lead.id).maybeSingle().then((r: any) => r.data, () => null) : Promise.resolve(null),
  ]);
  const journey = journeyView({ lead, token, mechanicFirst: (mech.data as { name?: string } | null)?.name ? String((mech.data as { name?: string }).name).trim().split(/\s+/)[0] : null, details, live: loc, documents: docs, history: hist, vehicleName: b, rating: rate });
  return json(req, { ...out, token_mode: true, journey });
});
