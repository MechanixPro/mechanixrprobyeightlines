// Razorpay webhook: marks the booking paid, stops reminders, and confirms on WhatsApp.
// In Razorpay Dashboard → Webhooks, subscribe to "payment_link.paid". Deploy with --no-verify-jwt.
import { adminDb, env, hmacSha256Hex, safeEqual, rupee } from '../_shared/util.ts';
import { sendSmart, TPL } from '../_shared/whatsapp.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();
  const expected = await hmacSha256Hex(env('RAZORPAY_WEBHOOK_SECRET'), raw);
  if (!env('RAZORPAY_WEBHOOK_SECRET') || !safeEqual(req.headers.get('x-razorpay-signature') ?? '', expected)) return new Response('Bad signature', { status: 401 });

  const evt = JSON.parse(raw);
  if (evt.event !== 'payment_link.paid') return new Response('ignored');
  const pl = evt.payload?.payment_link?.entity, pay = evt.payload?.payment?.entity;
  const leadId = pl?.notes?.lead_id;
  if (!leadId) return new Response('no lead');
  const db = adminDb();
  const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle();
  if (!lead || lead.status === 'paid') return new Response('ok');

  const amount = Math.round((pay?.amount ?? pl?.amount_paid ?? 0) / 100);
  await db.from('leads').update({ status: 'paid', paid_amount: (lead.paid_amount ?? 0) + amount, paid_at: new Date().toISOString(), next_followup_at: null }).eq('id', lead.id);
  await db.from('audit_log').insert({ actor: null, action: 'payment_received', details: { lead: lead.ref, amount, payment_id: pay?.id } });
  await sendSmart(db, lead, `Payment of ${rupee(amount)} received for booking ${lead.ref}. Your slot is confirmed — we will share your mechanic's details before the visit. Thank you!`, { name: TPL.paid(), params: [String(amount), lead.ref] }, 'system');
  return new Response('ok');
});
