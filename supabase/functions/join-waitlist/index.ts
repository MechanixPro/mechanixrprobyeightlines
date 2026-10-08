// POST /functions/v1/join-waitlist  { name?, phone?, email?, interests[], city?, note?, consent }
// Public, for the "coming soon" section of the website. Allowed websites only, a per-visitor limit, validated input.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';
import { cleanWaitlist } from '../_shared/waitlist.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const v = cleanWaitlist(b);
  if (!v.ok) return json(req, { error: v.error }, 400);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const now = Date.now();
  const [{ count: lastTen }, { count: lastDay }] = await Promise.all([
    db.from('waitlist').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(now - 10 * 60_000).toISOString()),
    db.from('waitlist').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(now - 24 * 3600_000).toISOString()),
  ]);
  if ((lastTen ?? 0) >= 3 || (lastDay ?? 0) >= 10) return json(req, { error: 'Too many requests. Please try again later.' }, 429);

  const { error } = await db.from('waitlist').insert({ ...v.value, ip_hash: ipHash, source: 'website' });
  if (error) { console.error('waitlist insert failed'); return json(req, { error: 'Could not save. Please try again.' }, 500); }
  return json(req, { ok: true });
});
