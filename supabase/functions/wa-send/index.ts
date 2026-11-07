// POST /functions/v1/wa-send — a Crew or Admin user replies to a customer from the Cloud number (+91 83106 21498).
//   { action: 'templates' }                                        -> the template list and language codes
//   { phone, text }                                                -> free-form text (only inside the 24 hour window, else 409)
//   { phone, media: { type, base64, mime, filename?, caption? } }  -> voice note, photo or document (only inside the 24 hour window, else 409)
//   { phone, template: { name, lang: 'en'|'hi'|'kn', vars: [] } }  -> an approved template (any time)
// Deploy with verify_jwt false: this function checks the desk user's Supabase JWT itself, and the database decides who may reply (crm_wa_send_context).
// A send is never retried: when Meta's answer is lost the row is saved as 'unknown' and the desk is told to check before sending again.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { cloudReady, sendMessage, uploadMedia } from '../_shared/wa-graph.ts';
import { checkMedia, cloudTemplates, decideSend, mediaPayload, normalizeLang, templateBody, templatePayload, textPayload, LANGS } from '../_shared/wa-cloud.ts';

const decode = (b64: string): Uint8Array | null => { try { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return null; } };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const b = await req.json().catch(() => ({}));
  const templates = cloudTemplates((k, d) => env(k, d));
  if (b.action === 'templates') return json(req, { templates, langs: [{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }, { code: 'kn', label: 'Kannada' }], ready: cloudReady() });

  // The database checks the role, the inbox page, the claim, the opt-out and the 24 hour window (as the signed-in person).
  const { data: ctx, error: ce } = await userClient.rpc('crm_wa_send_context', { p_phone: String(b.phone ?? '') });
  if (ce) return json(req, { error: ce.message }, ce.code === '42501' ? 403 : ce.code === 'P0002' ? 404 : 400);
  const d = decideSend(b, { windowOpen: !!ctx.window_open, optedOut: !!ctx.opted_out });
  if (!d.ok) return json(req, { error: d.error, code: d.code ?? null, window_open: !!ctx.window_open }, d.status);
  if (!cloudReady()) return json(req, { error: 'The WhatsApp Cloud number is not connected yet (WA_TOKEN and WA_PHONE_NUMBER_ID are missing)' }, 503);

  const phone: string = ctx.phone; let payload: Record<string, unknown>; let body = ''; let media: Record<string, unknown> | null = null;
  if (d.kind === 'text') { body = String(b.text).trim().slice(0, 4000); payload = textPayload(phone, body); }
  else if (d.kind === 'template') {
    const t = templates.find((x) => x.name === String(b.template.name));
    if (!t) return json(req, { error: 'That template is not on the list' }, 400);
    const vars = (Array.isArray(b.template.vars) ? b.template.vars : []).map((v: unknown) => String(v ?? '').trim());
    if (vars.length !== t.vars.length || vars.some((v: string) => !v)) return json(req, { error: `Fill every box: ${t.vars.join(', ')}` }, 400);
    const lang = normalizeLang(b.template.lang)!;
    payload = templatePayload(phone, t.name, lang, vars); body = templateBody(t.name, vars); media = { type: 'template', name: t.name, lang };
  } else {
    const m = checkMedia(b.media);
    if (!m.ok) return json(req, { error: m.error }, 400);
    const bytes = decode(String(b.media.base64));
    if (!bytes) return json(req, { error: 'That file could not be read' }, 400);
    const up = await uploadMedia(bytes, m.mime, String(b.media.filename ?? 'file').slice(0, 120));
    if (!up.ok) return json(req, { error: up.error }, 502);   // nothing was sent to the customer
    const caption = String(b.media.caption ?? '').trim().slice(0, 1000), filename = b.media.filename ? String(b.media.filename).slice(0, 120) : undefined;
    payload = mediaPayload(phone, m.type, up.id, { caption, filename });
    body = caption || (m.type === 'audio' ? '[Voice note]' : m.type === 'image' ? '[Photo]' : `[Document${filename ? ': ' + filename : ''}]`);
    media = { type: m.type, id: up.id, mime: m.mime, filename, caption: caption || undefined };
  }

  const r = await sendMessage(payload);   // one attempt, no retry
  const db = adminDb();
  const rec = (waId: string | null, status: string) => db.rpc('wa_record_outbound', { p_phone: phone, p_lead: ctx.lead_id, p_wa_id: waId, p_body: body, p_sender: 'staff', p_media: media, p_status: status, p_user: user.id, p_wa_number: '918310621498' });
  if (!r.ok && !r.unknown) return json(req, { error: r.error }, 400);   // Meta refused it: nothing was sent
  if (!r.ok) {
    await rec(null, 'unknown');
    return json(req, { ok: false, unknown: true, error: `${r.error}. The message may or may not have been delivered. Check the customer's chat before sending it again.` }, 202);
  }
  const { error: re } = await rec(r.id, 'sent');
  if (re) console.error('wa-send record failed after a successful send', re.message);
  if (ctx.lead_id) {
    await db.from('crm_activities').insert({ lead_id: ctx.lead_id, actor: user.id, kind: 'whatsapp', body: d.kind === 'template' ? 'Sent a WhatsApp template' : 'Replied on WhatsApp' });
    await db.from('leads').update({ crm_first_contact_at: new Date().toISOString() }).eq('id', ctx.lead_id).is('crm_first_contact_at', null);
  }
  return json(req, { ok: true, id: r.id, saved: !re });
});
