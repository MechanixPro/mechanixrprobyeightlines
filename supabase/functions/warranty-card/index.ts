// POST /functions/v1/warranty-card  { lead_id } — a signed-in admin makes (or fetches) the warranty card for a completed booking and gets the link and a ready WhatsApp message.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { issueCard, cardUrl } from '../_shared/warranty.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return json(req, { error: 'Not allowed' }, 403);
  const b = await req.json().catch(() => ({}));
  const r = await issueCard(db, String(b.lead_id ?? ''));
  if (!r.card) return json(req, { error: r.error ?? 'Could not make the card' }, 400);
  await db.from('audit_log').insert({ actor: user.id, action: 'warranty_card_issued', details: { code: r.card.code } });
  return json(req, { ok: true, code: r.card.code, url: cardUrl(r.card.code), valid_until: r.card.valid_until, phone: r.card.phone, name: r.card.customer_name, sent_at: r.card.sent_at });
});
