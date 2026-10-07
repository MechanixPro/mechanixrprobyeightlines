// Scheduled every 10 minutes (pg_cron). Sends polite reminders until the customer pays,
// replies STOP, or the lead is closed. Max 4 reminders over 3 days; never during quiet hours.
import { adminDb, env, rupee, respectQuietHours, getSetting, safeEqual } from '../_shared/util.ts';
import { sendSmart, whatsappReady, TPL } from '../_shared/whatsapp.ts';

// Delay before the NEXT reminder, by step just sent.
const NEXT_DELAY_H = [3, 21, 48]; // step0 → +3h, step1 → +21h (≈24h), step2 → +48h (≈72h), step3 → stop

Deno.serve(async (req) => {
  if (!safeEqual(req.headers.get('x-cron-secret') ?? '', env('CRON_SECRET', '__unset__'))) return new Response('Forbidden', { status: 403 });
  if (!whatsappReady()) return new Response(JSON.stringify({ skipped: 'whatsapp not configured' }));
  const db = adminDb();
  if (!(await getSetting(db, 'ai_enabled', true))) return new Response(JSON.stringify({ skipped: 'automation off' }));
  const q = await getSetting(db, 'quiet_hours', { start: 21, end: 9 });

  const { data: due } = await db.from('leads').select('*')
    .lte('next_followup_at', new Date().toISOString())
    .in('status', ['new', 'contacted', 'quoted', 'payment_sent'])
    .eq('opted_out', false).eq('ai_enabled', true).eq('consent_whatsapp', true)
    .lt('followup_step', 4).limit(50);

  let sent = 0;
  for (const lead of due ?? []) {
    const now = new Date();
    const allowed = respectQuietHours(now, q.start, q.end);
    if (allowed.getTime() > now.getTime()) { await db.from('leads').update({ next_followup_at: allowed.toISOString() }).eq('id', lead.id); continue; }

    const first = String(lead.name ?? '').split(' ')[0] || 'there';
    const step: number = lead.followup_step ?? 0;
    let text: string, tpl: { name: string; params: string[] };
    if (lead.payment_link && step < 3) {
      text = `Hi ${first}, your slot for booking ${lead.ref} is on hold. Pay ${rupee(lead.amount_due ?? 199)} to confirm (adjusted in your final bill): ${lead.payment_link}`;
      tpl = { name: TPL.payment(), params: [first, String(lead.amount_due ?? 199), lead.ref, lead.payment_link] };
    } else if (step < 3) {
      text = step === 0
        ? `Hi ${first}, this is Mechanix Pro. We got your booking ${lead.ref}. Reply YES to confirm your slot, or tell us a better time.`
        : `Hi ${first}, your Mechanix Pro booking ${lead.ref} is still open. Shall we confirm it? Reply YES or share a convenient time.`;
      tpl = { name: TPL.followup(), params: [first, lead.ref] };
    } else {
      text = `Hi ${first}, should we keep booking ${lead.ref} open? Reply YES to continue or STOP to close it.`;
      tpl = { name: TPL.last(), params: [first, lead.ref] };
    }
    const id = await sendSmart(db, lead, text, tpl, 'system');
    const nextStep = step + 1;
    const next = nextStep >= 4 ? null : respectQuietHours(new Date(now.getTime() + NEXT_DELAY_H[Math.min(step, 2)] * 3600_000), q.start, q.end).toISOString();
    await db.from('leads').update({ followup_step: nextStep, next_followup_at: next }).eq('id', lead.id);
    if (id) sent++;
  }
  return new Response(JSON.stringify({ due: due?.length ?? 0, sent }), { headers: { 'Content-Type': 'application/json' } });
});
