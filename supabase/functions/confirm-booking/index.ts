// POST /functions/v1/confirm-booking  { lead_id }  — called from the admin panel by a signed-in admin, or from the desk (Crew) by an active desk user.
// Admin: moves the booking to "scheduled" and emails the customer a confirmation with their Mechanix Pro certified mechanic.
// Desk: the booking is already "scheduled" (crm_confirm_booking set it), so this only sends the email, at most once a day per booking.
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
  const { data: desk } = admin ? { data: null } : await db.from('crm_users').select('user_id').eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!admin && !desk) return json(req, { error: 'Not allowed' }, 403);

  const b = await req.json().catch(() => ({}));
  const { data: lead } = await db.from('leads').select('*').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead || lead.deleted_at) return json(req, { error: 'Booking not found' }, 404);
  if (['completed', 'lost'].includes(lead.status)) return json(req, { error: 'This booking is already closed' }, 400);
  // What this confirmation says: a new email goes out only when the date, slot or technician changed.
  const key = [lead.preferred_date, lead.preferred_slot, lead.mechanic_id].join('|');
  if (!admin) {
    // The same rule as moving the lead in the desk: edit_leads, and the lead is theirs or they see all leads.
    const [{ data: canEdit }, { data: seeAll }] = await Promise.all([userClient.rpc('crm_can', { p_action: 'edit_leads' }), userClient.rpc('crm_can', { p_action: 'view_all_leads' })]);
    if (!canEdit || !(seeAll || lead.crm_owner === user.id)) return json(req, { error: 'Not allowed' }, 403);
    if (lead.status !== 'scheduled') return json(req, { error: 'Confirm the booking in the desk first' }, 400);
    const { count } = await db.from('audit_log').select('id', { count: 'exact', head: true }).eq('action', 'booking_confirmed').eq('details->>lead', lead.ref).eq('details->>key', key).gt('created_at', new Date(Date.now() - 24 * 3600_000).toISOString());
    if ((count ?? 0) > 0) return json(req, { ok: true, emailed: false, already: true });
  }

  const [{ data: cust }, { data: bike }, { data: mech }, { data: svc }] = await Promise.all([
    lead.customer_id ? db.from('customers').select('email,email_unsubscribed_at').eq('id', lead.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model,nickname').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name,certified').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  if (admin) await db.from('leads').update({ status: 'scheduled', confirmed_at: new Date().toISOString() }).eq('id', lead.id);
  else if (!lead.confirmed_at) await db.from('leads').update({ confirmed_at: new Date().toISOString() }).eq('id', lead.id);
  await db.from('audit_log').insert({ actor: user.id, action: 'booking_confirmed', details: { lead: lead.ref, from: admin ? 'admin' : 'desk', key } });

  let emailed = false;
  if (cust?.email) {
    const mail = bookingConfirmed({
      siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 79652 95649'), phoneTel: env('PHONE_TEL', '+917965295649'),
      whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918042303061'), email: 'hello@mechanixpro.in',
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
