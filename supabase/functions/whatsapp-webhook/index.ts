// WhatsApp Cloud API webhook (number +91 83106 21498): verifies Meta's signature on the raw body, stores every inbound message type (text, photo, voice note,
// document, location, button and list replies; media id and mime only, never bytes) and every delivery status, feeds the Crew inbox, and lets the AI assistant
// reply and push the customer to pay the booking advance unless a person claimed the conversation or the AI switch is off. Deploy with --no-verify-jwt.
import { adminDb, env, getSetting, priceBooking, rupee } from '../_shared/util.ts';
import { parseWebhook, verifyMetaSignature, type ParsedMessage } from '../_shared/wa-cloud.ts';
import { sendText, whatsappReady } from '../_shared/whatsapp.ts';
import { aiReady, aiReply, systemPrompt } from '../_shared/ai.ts';
import { slotFee } from '../_shared/checkout.ts';
import { isReturningCustomer } from '../_shared/customer.ts';
import { createPaymentLink, paymentsReady } from '../_shared/gateway.ts';
import { REF_IN_TEXT, refFilter } from '../_shared/booking-id.ts';
import { detectVehicle, upgradeVehicle, vehicleCols } from '../_shared/vehicle.ts';

const STOP_WORDS = /^\s*(stop|unsubscribe|cancel messages|band karo)\s*$/i;
const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta verification handshake
  if (req.method === 'GET') {
    const token = env('WA_VERIFY_TOKEN');
    if (token && url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === token)
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    return new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const raw = await req.text();
  if (!(await verifyMetaSignature(env('WA_APP_SECRET'), raw, req.headers.get('x-hub-signature-256')))) return new Response('Bad signature', { status: 401 });

  let body: any; try { body = JSON.parse(raw); } catch { return new Response('ok'); }
  const db = adminDb();
  const { messages, statuses } = parseWebhook(body);
  for (const m of messages) { try { await handleMessage(db, m); } catch (e) { console.error('handle error', e); } }
  // Delivery receipts: the database only moves a status forward (sent, delivered, read; failed only before delivery).
  for (const s of statuses) { try { await db.rpc('wa_apply_status', { p_wa_id: s.id, p_status: s.status, p_error: s.error }); } catch (e) { console.error('status error', e); } }
  return new Response('ok');
});

async function handleMessage(db: ReturnType<typeof adminDb>, m: ParsedMessage) {
  const phone = m.phone;
  if (!phone) return;
  const text = m.body, profileName = m.profileName;
  const typed = m.type === 'text' || m.type === 'button' || m.type === 'interactive';   // AI and opt-out read only what the customer typed or tapped

  // Find the lead: by booking ref in the text, else latest open lead for this phone, else create one.
  const ref = text.toUpperCase().match(REF_IN_TEXT)?.[0];
  let lead: any = null;
  if (ref) lead = (await db.from('leads').select('*').or(refFilter(ref)).eq('phone', phone).is('deleted_at', null).maybeSingle()).data;
  if (!lead) lead = (await db.from('leads').select('*').eq('phone', phone).is('deleted_at', null).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  if (!lead || ['completed', 'lost', 'junk'].includes(lead.status)) {
    const { data: cust } = await db.from('customers').upsert({ phone, name: profileName || null }, { onConflict: 'phone' }).select('id').single();
    lead = (await db.from('leads').insert({ customer_id: cust?.id, name: (profileName || 'WhatsApp customer').slice(0, 60), phone, source: 'whatsapp', consent_whatsapp: true, ...vehicleCols(detectVehicle(text)) }).select('*').single()).data;
  }
  if (!lead) return;

  // Log inbound and update the conversation in one database call (de-dupes on Meta's message id).
  const { data: rec, error: recErr } = await db.rpc('wa_record_inbound', { p_phone: phone, p_lead: lead.id, p_wa_id: m.id, p_body: text, p_media: m.media, p_wa_number: m.waNumber || null, p_profile: profileName, p_at: m.at });
  if (recErr) { console.error('record inbound', recErr.message); return; }   // Meta retries a non-200, but we always answer 200: the error is in the logs
  if (rec?.duplicate) return; // already processed

  const patch: Record<string, unknown> = { last_customer_msg_at: new Date().toISOString(), consent_whatsapp: true };
  if (lead.status === 'new') patch.status = 'contacted';
  // Customer is engaged: reset the nudge timer (next nudge in 3 hours if they go quiet).
  if (OPEN.includes(lead.status)) { patch.followup_step = 1; patch.next_followup_at = new Date(Date.now() + 3 * 3600_000).toISOString(); }

  if (typed && STOP_WORDS.test(text)) {
    await db.from('leads').update({ ...patch, opted_out: true, ai_enabled: false, next_followup_at: null }).eq('id', lead.id);
    const id = await sendText(phone, 'You will not get any more automated messages from Mechanix Pro. Reply anytime if you need us.');
    if (id) await db.rpc('wa_record_outbound', { p_phone: phone, p_lead: lead.id, p_wa_id: id, p_body: 'Opt-out confirmed', p_sender: 'system', p_media: null, p_status: 'sent', p_user: null, p_wa_number: m.waNumber || null });
    return;
  }
  await db.from('leads').update(patch).eq('id', lead.id);
  await upgradeVehicle(db, lead.id, detectVehicle(text));   // bike to car/parts once; never over a desk-set tag

  // Who may auto-reply: never after a person claimed the conversation; the conversation switch wins over the global one (wa_ai_auto, default on).
  if (rec?.assigned_to) return;
  if (rec?.ai_auto === false || (rec?.ai_auto == null && rec?.global_ai === false)) return;
  if (!typed && m.type !== 'location') return;   // a photo or voice note is for the team, not the AI

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
  const view = { booking_id: lead.booking_id ?? null, name: lead.name, area: lead.area, service_id: lead.service_id, addons: lead.addons, estimate: lead.est_total, preferred_date: lead.preferred_date, preferred_slot: lead.preferred_slot, status: lead.status, payment_link_sent: !!lead.payment_link };
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
  if (ai.action === 'send_payment_link' && paymentsReady() && !['paid', 'scheduled', 'completed'].includes(lead.status)) {
    const merged = { ...lead, ...upd };
    if (merged.service_id && merged.preferred_slot) {
      try {
        const amount = Number(advance);
        const link = lead.payment_link && lead.amount_due === amount ? { id: lead.payment_link_id, url: lead.payment_link }
          : await createPaymentLink({ amount, ref: lead.ref, leadId: lead.id, name: merged.name, phone, description: `Mechanix Pro ${lead.booking_id ? 'booking ' + lead.booking_id + ' — ' : ''}slot fee (adjusted in final bill)` });
        Object.assign(upd, { payment_link: link.url, payment_link_id: link.id, amount_due: amount, status: 'payment_sent', followup_step: 2, next_followup_at: new Date(Date.now() + 2 * 3600_000).toISOString() });
        reply += `\n\nPay ${rupee(amount)} to lock your slot: ${link.url}`;
      } catch (e) { console.error('payment link', e); reply += '\n\nOur team will send your payment link in a moment.'; }
    }
  }
  if (Object.keys(upd).length) await db.from('leads').update(upd).eq('id', lead.id);
  const id = await sendText(phone, reply);
  if (id) await db.rpc('wa_record_outbound', { p_phone: phone, p_lead: lead.id, p_wa_id: id, p_body: reply, p_sender: 'ai', p_media: null, p_status: 'sent', p_user: null, p_wa_number: m.waNumber || null });
}
