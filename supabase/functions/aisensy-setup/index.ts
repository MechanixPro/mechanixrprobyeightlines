// POST /functions/v1/aisensy-setup  { action: 'templates' | 'submit_templates' | 'campaigns' | 'create_campaigns' } — a supervisor sets up the desk's WhatsApp templates and API campaigns on AiSensy through its Project API.
// It only ever creates the templates and campaigns listed in _shared/desk-templates.ts, and skips any that already exist.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { env, json, corsHeaders } from '../_shared/util.ts';
import { PROJECT_API } from '../_shared/aisensy-project.ts';
import { DESK_TEMPLATES } from '../_shared/desk-templates.ts';
import { fetchContact } from '../_shared/aisensy-contact.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const { data: me } = await userClient.rpc('crm_me');
  if (!me || me.role !== 'supervisor') return json(req, { error: 'Supervisors only' }, 403);
  if (!env('AISENSY_PROJECT_KEY') || !env('AISENSY_PROJECT_ID')) return json(req, { error: 'AiSensy project id or password is not set' }, 503);
  const b = await req.json().catch(() => ({}));
  const base = `/project/${env('AISENSY_PROJECT_ID')}`;

  const call = async (method: string, path: string, body?: unknown) => {
    try {
      const r = await fetch(PROJECT_API + path, { method, headers: { 'Content-Type': 'application/json', 'X-AiSensy-Project-API-Pwd': env('AISENSY_PROJECT_KEY') }, body: body ? JSON.stringify(body) : undefined });
      const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { /* not json */ }
      return { status: r.status, body: j ?? t.slice(0, 300) };
    } catch { return { status: 0, body: 'Could not reach AiSensy' }; }
  };
  const listTemplates = async () => {
    const r = await call('GET', `${base}/wa_template/?limit=100`);
    const arr: any[] = Array.isArray(r.body) ? r.body : Array.isArray(r.body?.template) ? r.body.template : Array.isArray(r.body?.data) ? r.body.data : Array.isArray(r.body?.templates) ? r.body.templates : [];
    return { status: r.status, arr, raw: r.body };
  };

  if (b.action === 'templates') {
    const t = await listTemplates();
    return json(req, { status: t.status, templates: t.arr.map((x) => ({ name: x.name, status: x.status, category: x.category, language: x.language, id: x.id })), raw_shape: t.arr.length ? undefined : t.raw });
  }
  if (b.action === 'submit_templates') {
    const have = new Set((await listTemplates()).arr.map((x) => String(x.name)));
    const results = [];
    for (const t of DESK_TEMPLATES) {
      if (have.has(t.name)) { results.push({ name: t.name, skipped: 'already exists' }); continue; }
      const r = await call('POST', `${base}/wa_template`, { label: t.label, category: t.category, type: 'TEXT', language: 'English', name: t.name, text: t.text, sample_text: t.sample });
      results.push({ name: t.name, status: r.status, response: r.body });
    }
    return json(req, { results });
  }
  if (b.action === 'contact') {
    const r = await fetchContact({ projectId: env('AISENSY_PROJECT_ID'), password: env('AISENSY_PROJECT_KEY'), phone: String(b.phone ?? '') });
    return json(req, r.ok ? { found: r.state!.found, last_active: r.state!.lastActive ? new Date(r.state!.lastActive).toISOString() : null, window_open: r.state!.windowOpen, intervened: r.state!.intervened } : { error: r.error });
  }
  if (b.action === 'campaigns') {
    const r = await call('GET', `${base}/campaign`);
    return json(req, { status: r.status, body: r.body });
  }
  if (b.action === 'create_campaigns') {
    const tpl = await listTemplates();
    const results = [];
    for (const t of DESK_TEMPLATES) {
      const found = tpl.arr.find((x) => x.name === t.name);
      if (!found) { results.push({ campaign: t.campaign, skipped: 'template not submitted yet' }); continue; }
      const r = await call('POST', `${base}/campaign/api`, { template_name: t.name, campaign_name: t.campaign });
      results.push({ campaign: t.campaign, template_status: found.status, status: r.status, response: r.body });
    }
    return json(req, { results });
  }
  return json(req, { error: 'Unknown action' }, 400);
});
