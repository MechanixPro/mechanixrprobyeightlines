// POST /functions/v1/desk-automation — run every 3 minutes by a database schedule (pg_cron). Secured by x-desk-cron (secret DESK_CRON_SECRET).
// Three jobs, each switchable and each logged:
//   1. campaigns: once AiSensy approves a desk template, create its API campaign (no one has to press a button)
//   2. sla: email the supervisors when a customer has waited 15 minutes for a reply, or a new lead has no owner after 15 minutes
//   3. rating: ask a customer to rate the job, once, a couple of hours after it is completed
//   5. watchdog: email the supervisors when the automation, the reply checker or AiSensy stops working, or the templates stay unapproved for a day
//   4. journey: tell the customer when the quote is ready, when the booking is confirmed with the mechanic, and when the service is done (each once)
import { adminDb, env, json, safeEqual, getSetting, istHour } from '../_shared/util.ts';
import { PROJECT_API } from '../_shared/aisensy-project.ts';
import { sendCampaign } from '../_shared/aisensy-send.ts';
import { DESK_TEMPLATES } from '../_shared/desk-templates.ts';
import { ratingToken, ratingUrl } from '../_shared/rating.ts';
import { sendEmail } from '../_shared/resend.ts';
import { supervisorEmails } from '../_shared/desk-notify.ts';
import { formatWhen } from '../_shared/when.ts';
import { runWatchdog } from '../_shared/desk-health.ts';
import { issueCard, cardUrl } from '../_shared/warranty.ts';

