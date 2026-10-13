// POST /functions/v1/log-click  { code, utm: { gclid, utm_* }, page }
// Public. Saves the ad click behind a WhatsApp Ref code so the admin can link a booking to it. Only ad visitors are saved; nothing about the person is kept.
import { adminDb, env, json, corsHeaders, sha256Hex } from '../_shared/util.ts';

const KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];
const strip = (v: unknown, n: number) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const origin = req.headers.get('origin') ?? '';
  if (origin && corsHeaders(req)['Access-Control-Allow-Origin'] !== origin) return json(req, { error: 'Not allowed' }, 403);
  const b = await req.json().catch(() => ({})) as { code?: string; utm?: Record<string, unknown>; page?: string };
  const code = String(b.code ?? '').toUpperCase();
  if (!/^[A-HJ-NP-Z2-9]{5}$/.test(code)) return json(req, { error: 'Bad code' }, 400);
  const utm: Record<string, string> = {};
  for (const k of KEYS) if (b.utm && b.utm[k]) utm[k] = strip(b.utm[k], 100);
  if (!utm.gclid && !utm.fbclid && !(utm.utm_source && utm.utm_source !== 'direct')) return json(req, { ok: true, saved: false });

  const db = adminDb();
  const ip = req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const ipHash = await sha256Hex((ip || 'unknown') + env('IP_SALT', 'mxp'));
  const { count } = await db.from('ad_clicks').select('code', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  if ((count ?? 0) >= 30) return json(req, { error: 'Too many requests' }, 429);
  const { error } = await db.from('ad_clicks').insert({ code, utm, gclid: utm.gclid ?? null, page: strip(b.page, 120) || null, ip_hash: ipHash });
  if (error && error.code !== '23505') { console.error('log-click', error); return json(req, { error: 'Could not save' }, 500); }
  return json(req, { ok: true, saved: !error });
});
