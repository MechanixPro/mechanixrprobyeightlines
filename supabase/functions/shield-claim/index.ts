// POST /functions/v1/shield-claim  { t, description }
// Public, for the Mechanix Shield card on the private tracking page. The secret link token must match a completed booking inside the 48 hour window; the database checks all of that (shield_claim_create).
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const body = await req.json().catch(() => ({}));
  const token = /^[0-9a-f]{32}$/.test(String(body?.t ?? '')) ? String(body.t) : null;
  if (!token) return json(req, { error: 'This link is not valid.' }, 400);
  const description = String(body?.description ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 800);

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('track_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 20) return json(req, { error: 'Too many tries. Please wait a few minutes.' }, 429);
  await db.from('track_attempts').insert({ ip_hash: ipHash });

  const { data, error } = await db.rpc('shield_claim_create', { p_token: token, p_description: description });
  if (error) { console.error('shield-claim', error.code); return json(req, { error: 'Could not send your request. Please try again or message us.' }, 500); }
  const out = data as { ok: boolean; error?: string };
  return json(req, out.ok ? { ok: true } : { error: out.error ?? 'Could not send your request.' }, out.ok ? 200 : 400);
});
