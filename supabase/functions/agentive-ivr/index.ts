// POST /functions/v1/agentive-ivr — Agentive call menu "Key press webhook" for the IVR number +91 79652 95649.
// Verifies X-Agentive-Signature-V2 with AGENTIVE_WEBHOOK_SECRET (the signing secret shown on the Agentive call menu page), saves who pressed what
// on a lead the desk can see (source: phone), and sends the matching WhatsApp follow-up from the AiSensy number when its campaign exists.
// Answers 2xx quickly. A bad signature is 401, which Agentive does not retry.
import { adminDb, env, hmacSha256Hex, safeEqual } from '../_shared/util.ts';
import { verifyAgentive, cleanKeypress, MENU } from '../_shared/agentive.ts';
import { sendCampaign } from '../_shared/aisensy-send.ts';

const reply = (b: unknown = { ok: true }, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  const good = await verifyAgentive(raw, req.headers.get('x-agentive-signature-v2'), env('AGENTIVE_WEBHOOK_SECRET'), hmacSha256Hex, safeEqual);
  if (!good) return reply({ error: 'Bad signature' }, 401);
  let body: any; try { body = JSON.parse(raw); } catch { return reply({ error: 'Bad JSON' }, 400); }
  const v = cleanKeypress(body); if (!v.ok) return reply({ ok: true, ignored: v.error });
  const k = v.value;
  if (k.test) return reply({ ok: true, test: true });
  try {
    const db = adminDb();
    // Agentive can deliver an event twice: the event id is stored with the call and checked first.
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'ivr_keypress').eq('details->>evt', k.id);
    if ((count ?? 0) > 0) return reply({ ok: true, duplicate: true });
    await db.from('audit_log').insert({ action: 'ivr_keypress', details: { evt: k.id, call: k.callUuid, key: k.keyPath, phone_last4: k.phone.slice(-4) } });

    const item = MENU[k.keyPath];
    const line = `Called the IVR and pressed ${k.keyPath}${item ? ': ' + item.label : k.keyLabel ? ': ' + k.keyLabel : ''}.`;
    if (!k.phone || !item || !item.lead) return reply({ ok: true, noted: !!k.phone });

    let lead: any = (await db.from('leads').select('id,ref,notes,status,name').eq('phone', k.phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    if (!lead || !OPEN.includes(lead.status)) {
      const { data: cust } = await db.from('customers').upsert({ phone: k.phone }, { onConflict: 'phone', ignoreDuplicates: true }).select('id,blocked').maybeSingle();
      if (cust?.blocked) return reply({ ok: true });
      const id = cust?.id ?? (await db.from('customers').select('id').eq('phone', k.phone).maybeSingle()).data?.id ?? null;
      lead = (await db.from('leads').insert({ customer_id: id, name: 'Caller ' + k.phone.slice(-4), phone: k.phone, source: 'phone', page: 'ivr', notes: line }).select('id,ref,notes,status,name').single()).data;
    } else {
      await db.from('leads').update({ notes: [lead.notes, line].filter(Boolean).join('\n').slice(0, 1500) }).eq('id', lead.id);
    }
    if (item.campaign) {
      const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: item.campaign, phone: k.phone, name: lead?.name ?? 'Customer', params: [], source: 'mechanix-ivr' });
      if (!r.ok) console.error('agentive-ivr follow-up', item.campaign, r.error);
    }
    return reply({ ok: true, lead: lead?.ref ?? null });
  } catch (e) {
    console.error('agentive-ivr', e);
    return reply({ ok: false }, 500);
  }
});