const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];
const MIN = 60_000;
// The desk address. Set the DESK_URL secret to switch to the custom domain (https://crew.mechanixpro.in/crm/) once its DNS record is live.
const DESK_URL = Deno.env.get('DESK_URL') ?? 'https://mechanixpro-crm.pages.dev/crm/';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('DESK_CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-desk-cron') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  const db = adminDb();
  const result: Record<string, unknown> = {};
  const log = (job: string, ok: boolean, summary: Record<string, unknown>) => db.from('crm_automation_log').insert({ job, ok, summary }).then(() => {}, () => {});
  const hour = istHour();

  /* 1. campaigns */
  try {
    const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
    const allDone = DESK_TEMPLATES.every((t) => ready[t.campaign]);
    const last = Date.parse(String(await getSetting(db, 'desk_campaigns_checked_at', '1970-01-01')));
    if (!allDone && env('AISENSY_PROJECT_KEY') && env('AISENSY_PROJECT_ID') && Date.now() - last > 9 * MIN) {
      const base = `${PROJECT_API}/project/${env('AISENSY_PROJECT_ID')}`;
      const h = { 'Content-Type': 'application/json', 'X-AiSensy-Project-API-Pwd': env('AISENSY_PROJECT_KEY') };
      const tr = await fetch(`${base}/wa_template/?limit=100`, { headers: h }).then((r) => r.json()).catch(() => ({}));
      const list: any[] = Array.isArray(tr?.template) ? tr.template : [];
      const made: string[] = [], waiting: string[] = [];
      for (const t of DESK_TEMPLATES) {
        if (ready[t.campaign]) continue;
        const tpl = list.find((x) => x.name === t.name);
        if (!tpl || String(tpl.status).toUpperCase() !== 'APPROVED') { waiting.push(t.name + ':' + (tpl?.status ?? 'missing')); continue; }
        const r = await fetch(`${base}/campaign/api`, { method: 'POST', headers: h, body: JSON.stringify({ template_name: t.name, campaign_name: t.campaign }) });
        const body = await r.text().catch(() => '');
        if (r.ok || /exist/i.test(body)) { ready[t.campaign] = true; made.push(t.campaign); } else waiting.push(t.name + ':campaign ' + r.status);
      }
      await db.from('settings').upsert([{ key: 'desk_campaigns', value: ready }, { key: 'desk_campaigns_ready', value: DESK_TEMPLATES.every((t) => ready[t.campaign]) }, { key: 'desk_campaigns_checked_at', value: new Date().toISOString() }], { onConflict: 'key' });
      result.campaigns = { made, waiting }; await log('campaigns', true, { made, waiting });
    }
  } catch (e) { result.campaigns = { error: String((e as Error).message) }; await log('campaigns', false, { error: String((e as Error).message) }); }

  /* 2. SLA alerts: we are open 24/7, so these run around the clock; one email per run, each item once */
  try {
    if (await getSetting(db, 'desk_sla_alerts', true)) {
      const sla = Number(await getSetting(db, 'crm_sla_minutes', 15)) || 15;
      const now = Date.now();
      const { data: cand } = await db.from('leads').select('id,ref,name,last_customer_msg_at,wa_last_message_at,crm_owner').is('deleted_at', null).in('status', OPEN).eq('opted_out', false)
        .gt('last_customer_msg_at', new Date(now - 3 * 86400_000).toISOString()).lt('last_customer_msg_at', new Date(now - sla * MIN).toISOString()).limit(60);
      const ids = (cand ?? []).map((l: any) => l.id);
      const { data: acts } = ids.length ? await db.from('crm_activities').select('lead_id,created_at').in('lead_id', ids).in('kind', ['call', 'whatsapp']).gt('created_at', new Date(now - 3 * 86400_000).toISOString()) : { data: [] };
      const waiting = (cand ?? []).filter((l: any) => (!l.wa_last_message_at || Date.parse(l.last_customer_msg_at) >= Date.parse(l.wa_last_message_at) - 90_000)
        && !(acts ?? []).some((a: any) => a.lead_id === l.id && Date.parse(a.created_at) > Date.parse(l.last_customer_msg_at)));
      const { data: unowned } = await db.from('leads').select('id,ref,name,created_at,source').is('deleted_at', null).eq('status', 'new').is('crm_owner', null)
        .gt('created_at', new Date(now - 2 * 86400_000).toISOString()).lt('created_at', new Date(now - sla * MIN).toISOString()).limit(60);
      const items: { lead_id: string; kind: string; line: string }[] = [];
      for (const l of waiting) items.push({ lead_id: l.id, kind: 'reply_wait:' + new Date(l.last_customer_msg_at).toISOString().slice(0, 16), line: `${l.name} (${l.ref}) wrote on WhatsApp ${Math.round((now - Date.parse(l.last_customer_msg_at)) / MIN)} min ago and has no answer` });
      for (const l of unowned ?? []) items.push({ lead_id: l.id, kind: 'unassigned', line: `${l.name} (${l.ref}, ${l.source}) has had no owner for ${Math.round((now - Date.parse(l.created_at)) / MIN)} min` });
      const { data: sent } = items.length ? await db.from('crm_alerts_sent').select('lead_id,kind').in('lead_id', items.map((i) => i.lead_id)) : { data: [] };
      const fresh = items.filter((i) => !(sent ?? []).some((s: any) => s.lead_id === i.lead_id && s.kind === i.kind));
      let emailed = 0;
      if (fresh.length) {
        const to = await supervisorEmails(db);
        const text = `${fresh.length} ${fresh.length === 1 ? 'customer needs' : 'customers need'} attention on the desk:\n\n- ${fresh.map((i) => i.line).join('\n- ')}\n\nOpen the desk: ${DESK_URL}#inbox`;
        const html = `<p><b>${fresh.length} ${fresh.length === 1 ? 'customer needs' : 'customers need'} attention on the desk</b></p><ul>${fresh.map((i) => `<li>${esc(i.line)}</li>`).join('')}</ul><p><a href="${DESK_URL}#inbox">Open the desk</a></p>`;
        for (const addr of to) { const r = await sendEmail({ to: addr, subject: `${fresh.length} on the desk need a reply`, html, text, tags: { template: 'desk_sla' } }); if (r.ok) emailed++; }
        if (emailed > 0 || to.length === 0) await db.from('crm_alerts_sent').upsert(fresh.map((i) => ({ lead_id: i.lead_id, kind: i.kind })), { onConflict: 'lead_id,kind', ignoreDuplicates: true });
      }
      result.sla = { alerts: fresh.length, emailed }; if (fresh.length) await log('sla', true, { alerts: fresh.length, emailed });
    }
  } catch (e) { result.sla = { error: String((e as Error).message) }; await log('sla', false, { error: String((e as Error).message) }); }

  /* 3. rating requests: 9 AM to 8 PM, once per job, 2 to 48 hours after completion */
  try {
    const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
    const rc = DESK_TEMPLATES.find((t) => t.name === 'mxp_desk_rating_link')!;
    if (await getSetting(db, 'desk_auto_rating', true) && hour >= 9 && hour < 20 && ready[rc.campaign] && env('AISENSY_API_KEY') && env('RATING_SECRET')) {
      const now = Date.now();
      const { data: jobs } = await db.from('leads').select('id,ref,name,phone').is('deleted_at', null).eq('status', 'completed').eq('consent_whatsapp', true).eq('opted_out', false).is('rating_requested_at', null)
        .not('completed_at', 'is', null).gt('completed_at', new Date(now - 48 * 3600_000).toISOString()).lt('completed_at', new Date(now - 2 * 3600_000).toISOString()).order('completed_at').limit(10);
      const ids = (jobs ?? []).map((l: any) => l.id);
      const { data: failed } = ids.length ? await db.from('crm_alerts_sent').select('lead_id').in('lead_id', ids).eq('kind', 'rating_fail') : { data: [] };
      let sentN = 0, failN = 0;
      for (const l of (jobs ?? []).filter((x: any) => !(failed ?? []).some((f: any) => f.lead_id === x.id))) {
        const link = ratingUrl(env('SITE_URL', 'https://mechanixpro.in'), l.ref, await ratingToken(env('RATING_SECRET'), l.ref));
        const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: rc.campaign, phone: l.phone, name: l.name, params: [String(l.name).split(' ')[0], l.ref, link], source: 'mechanix-desk-auto' });
        if (r.ok) {
          sentN++;
          await db.from('leads').update({ rating_requested_at: new Date().toISOString() }).eq('id', l.id);
          await db.from('messages').insert({ lead_id: l.id, phone: l.phone, direction: 'out', sender: 'system', body: 'Rating request sent automatically' }).then(() => {}, () => {});
          await db.from('crm_activities').insert({ lead_id: l.id, actor: null, kind: 'whatsapp', body: 'Rating request sent automatically on WhatsApp' }).then(() => {}, () => {});
        } else { failN++; await db.from('crm_alerts_sent').upsert({ lead_id: l.id, kind: 'rating_fail' }, { onConflict: 'lead_id,kind', ignoreDuplicates: true }); console.error('auto rating', l.ref, r.error); }
      }
      result.rating = { sent: sentN, failed: failN }; if (sentN || failN) await log('rating', failN === 0, { sent: sentN, failed: failN });
    }
  } catch (e) { result.rating = { error: String((e as Error).message) }; await log('rating', false, { error: String((e as Error).message) }); }

  /* 4. journey messages: quote ready, booking confirmed, service done. Only for jobs that changed after the switch-on time, each once per job (a revised quote goes once more). */
  try {
    const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
    if (await getSetting(db, 'desk_auto_journey', true) && env('AISENSY_API_KEY')) {
      const since = new Date(Math.max(Date.parse(String(await getSetting(db, 'desk_journey_since', new Date().toISOString()))) || 0, Date.now() - 24 * 3600_000)).toISOString();
      const tpl = (n: string) => DESK_TEMPLATES.find((t) => t.name === n)!;
      type Job = { l: any; kind: string; t: string; params: string[]; note: string };
      const jobs: Job[] = [];
      const base = () => db.from('leads').select('id,ref,name,phone,area,est_total,status,preferred_date,preferred_slot,mechanic_id,completed_at,address').is('deleted_at', null).eq('consent_whatsapp', true).eq('opted_out', false).gt('updated_at', since).limit(30);
      if (ready[tpl('mxp_quote_ready').campaign]) {
        const { data } = await base().eq('status', 'quoted').gt('est_total', 0);
        for (const l of data ?? []) jobs.push({ l, kind: 'journey_quote:' + Math.round(l.est_total), t: 'mxp_quote_ready', params: [String(l.name).split(' ')[0], l.ref, String(Math.round(l.est_total))], note: 'Quote sent automatically' });
      }
      if (ready[tpl('mxp_booking_confirmed').campaign]) {
        const { data } = await base().eq('status', 'scheduled').not('mechanic_id', 'is', null).not('preferred_date', 'is', null);
        const mids = [...new Set((data ?? []).map((l: any) => l.mechanic_id))];
        const { data: ms } = mids.length ? await db.from('mechanics').select('id,name').in('id', mids) : { data: [] };
        for (const l of data ?? []) { const m = (ms ?? []).find((x: any) => x.id === l.mechanic_id); jobs.push({ l, kind: 'journey_booked:' + l.preferred_date + ':' + l.preferred_slot + ':' + l.mechanic_id, t: 'mxp_booking_confirmed', params: [String(l.name).split(' ')[0], l.ref, formatWhen(l.preferred_date, l.preferred_slot), String(m?.name ?? 'from our team').split(' ')[0], l.area || 'your address'], note: 'Booking confirmation sent automatically' }); }
      }
      if (ready[tpl('mxp_service_done').campaign]) {
        const { data } = await base().eq('status', 'completed').not('completed_at', 'is', null);
        for (const l of data ?? []) jobs.push({ l, kind: 'journey_done', t: 'mxp_service_done', params: [String(l.name).split(' ')[0], l.ref], note: 'Service-done message sent automatically' });
      }
      const ids = [...new Set(jobs.map((j) => j.l.id))];
      const { data: sent } = ids.length ? await db.from('crm_alerts_sent').select('lead_id,kind').in('lead_id', ids) : { data: [] };
      let sentN = 0, failN = 0;
      for (const j of jobs.filter((x) => !(sent ?? []).some((s: any) => s.lead_id === x.l.id && s.kind === x.kind)).slice(0, 12)) {
        const t = tpl(j.t);
        const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: t.campaign, phone: j.l.phone, name: j.l.name, params: j.params, source: 'mechanix-desk-journey' });
        // Mark it either way so a failing number is not retried every three minutes; the log shows the failure.
        await db.from('crm_alerts_sent').upsert({ lead_id: j.l.id, kind: j.kind }, { onConflict: 'lead_id,kind', ignoreDuplicates: true });
        if (r.ok) {
          sentN++;
          await db.from('messages').insert({ lead_id: j.l.id, phone: j.l.phone, direction: 'out', sender: 'system', body: j.note }).then(() => {}, () => {});
          await db.from('crm_activities').insert({ lead_id: j.l.id, actor: null, kind: 'whatsapp', body: j.note + ' on WhatsApp' }).then(() => {}, () => {});
        } else { failN++; console.error('journey', j.t, j.l.ref, r.error); }
      }
      result.journey = { sent: sentN, failed: failN }; if (sentN || failN) await log('journey', failN === 0, { sent: sentN, failed: failN });
    }
  } catch (e) { result.journey = { error: String((e as Error).message) }; await log('journey', false, { error: String((e as Error).message) }); }

  /* 6. warranty cards: once a completed booking is fully paid, make its card; send it on WhatsApp when the template is approved. Only for bookings completed after the switch-on time. */
  try {
    if (await getSetting(db, 'desk_auto_warranty', true)) {
      const since = String(await getSetting(db, 'warranty_since', new Date().toISOString()));
      const { data: cands } = await db.rpc('warranty_candidates', { p_since: since });
      let made = 0, sentN = 0;
      for (const c of (cands ?? []).slice(0, 8)) { const r = await issueCard(db, c.lead_id); if (r.card) made++; }
      const ready = await getSetting<Record<string, boolean>>(db, 'desk_campaigns', {});
      const t = DESK_TEMPLATES.find((x) => x.name === 'mxp_warranty_card')!;
      if (ready[t.campaign] && env('AISENSY_API_KEY')) {
        const { data: unsent } = await db.from('warranty_cards').select('id,code,lead_id,customer_name,phone,valid_until').is('sent_at', null).gt('created_at', new Date(Date.now() - 7 * 86400_000).toISOString()).limit(8);
        const ids = (unsent ?? []).map((u: any) => u.lead_id);
        const { data: leads } = ids.length ? await db.from('leads').select('id,ref,consent_whatsapp,opted_out').in('id', ids) : { data: [] };
        for (const u of unsent ?? []) {
          const l = (leads ?? []).find((x: any) => x.id === u.lead_id); if (!l || !l.consent_whatsapp || l.opted_out) continue;
          const r = await sendCampaign({ apiKey: env('AISENSY_API_KEY'), campaignName: t.campaign, phone: u.phone, name: u.customer_name, params: [String(u.customer_name).split(' ')[0], l.ref, new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(u.valid_until + 'T12:00:00+05:30')), cardUrl(u.code)], source: 'mechanix-desk-warranty' });
          await db.from('warranty_cards').update({ sent_at: new Date().toISOString() }).eq('id', u.id);
          if (r.ok) { sentN++; await db.from('crm_activities').insert({ lead_id: u.lead_id, actor: null, kind: 'whatsapp', body: 'Warranty card sent automatically on WhatsApp' }).then(() => {}, () => {}); }
        }
      }
      result.warranty = { made, sent: sentN }; if (made || sentN) await log('warranty', true, { made, sent: sentN });
    }
  } catch (e) { result.warranty = { error: String((e as Error).message) }; await log('warranty', false, { error: String((e as Error).message) }); }

  /* 5. watchdog: email the supervisors if the reply checker, AiSensy or the templates need attention */
  try { result.health = await runWatchdog(db, DESK_URL, 'automation'); } catch (e) { result.health = { error: String((e as Error).message) }; }

  await db.from('settings').upsert({ key: 'desk_automation_heartbeat', value: { at: new Date().toISOString(), result } }, { onConflict: 'key' }).then(() => {}, () => {});
  return json(req, { ok: true, ...result });
});
