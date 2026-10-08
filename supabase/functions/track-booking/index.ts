// POST /functions/v1/track-booking  { ref, phone }
// Public, for the /track/ page. Both the reference and the booking's mobile number must match; the answer is progress only.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanLookup, trackView } from '../_shared/track.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const v = cleanLookup(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Enter your booking reference (like MP-AB12CD) and the mobile number you booked with.' }, 400);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  const { data: lead } = await db.from('leads').select('ref,status,phone,area,service_id,preferred_date,preferred_slot,preferred_time,est_total,bike_id,mechanic_id').eq('ref', v.ref).eq('phone', v.phone).maybeSingle();
  // The same answer for "no such reference" and "wrong number", so nobody can probe which references exist.
  if (!lead) return json(req, { error: 'We could not find that booking. Check the reference and the number you booked with.' }, 404);
  const [svc, bike, mech] = await Promise.all([
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model,nickname').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name,certified').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const b = bike.data as { brand?: string; model?: string; nickname?: string } | null;
  return json(req, trackView(lead, {
    service: (svc.data as { name?: string } | null)?.name ?? null,
    bike: b ? [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') : null, nick: b?.nickname ?? null,
    mechanic: (mech.data as { name?: string } | null)?.name ?? null, certified: (mech.data as { certified?: boolean } | null)?.certified,
  }));
});
