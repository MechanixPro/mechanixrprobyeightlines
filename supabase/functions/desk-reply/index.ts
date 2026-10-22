// POST /functions/v1/desk-reply  { lead_id, text } — a Care Buddy replies to a customer on WhatsApp from the desk number (AiSensy Project API, session message).
// The database decides who may do this (crm_chat_context). A free-text reply works only within 24 hours of the customer's last message; after that use a template.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendSessionText } from '../_shared/aisensy-project.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const { data: ctx, error: ce } = await userClient.rpc('crm_chat_context', { p_lead: String(b.lead_id ?? '') });
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : 400);
  if (ctx.opted_out) return json(req, { error: 'This customer asked not to get messages' }, 400);
  if (!ctx.window_open) return json(req, { error: 'More than 24 hours since the customer wrote. WhatsApp only allows a template message now.' }, 400);
  const text = String(b.text ?? '').trim();
  const r = await sendSessionText({ projectId: env('AISENSY_PROJECT_ID'), password: env('AISENSY_PROJECT_KEY'), phone: ctx.phone, text });
  if (!r.ok) return json(req, { error: r.error }, 400);
  const db = adminDb();
  await db.from('messages').insert({ lead_id: ctx.lead_id, phone: ctx.phone, direction: 'out', sender: 'staff', body: text.slice(0, 4000), wa_message_id: r.id ? 'as:' + r.id : null });
  await db.from('crm_activities').insert({ lead_id: ctx.lead_id, actor: user.id, kind: 'whatsapp', body: 'Replied on WhatsApp' });
  await db.from('leads').update({ crm_first_contact_at: new Date().toISOString() }).eq('id', ctx.lead_id).is('crm_first_contact_at', null);
  return json(req, { ok: true });
});
