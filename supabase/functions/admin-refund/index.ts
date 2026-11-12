// POST /functions/v1/admin-refund  { lead_id, amount (rupees), reason, service_issue? }
// "Refund to customer now": Admin only. Deploy with verify_jwt = true (config.toml). The caller's token is checked by the platform, then here by the database: is_admin() must be true or the answer is 403.
// Crew can never trigger this. Cancelling a booking does not trigger it either: an Admin presses the button. The rules and the Cashfree call live in _shared/admin-refund.ts.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { runRefund } from '../_shared/admin-refund.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const { data: isAdmin, error } = await userClient.rpc('is_admin');   // the database decides, with the caller's own token
  if (error || isAdmin !== true) return json(req, { error: 'Only an Admin can refund money to a customer.' }, 403);
  const b = await req.json().catch(() => ({}));
  const out = await runRefund(adminDb(), { adminId: user.id, leadId: String(b.lead_id ?? ''), amount: b.amount, reason: b.reason, serviceIssue: b.service_issue });
  return json(req, out.body, out.status);
});
