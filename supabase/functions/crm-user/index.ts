// POST /functions/v1/crm-user  { name, email, role }
// Supervisor or owner only. Creates the sign-in for a new CRM team member (they then sign in with an emailed 6-digit code)
// and adds them to crm_users. Creating a sign-in needs the service role, so it cannot be done from the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { cleanCrmUser } from '../_shared/crm-user.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const { data: me, error: meErr } = await userClient.rpc('crm_me');
  if (meErr || me?.role !== 'supervisor') return json(req, { error: 'Only a supervisor can add team members' }, 403);

  const v = cleanCrmUser(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: v.error }, 400);
  const db = adminDb();
  const { data: created, error } = await db.auth.admin.createUser({ email: v.value.email, email_confirm: true, user_metadata: { crm: true } });
  if (error || !created?.user) {
    const taken = /already|registered|exists/i.test(error?.message ?? '');
    return json(req, { error: taken ? 'That email already has a sign-in. Ask the owner to add it from the admin.' : 'Could not create the sign-in' }, taken ? 409 : 400);
  }
  const { error: rowErr } = await db.from('crm_users').insert({ user_id: created.user.id, name: v.value.name, role: v.value.role });
  if (rowErr) { await db.auth.admin.deleteUser(created.user.id); return json(req, { error: 'Could not save the team member' }, 400); }
  await db.from('audit_log').insert({ actor: user.id, action: 'crm_user_added', details: { email: v.value.email, role: v.value.role } });
  return json(req, { ok: true, user_id: created.user.id });
});
