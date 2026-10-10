// POST /functions/v1/confirm-booking  { lead_id }  — called from the admin panel by a signed-in admin.
// Moves the booking to "scheduled" and emails the customer a confirmation with their Mechanix Pro certified mechanic.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendEmail, FROM_BOOKING } from '../_shared/resend.ts';
import { bookingConfirmed } from '../_shared/email-templates.ts';
import { formatWhen } from '../_shared/when.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const userClient = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json(req, { error: 'Sign in again' }, 401);
  const db = adminDb();
  const { data: admin } = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!admin) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const { data: lead } = await db.from('leads').select('*').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);
  if (['completed', 'lost'].includes(lead.status)) return json(req, { error: 'This booking is already closed' }, 400);

  const [{ data: cust }, { data: bike }, { data: mech }, { data: svc }] = await Promise.all([
    lead.customer_id ? db.from('customers').select('email,email_unsubscribed_at').eq('id', lead.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model,nickname').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name,certified').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  await db.from('leads').update({ status: 'scheduled', confirmed_at: new Date().toISOString() }).eq('id', lead.id);
  await db.from('audit_log').insert({ actor: user.id, action: 'booking_confirmed', details: { lead: lead.ref } });

  let emailed = false;
  if (cust?.email) {
    const mail = bookingConfirmed({
      siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 83106 21498'), phoneTel: env('PHONE_TEL', '+918310621498'),
      whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918310621498'), email: 'hello@mechanixpro.in',
      name: lead.name, ref: lead.ref, nick: bike?.nickname ?? null,
      buildUrl: env('SITE_URL', 'https://mechanixpro.in') + '/book/?' + new URLSearchParams({ ...(bike?.brand && bike.brand !== 'Other' ? { brand: bike.brand } : {}), ...(bike?.model ? { model: bike.model } : {}), ...(bike?.nickname ? { nick: bike.nickname } : {}), ...(lead.service_id ? { service: lead.service_id } : {}) }).toString(),
      bike: bike ? [bike.brand && bike.brand !== 'Other' ? bike.brand : '', bike.model].filter(Boolean).join(' ') + (bike.nickname ? ` "${bike.nickname}"` : '') : 'Your bike',
      service: svc?.name ?? 'Bike service', area: lead.area || 'Bengaluru',
      whenText: formatWhen(String(lead.preferred_date), String(lead.preferred_slot), lead.preferred_time ?? null),
      mechanicName: mech ? mech.name + (mech.certified === false ? '' : ' (Mechanix Pro certified)') : null, amountDue: lead.amount_due ?? null,
    });
    const r = await sendEmail({ to: cust.email, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template: 'booking_confirmed' } });
    await db.from('email_log').insert({ lead_id: lead.id, to_email: cust.email, template: 'booking_confirmed', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    emailed = r.ok;
  }
  return json(req, { ok: true, emailed, has_email: !!cust?.email, has_mechanic: !!mech });
});
