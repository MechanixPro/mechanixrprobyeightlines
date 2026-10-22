// POST /functions/v1/desk-chat-sync  { lead_id } — refreshes when the customer last wrote on the desk's WhatsApp number (from AiSensy's contact record), so the lead sheet knows whether the 24-hour reply window is open.
// Works without webhooks. The database decides who may see the lead (crm_chat).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { fetchContact, patchContact, createContact, leadAttributes } from '../_shared/aisensy-contact.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const { error: ce } = await userClient.rpc('crm_chat', { p_lead: String(b.lead_id ?? '') });
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : 400);

  const db = adminDb();
  const { data: lead } = await db.from('leads').select('id,name,phone,last_customer_msg_at,consent_whatsapp,pincode,preferred_slot,bike_id,service_id').eq('id', String(b.lead_id)).maybeSingle();
  if (!lead) return json(req, { error: 'Lead not found' }, 404);
  const chat_url = env('AISENSY_PROJECT_ID') ? `https://www.app.aisensy.com/projects/${env('AISENSY_PROJECT_ID')}/live` : null;
  const r = await fetchContact({ projectId: env('AISENSY_PROJECT_ID'), password: env('AISENSY_PROJECT_KEY'), phone: lead.phone });
  if (!r.ok) return json(req, { ok: false, error: r.error, chat_url });
  const s = r.state!;
  if (s.lastActive && (!lead.last_customer_msg_at || Date.parse(lead.last_customer_msg_at) < s.lastActive)) {
    await db.from('leads').update({ last_customer_msg_at: new Date(s.lastActive).toISOString(), consent_whatsapp: true }).eq('id', lead.id);
  }
  // Put the lead's details on the AiSensy contact so whoever opens Live Chat sees the bike, service and area. Best effort: never blocks the sheet.
  try {
    const [{ data: bike }, { data: svc }] = await Promise.all([
      lead.bike_id ? db.from('bikes').select('brand,model').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
      lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null })]);
    const attrs = leadAttributes({ bike: [bike?.brand, bike?.model].filter(Boolean).join(' '), service: svc?.name, pincode: lead.pincode, slot: lead.preferred_slot });
    const cfg = { projectId: env('AISENSY_PROJECT_ID'), password: env('AISENSY_PROJECT_KEY') };
    if (s.found && s.id) await patchContact({ ...cfg, contactId: s.id, attributes: attrs });
    else if (!s.found && lead.consent_whatsapp) await createContact({ ...cfg, phone: lead.phone, name: lead.name });
  } catch (e) { console.error('contact context', e); }
  return json(req, { ok: true, found: s.found, last_active: s.lastActive ? new Date(s.lastActive).toISOString() : null, window_open: s.windowOpen, intervened: s.intervened, chat_url });
});
