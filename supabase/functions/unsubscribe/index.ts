// POST /functions/v1/unsubscribe?c=<customer id>&t=<token>  (or the same fields as JSON)
// Stops marketing email for one customer. Used by the /unsubscribe/ page and by the one-click link mail apps show.
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { verifyUnsub } from '../_shared/unsub.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const c = String(url.searchParams.get('c') ?? body.c ?? '').slice(0, 64), t = String(url.searchParams.get('t') ?? body.t ?? '').slice(0, 64);
  if (!/^[0-9a-f-]{36}$/i.test(c) || !t) return json(req, { error: 'This link is not valid' }, 400);
  if (!(await verifyUnsub(c, t, env('SUPABASE_SERVICE_ROLE_KEY')))) return json(req, { error: 'This link is not valid' }, 400);
  const { error } = await adminDb().from('customers').update({ email_marketing_consent: false, email_unsubscribed_at: new Date().toISOString() }).eq('id', c);
  if (error) return json(req, { error: 'Could not update. Please email hello@mechanixpro.in.' }, 500);
  return json(req, { ok: true });
});
