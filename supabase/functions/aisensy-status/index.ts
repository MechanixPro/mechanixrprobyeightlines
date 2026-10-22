// POST /functions/v1/aisensy-status — a supervisor checks that the AiSensy connection works. Shows which secrets are set and what AiSensy answers; never returns a secret.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env, json, corsHeaders } from '../_shared/util.ts';
import { PROJECT_API } from '../_shared/aisensy-project.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const { data: me } = await userClient.rpc('crm_me');
  if (!me || me.role !== 'supervisor') return json(req, { error: 'Supervisors only' }, 403);

  const set = { campaign_key: !!env('AISENSY_API_KEY'), project_password: !!env('AISENSY_PROJECT_KEY'), project_id: !!env('AISENSY_PROJECT_ID'), flow_secret: !!env('AISENSY_WEBHOOK_SECRET'), webhook_shared_secret: !!env('AISENSY_SHARED_SECRET') };
  const out: Record<string, unknown> = { secrets_set: set };
  const call = async (path: string) => {
    try {
      const r = await fetch(PROJECT_API + path, { headers: { 'X-AiSensy-Project-API-Pwd': env('AISENSY_PROJECT_KEY') } });
      const t = await r.text(); let body: any = null; try { body = JSON.parse(t); } catch { /* not json */ }
      return { status: r.status, body, text: body ? undefined : t.slice(0, 160) };
    } catch { return { status: 0, error: 'Could not reach AiSensy' }; }
  };
  if (set.project_password && set.project_id) {
    const p = await call(`/project/${env('AISENSY_PROJECT_ID')}`);
    out.project = { status: p.status, name: p.body?.name ?? p.body?.business_name ?? null, plan: p.body?.plan ?? p.body?.subscription ?? null, note: p.body?.message ?? p.text ?? p.error ?? null };
    const w = await call(`/project/${env('AISENSY_PROJECT_ID')}/webhook`);
    out.webhooks = { status: w.status, subscriptions: Array.isArray(w.body) ? w.body.map((x: any) => ({ topics: x.topics, url: x.webhook_url })) : null, note: Array.isArray(w.body) ? null : (w.body?.message ?? w.text ?? w.error ?? null) };
  }
  return json(req, out);
});
