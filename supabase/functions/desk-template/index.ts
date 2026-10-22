// POST /functions/v1/desk-template  { lead_id, kind: 'followup' | 'rating' } — a Care Buddy sends an approved WhatsApp template from the desk number (AiSensy Campaign API).
// Works outside the 24-hour window, which is when a template is the only thing WhatsApp allows. The database decides who may do this (crm_chat_context).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendCampaign } from '../_shared/aisensy-send.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const kind = String(b.kind ?? '');
  if (!['followup', 'rating'].includes(kind)) return json(req, { error: 'Unknown template' }, 400);
  const { data: ctx, error: ce } = await userClient.rpc('crm_chat_context', { p_lead: String(b.lead_id ?? '') });
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : 400);
  if (ctx.opted_out) return json(req, { error: 'This customer asked not to get messages' }, 400);
  if (!env('AISENSY_API_KEY')) return json(req, { error: 'WhatsApp sending is not connected yet' }, 503);
  const db = adminDb();
  const { data: lead } = await db.from('leads').select('id,ref,name,phone,status').eq('id', ctx.lead_id).maybeSingle();
  if (!lead) return json(req, { error: 'Lead not found' }, 404);
  if (kind === 'rating' && lead.status !== 'completed') return json(req, { error: 'Ask for a rating after the job is completed' }, 400);

  const { data: me } = await userClient.rpc('crm_me');
  const first = String(lead.name).split(' ')[0];
  const agent = String(me?.name ?? 'the team').split(' ')[0];
  const campaign = kind === 'followup' ? env('AISENSY_CAMPAIGN_FOLLOWUP', 'mxp_desk_followup') : env('AISENSY_CAMPAIGN_RATING', 'mxp_desk_rating');
  const params = kind === 'followup' ? [first, agent] : [first, lead.ref];
  const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: campaign, phone: lead.phone, name: lead.name, params, source: 'mechanix-desk' });
  if (!r.ok) return json(req, { error: r.error }, 400);
  const text = kind === 'followup' ? 'Follow-up message sent on WhatsApp' : 'Rating request sent on WhatsApp';
  await db.from('messages').insert({ lead_id: lead.id, phone: lead.phone, direction: 'out', sender: 'staff', body: text });
  await db.from('crm_activities').insert({ lead_id: lead.id, actor: user.id, kind: 'whatsapp', body: text });
  await db.from('leads').update({ crm_first_contact_at: new Date().toISOString() }).eq('id', lead.id).is('crm_first_contact_at', null);
  return json(req, { ok: true });
});
