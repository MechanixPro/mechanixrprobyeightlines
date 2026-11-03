// POST /functions/v1/booking-notice  { lead_id, kind: 'picked_up' }  — called from the admin panel by a signed-in admin.
// Emails the customer that their vehicle has been picked up for service, and records it on the booking.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { adminDb, env, json, corsHeaders } from '../_shared/util.ts';
import { sendEmail, FROM_BOOKING } from '../_shared/resend.ts';
import { vehiclePickedUp } from '../_shared/email-templates.ts';

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
  if (b.kind !== 'picked_up') return json(req, { error: 'Unknown notice' }, 400);
  const { data: lead } = await db.from('leads').select('*').eq('id', String(b.lead_id ?? '')).maybeSingle();
  if (!lead) return json(req, { error: 'Booking not found' }, 404);
  if (lead.status === 'lost') return json(req, { error: 'This booking is closed as lost' }, 400);

  const [{ data: cust }, { data: bike }, { data: mech }, { data: svc }] = await Promise.all([
    lead.customer_id ? db.from('customers').select('email,email_unsubscribed_at').eq('id', lead.customer_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.bike_id ? db.from('bikes').select('brand,model,reg_no').eq('id', lead.bike_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.mechanic_id ? db.from('mechanics').select('name,certified').eq('id', lead.mechanic_id).maybeSingle() : Promise.resolve({ data: null }),
    lead.service_id ? db.from('services').select('name').eq('id', lead.service_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const bikeName = bike ? [bike.brand && bike.brand !== 'Other' ? bike.brand : '', bike.model].filter(Boolean).join(' ') || 'vehicle' : 'vehicle';
  await db.from('crm_activities').insert({ lead_id: lead.id, actor: user.id, kind: 'note', body: 'Vehicle picked up for service.' });
  await db.from('audit_log').insert({ actor: user.id, action: 'vehicle_picked_up', details: { lead: lead.ref } });

  let emailed = false;
  if (cust?.email) {
    const mail = vehiclePickedUp({
      siteUrl: env('SITE_URL', 'https://mechanixpro.in'), phoneDisplay: env('PHONE_DISPLAY', '+91 79652 95649'), phoneTel: env('PHONE_TEL', '+917965295649'),
      whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918042303061'), email: 'hello@mechanixpro.in',
      name: lead.name, ref: lead.ref, bike: bikeName, reg: bike?.reg_no ?? lead.reg_no ?? null, service: svc?.name ?? 'Service',
      mechanicName: mech ? mech.name + (mech.certified === false ? '' : ' (Mechanix Pro certified)') : null,
    });
    const r = await sendEmail({ to: cust.email, subject: mail.subject, html: mail.html, text: mail.text, from: FROM_BOOKING, tags: { template: 'vehicle_picked_up' } });
    await db.from('email_log').insert({ lead_id: lead.id, to_email: cust.email, template: 'vehicle_picked_up', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    emailed = r.ok;
  }
  return json(req, { ok: true, emailed, has_email: !!cust?.email });
});
