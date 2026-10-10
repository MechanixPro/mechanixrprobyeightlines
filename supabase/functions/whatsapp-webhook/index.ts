// WhatsApp Cloud API webhook: verifies Meta's signature, logs messages, and lets the AI assistant
// reply and push the customer to pay the booking advance. Deploy with --no-verify-jwt.
import { adminDb, env, hmacSha256Hex, safeEqual, last10, getSetting, priceBooking, rupee } from '../_shared/util.ts';
import { sendText, whatsappReady } from '../_shared/whatsapp.ts';
import { aiReady, aiReply, systemPrompt } from '../_shared/ai.ts';
import { slotFee } from '../_shared/checkout.ts';
import { isReturningCustomer } from '../_shared/customer.ts';
import { createPaymentLink, razorpayReady } from '../_shared/razorpay.ts';

const STOP_WORDS = /^\s*(stop|unsubscribe|cancel messages|band karo)\s*$/i;
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta verification handshake
  if (req.method === 'GET') {
    if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === env('WA_VERIFY_TOKEN'))
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  const sig = (req.headers.get('x-hub-signature-256') ?? '').replace('sha256=', '');
  const expected = await hmacSha256Hex(env('WA_APP_SECRET'), raw);
  if (!env('WA_APP_SECRET') || !safeEqual(sig, expected)) return new Response('Bad signature', { status: 401 });

  let body: any; try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  const db = adminDb();
  for (const entry of body.entry ?? []) for (const change of entry.changes ?? []) {
    const value = change.value ?? {};
    for (const msg of value.messages ?? []) {
      try { await handleMessage(db, msg, value.contacts?.[0]?.profile?.name ?? ''); } catch (e) { console.error('handle error', e); }
    }
  }
  return new Response('ok');
});

