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
  let uid: string | null = null;
  const { data: created, error } = await db.auth.admin.createUser({ email: v.value.email, email_confirm: true, user_metadata: { crm: true } });
  if (created?.user) uid = created.user.id;
  else {
    const taken = /already|registered|exists/i.test(error?.message ?? '');
    console.error('crm-user createUser failed', error?.status, error?.message);
    if (!taken) return json(req, { error: 'Could not create the sign-in: ' + String(error?.message ?? 'unknown error').slice(0, 140) }, 400);
    // The email already has a sign-in (for example an earlier attempt that did not finish). Reuse it unless it belongs to someone on the team.
    for (let page = 1; page <= 5 && !uid; page++) {
      const { data: list } = await db.auth.admin.listUsers({ page, perPage: 200 });
      const hit = list?.users?.find((u) => (u.email ?? '').toLowerCase() === v.value.email);
      if (hit) uid = hit.id;
      if (!list?.users?.length || list.users.length < 200) break;
    }
    if (!uid) return json(req, { error: 'That email already has a sign-in but it could not be found. Try another email.' }, 409);
    const [{ data: cu }, { data: ad }] = await Promise.all([db.from('crm_users').select('user_id').eq('user_id', uid).maybeSingle(), db.from('admins').select('user_id').eq('user_id', uid).maybeSingle()]);
    if (cu || ad) return json(req, { error: 'That person is already on the team.' }, 409);
  }
  const { error: rowErr } = await db.from('crm_users').insert({ user_id: uid, name: v.value.name, role: v.value.role });
  if (rowErr) { console.error('crm-user insert failed', rowErr.message); if (created?.user) await db.auth.admin.deleteUser(uid!); return json(req, { error: 'Could not save the team member: ' + rowErr.message.slice(0, 140) }, 400); }
  await db.from('audit_log').insert({ actor: user.id, action: 'crm_user_added', details: { email: v.value.email, role: v.value.role } });
  return json(req, { ok: true, user_id: uid });
});
