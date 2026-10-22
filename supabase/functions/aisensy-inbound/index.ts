// POST /functions/v1/aisensy-inbound — called by an AiSensy chatbot flow step ("API / webhook") for every customer message on the desk number.
// Saves the message on the customer's lead so the Care Buddy sees it in the desk. It never replies by itself. Secured by x-aisensy-secret (AISENSY_WEBHOOK_SECRET).
import { adminDb, env, json, safeEqual } from '../_shared/util.ts';
import { cleanAisensyInbound } from '../_shared/aisensy.ts';

const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];
const STOP_WORDS = /^\s*(stop|unsubscribe|cancel messages|band karo)\s*$/i;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('AISENSY_WEBHOOK_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-aisensy-secret') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const v = cleanAisensyInbound(await req.json().catch(() => ({})));
  if (!v.ok) return json(req, { error: 'Invalid ' + v.error }, 400);
  const x = v.value, db = adminDb();

  // Flows can fire twice for one message: skip an identical message from the same number in the last 20 seconds.
  const since = new Date(Date.now() - 20_000).toISOString();
  const { count: same } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('phone', x.phone).eq('direction', 'in').eq('body', x.text).gte('created_at', since);
  if ((same ?? 0) > 0) return json(req, { ok: true, duplicate: true });

  const { data: cust } = await db.from('customers').upsert({ phone: x.phone, ...(x.name ? { name: x.name } : {}) }, { onConflict: 'phone', ignoreDuplicates: !x.name }).select('id,blocked').maybeSingle();
  if (cust?.blocked) return json(req, { ok: true });
  let lead: any = (await db.from('leads').select('*').eq('phone', x.phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  if (!lead || ['completed', 'lost'].includes(lead.status)) {
    lead = (await db.from('leads').insert({ customer_id: cust?.id ?? null, name: (x.name || 'WhatsApp customer').slice(0, 60), phone: x.phone, source: 'whatsapp', consent_whatsapp: true, page: 'whatsapp-desk' }).select('*').single()).data;
  }
  if (!lead) return json(req, { error: 'Could not save' }, 500);

  const { error: dup } = await db.from('messages').insert({ lead_id: lead.id, phone: x.phone, direction: 'in', sender: 'customer', body: x.text, wa_message_id: x.id });
  if (dup?.code === '23505') return json(req, { ok: true, duplicate: true });
  const patch: Record<string, unknown> = { last_customer_msg_at: new Date().toISOString(), consent_whatsapp: true };
  if (OPEN.includes(lead.status) && lead.status === 'new' && lead.crm_owner) patch.status = 'contacted';
  if (STOP_WORDS.test(x.text)) Object.assign(patch, { opted_out: true, ai_enabled: false, next_followup_at: null });
  await db.from('leads').update(patch).eq('id', lead.id);
  return json(req, { ok: true, lead: lead.ref });
});