async function handleMessage(db: ReturnType<typeof adminDb>, msg: any, profileName: string) {
  const phone = last10(msg.from);
  if (!/^[6-9]\d{9}$/.test(phone)) return;
  const text: string = msg.type === 'text' ? String(msg.text?.body ?? '')
    : msg.type === 'location' ? `My location: https://maps.google.com/?q=${msg.location?.latitude},${msg.location?.longitude}`
    : msg.type === 'button' ? String(msg.button?.text ?? '') : msg.type === 'interactive' ? String(msg.interactive?.button_reply?.title ?? msg.interactive?.list_reply?.title ?? '')
    : `[${msg.type}]`;

  // Find the lead: by booking ref in the text, else latest open lead for this phone, else create one.
  const ref = text.match(/MP-[A-Z0-9]{6}/)?.[0];
  let lead: any = null;
  if (ref) lead = (await db.from('leads').select('*').eq('ref', ref).eq('phone', phone).maybeSingle()).data;
  if (!lead) lead = (await db.from('leads').select('*').eq('phone', phone).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  if (!lead || ['completed', 'lost'].includes(lead.status)) {
    const { data: cust } = await db.from('customers').upsert({ phone, name: profileName || null }, { onConflict: 'phone' }).select('id').single();
    lead = (await db.from('leads').insert({ customer_id: cust?.id, name: (profileName || 'WhatsApp customer').slice(0, 60), phone, source: 'whatsapp', consent_whatsapp: true }).select('*').single()).data;
  }
  if (!lead) return;

  // Log inbound (dedupe on Meta message id)
  const { error: dup } = await db.from('messages').insert({ lead_id: lead.id, phone, direction: 'in', sender: 'customer', body: text.slice(0, 4000), wa_message_id: msg.id });
  if (dup?.code === '23505') return; // already processed

  const patch: Record<string, unknown> = { last_customer_msg_at: new Date().toISOString(), consent_whatsapp: true };
  if (lead.status === 'new') patch.status = 'contacted';
  // Customer is engaged: reset the nudge timer (next nudge in 3 hours if they go quiet).
  if (OPEN.includes(lead.status)) { patch.followup_step = 1; patch.next_followup_at = new Date(Date.now() + 3 * 3600_000).toISOString(); }

  if (STOP_WORDS.test(text)) {
    await db.from('leads').update({ ...patch, opted_out: true, ai_enabled: false, next_followup_at: null }).eq('id', lead.id);
    const id = await sendText(phone, 'You will not get any more automated messages from Mechanix Pro. Reply anytime if you need us.');
    await db.from('messages').insert({ lead_id: lead.id, phone, direction: 'out', sender: 'system', body: 'Opt-out confirmed', wa_message_id: id });
    return;
  }
  await db.from('leads').update(patch).eq('id', lead.id);

  const aiOn = await getSetting(db, 'ai_enabled', true);
  if (!aiOn || !lead.ai_enabled || !aiReady() || !whatsappReady() || ['paid', 'scheduled'].includes(lead.status) && !/\?/.test(text)) return;

  // Cost guard: at most 40 AI replies per lead per day.
  const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('lead_id', lead.id).eq('sender', 'ai').gte('created_at', new Date(Date.now() - 86400_000).toISOString());
  if ((count ?? 0) >= 40) return;

  const [{ data: allRows }, { data: history }, info] = await Promise.all([
    db.from('services').select('id,kind,name,price,description').eq('active', true).order('sort'),
    db.from('messages').select('direction,body').eq('lead_id', lead.id).order('created_at', { ascending: false }).limit(20),
    getSetting(db, 'business_info', {} as Record<string, string>),
  ]);
  const services = (allRows ?? []).filter((r) => r.kind !== 'fee');
  const feeOf = (id: string, d: number) => Number((allRows ?? []).find((r) => r.id === id && r.kind === 'fee')?.price ?? d);
  const returning = await isReturningCustomer(db, { id: lead.id, phone: lead.phone });
  const standardFee = feeOf('advance', 349), advance = slotFee({ returning, advance: standardFee, newFee: feeOf('newfee', 99) }), surcharge = feeOf('bigbike', 300);
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const view = { ref: lead.ref, name: lead.name, area: lead.area, service_id: lead.service_id, addons: lead.addons, estimate: lead.est_total, preferred_date: lead.preferred_date, preferred_slot: lead.preferred_slot, status: lead.status, payment_link_sent: !!lead.payment_link };
  const ai = await aiReply(systemPrompt({ services: services ?? [], lead: view, advance: Number(advance), surcharge: Number(surcharge), info, today }), (history ?? []).reverse());
  if (!ai || !ai.reply) return;

  // Apply booking details the AI extracted.
  const bk = ai.booking ?? {}, upd: Record<string, unknown> = {};
  if (bk.area) upd.area = String(bk.area).slice(0, 40);
  if (bk.preferred_date && /^\d{4}-\d{2}-\d{2}$/.test(bk.preferred_date)) upd.preferred_date = bk.preferred_date;
  if (bk.preferred_slot && ['morning', 'afternoon', 'evening', 'asap'].includes(bk.preferred_slot)) upd.preferred_slot = bk.preferred_slot;
  if (bk.name && lead.source === 'whatsapp') upd.name = String(bk.name).slice(0, 60);
  if (bk.service_id && (services ?? []).some((s: any) => s.id === bk.service_id && s.kind === 'service')) {
    upd.service_id = bk.service_id;
    const p = await priceBooking(db, bk.service_id, lead.addons ?? [], false); if (p) upd.est_total = p.total;
  }
  if (bk.bike_model) upd.notes = [lead.notes, 'Bike: ' + String(bk.bike_model).slice(0, 40)].filter(Boolean).join(' · ');

  let reply = ai.reply;
  if (ai.action === 'handoff') { upd.ai_enabled = false; upd.notes = [upd.notes ?? lead.notes, 'AI handed off to staff'].filter(Boolean).join(' · '); }
  if (ai.action === 'send_payment_link' && razorpayReady() && !['paid', 'scheduled', 'completed'].includes(lead.status)) {
    const merged = { ...lead, ...upd };
    if (merged.service_id && merged.preferred_slot) {
      try {
        const amount = Number(advance);
        const link = lead.payment_link && lead.amount_due === amount ? { id: lead.payment_link_id, url: lead.payment_link }
          : await createPaymentLink({ amount, ref: lead.ref, leadId: lead.id, name: merged.name, phone, description: `Mechanix Pro booking ${lead.ref} — slot fee (adjusted in final bill)` });
        Object.assign(upd, { payment_link: link.url, payment_link_id: link.id, amount_due: amount, status: 'payment_sent', followup_step: 2, next_followup_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
        reply += `\n\nPay ${rupee(amount)} to lock your slot: ${link.url}`;
      } catch (e) { console.error('payment link', e); reply += '\n\nOur team will send your payment link in a moment.'; }
    }
  }
  if (Object.keys(upd).length) await db.from('leads').update(upd).eq('id', lead.id);
  const id = await sendText(phone, reply);
  await db.from('messages').insert({ lead_id: lead.id, phone, direction: 'out', sender: 'ai', body: reply, wa_message_id: id });
}
