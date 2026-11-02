// POST /functions/v1/agentive-ivr — Agentive call menu "Key press webhook" for the IVR number +91 79652 95649.
// Verifies X-Agentive-Signature-V2 with AGENTIVE_WEBHOOK_SECRET (the signing secret shown on the Agentive call menu page), saves who pressed what
// on a lead the desk can see (source: phone), and sends the matching WhatsApp follow-up from the AiSensy number when its campaign exists.
// Answers 2xx quickly. A bad signature is 401, which Agentive does not retry.
import { adminDb, env, hmacSha256Hex, safeEqual } from '../_shared/util.ts';
import { verifyAgentive, cleanKeypress, cleanCall, MENU } from '../_shared/agentive.ts';
import { sendCampaign } from '../_shared/aisensy-send.ts';
import { alertNewLead } from '../_shared/new-lead-alert.ts';

const reply = (b: unknown = { ok: true }, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const raw = await req.text();
  // The call menu key press webhook and the Webhooks tab (call events) each have their own signing secret; either one is accepted.
  const sig = req.headers.get('x-agentive-signature-v2'); let good = false;
  for (const name of ['AGENTIVE_WEBHOOK_SECRET', 'AGENTIVE_EVENTS_SECRET']) { let sec = ''; try { sec = env(name); } catch { sec = ''; } if (sec && !good) good = await verifyAgentive(raw, sig, sec, hmacSha256Hex, safeEqual); }
  if (!good) {
    // Note a rejected call so it can be traced (header facts only, no body, at most one note a minute so strangers cannot fill the log).
    try {
      const db = adminDb(); const since = new Date(Date.now() - 60_000).toISOString();
      const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'ivr_rejected').gt('created_at', since);
      if ((count ?? 0) === 0) { const m = /^t=(\d+)/.exec(String(sig ?? '')); await db.from('audit_log').insert({ action: 'ivr_rejected', details: { has_sig: !!sig, sig_ok_shape: !!sig && /^t=\d{9,12},v2=[a-f0-9]{64}$/i.test(sig), age_sec: m ? Math.round(Date.now() / 1000 - Number(m[1])) : null, event: String(req.headers.get('x-agentive-event') ?? '').slice(0, 40), secrets_set: ['AGENTIVE_WEBHOOK_SECRET', 'AGENTIVE_EVENTS_SECRET'].filter((n) => !!env(n)) } }); }
    } catch { /* never break the reply */ }
    return reply({ error: 'Bad signature' }, 401);
  }
  let body: any; try { body = JSON.parse(raw); } catch { return reply({ error: 'Bad JSON' }, 400); }
  const call = cleanCall(body);
  if (call.ok) return handleCall(call.value, body);
  const v = cleanKeypress(body);
  if (!v.ok) {
    // Say why an event was skipped, so a call that made no lead can be traced. Event name, reason and field names only: never a phone number.
    try { await adminDb().from('audit_log').insert({ action: 'ivr_ignored', details: { event: String(body?.event ?? body?.type ?? '').slice(0, 40), why: call.error, test: body?.test === true, keys: Object.keys(body?.data ?? {}).slice(0, 30), direction: String(body?.data?.direction ?? '').slice(0, 12), id_shape: /^[a-z0-9_.-]{8,80}$/i.test(String(body?.id ?? body?.event_id ?? '')) } }); } catch { /* logging must never break the reply */ }
    return reply({ ok: true, ignored: call.error });
  }
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
    if (!k.phone || (item && !item.lead)) return reply({ ok: true, noted: !!k.phone });

    let lead: any = (await db.from('leads').select('id,ref,notes,status,name').eq('phone', k.phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    if (!lead || !OPEN.includes(lead.status)) {
      const { data: cust } = await db.from('customers').upsert({ phone: k.phone }, { onConflict: 'phone', ignoreDuplicates: true }).select('id,blocked').maybeSingle();
      if (cust?.blocked) return reply({ ok: true });
      const id = cust?.id ?? (await db.from('customers').select('id').eq('phone', k.phone).maybeSingle()).data?.id ?? null;
      lead = (await db.from('leads').insert({ customer_id: id, name: k.phone, phone: k.phone, source: 'phone', page: 'ivr', notes: line }).select('id,ref,notes,status,name').single()).data;
      if (lead) await alertNewLead(db, { ref: lead.ref, name: lead.name, phone: k.phone, source: 'phone', note: line });
    } else {
      await db.from('leads').update({ notes: [lead.notes, line].filter(Boolean).join('\n').slice(0, 1500) }).eq('id', lead.id);
    }
    if (item?.campaign) {
      const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: item.campaign, phone: k.phone, name: lead?.name ?? 'Customer', params: [], source: 'mechanix-ivr' });
      if (!r.ok) console.error('agentive-ivr follow-up', item.campaign, r.error);
    }
    return reply({ ok: true, lead: lead?.ref ?? null });
  } catch (e) {
    console.error('agentive-ivr', e);
    return reply({ ok: false }, 500);
  }
});

// Every inbound call becomes a lead, so a caller who never presses a key is not lost. A missed call also gets the "sorry we missed you" WhatsApp.
async function handleCall(c: { id: string; event: string; callId: string; phone: string; missed: boolean; seconds: number }, body: any) {
  if (body.test === true) return reply({ ok: true, test: true });
  try {
    const db = adminDb();
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'ivr_call').eq('details->>evt', c.id);
    if ((count ?? 0) > 0) return reply({ ok: true, duplicate: true });
    await db.from('audit_log').insert({ action: 'ivr_call', details: { evt: c.id, call: c.callId, event: c.event, phone_last4: c.phone.slice(-4) } });
    const line = c.missed ? 'Missed call to the IVR number.' : c.event === 'call.completed' ? `Called the IVR number (${c.seconds}s).` : 'Called the IVR number.';
    let lead: any = (await db.from('leads').select('id,ref,notes,status,name').eq('phone', c.phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
    if (!lead || !OPEN.includes(lead.status)) {
      const { data: cust } = await db.from('customers').upsert({ phone: c.phone }, { onConflict: 'phone', ignoreDuplicates: true }).select('id,blocked').maybeSingle();
      if (cust?.blocked) return reply({ ok: true });
      const id = cust?.id ?? (await db.from('customers').select('id').eq('phone', c.phone).maybeSingle()).data?.id ?? null;
      lead = (await db.from('leads').insert({ customer_id: id, name: c.phone, phone: c.phone, source: 'phone', page: 'ivr', notes: line }).select('id,ref,notes,status,name').single()).data;
      if (lead) await alertNewLead(db, { ref: lead.ref, name: lead.name, phone: c.phone, source: 'phone', note: line });
    } else if (!String(lead.notes ?? '').includes(line)) {
      await db.from('leads').update({ notes: [lead.notes, line].filter(Boolean).join('\n').slice(0, 1500) }).eq('id', lead.id);
    }
    if (c.missed) {
      const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: 'mxp_ivr_missed', phone: c.phone, name: lead?.name ?? 'Customer', params: [], source: 'mechanix-ivr' });
      if (!r.ok) console.error('agentive-ivr missed follow-up', r.error);
    }
    return reply({ ok: true, lead: lead?.ref ?? null });
  } catch (e) {
    console.error('agentive-ivr call', e);
    return reply({ ok: false }, 500);
  }
}
