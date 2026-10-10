// Scheduled once a day (pg_cron). Emails a "your next service is due" reminder to customers who ticked
// "Remind me when my next service is due" and have an email address. One reminder per booking, never to anyone who unsubscribed.
import { adminDb, env, safeEqual } from '../_shared/util.ts';
import { sendEmail } from '../_shared/resend.ts';
import { serviceDue } from '../_shared/email-templates.ts';
import { isReminderDue, DUE_DAYS } from '../_shared/service-due.ts';
import { unsubLinks } from '../_shared/unsub.ts';

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET', '__unset__'))) return new Response('Forbidden', { status: 403 });
  const db = adminDb(), now = new Date();
  const siteUrl = env('SITE_URL', 'https://mechanixpro.in'), fnUrl = env('SUPABASE_URL') + '/functions/v1', secret = env('SUPABASE_SERVICE_ROLE_KEY');
  const site = { siteUrl, phoneDisplay: env('PHONE_DISPLAY', '+91 83106 21498'), phoneTel: env('PHONE_TEL', '+918310621498'), whatsappUrl: env('WHATSAPP_URL', 'https://wa.me/918310621498'), email: 'hello@mechanixpro.in' };
  const cutoff = new Date(now.getTime() - DUE_DAYS * 86400_000).toISOString();
  const { data: leads } = await db.from('leads').select('id,name,status,reminder_opt_in,reminder_sent_at,completed_at,customer_id,bike_id,service_id')
    .eq('status', 'completed').eq('reminder_opt_in', true).is('reminder_sent_at', null).lte('completed_at', cutoff).limit(40);
  let sent = 0, skipped = 0;
  for (const l of leads ?? []) {
    const { data: c } = await db.from('customers').select('id,email,email_unsubscribed_at,blocked').eq('id', l.customer_id).maybeSingle();
    if (!isReminderDue(l, c, now)) { skipped++; if (c && (!c.email || c.blocked || c.email_unsubscribed_at)) await db.from('leads').update({ reminder_sent_at: now.toISOString() }).eq('id', l.id); continue; }
    const [{ data: b }, { data: s }] = await Promise.all([
      l.bike_id ? db.from('bikes').select('brand,model,nickname').eq('id', l.bike_id).maybeSingle() : Promise.resolve({ data: null }),
      l.service_id ? db.from('services').select('name').eq('id', l.service_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const base = b ? [b.brand && b.brand !== 'Other' ? b.brand : '', b.model].filter(Boolean).join(' ') : '';
    const bike = b?.nickname ? `"${b.nickname}"${base ? ` (${base})` : ''}` : base || 'your bike';
    const q = new URLSearchParams({ ...(b?.brand && b.brand !== 'Other' ? { brand: b.brand } : {}), ...(b?.model ? { model: b.model } : {}), ...(b?.nickname ? { nick: b.nickname } : {}), ...(l.service_id ? { service: l.service_id } : {}) }).toString();
    const links = await unsubLinks(c!.id, secret, siteUrl, fnUrl);
    const m = serviceDue({ ...site, name: l.name, bike, lastService: s?.name ?? null, buildUrl: `${siteUrl}/book/${q ? '?' + q : ''}`, unsubscribeUrl: links.page });
    const r = await sendEmail({ to: c!.email!, subject: m.subject, html: m.html, text: m.text, unsubscribeUrl: links.oneClick, tags: { template: 'service_due' } });
    await db.from('email_log').insert({ lead_id: l.id, to_email: c!.email, template: 'service_due', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', provider_id: r.id ?? null, error: r.error ?? null });
    if (r.ok) { sent++; await db.from('leads').update({ reminder_sent_at: now.toISOString() }).eq('id', l.id); }
  }
  return new Response(JSON.stringify({ checked: leads?.length ?? 0, sent, skipped }), { headers: { 'Content-Type': 'application/json' } });
});
