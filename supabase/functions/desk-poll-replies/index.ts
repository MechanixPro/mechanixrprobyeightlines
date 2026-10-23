// POST /functions/v1/desk-poll-replies — run every few minutes by a database schedule (pg_cron). Secured by x-desk-cron (secret DESK_CRON_SECRET).
// Asks AiSensy (Project API, included in the plan) when each open lead's customer last wrote, so the desk can show "customer replied, nobody answered yet" without webhooks.
import { adminDb, env, json, safeEqual } from '../_shared/util.ts';
import { fetchContact } from '../_shared/aisensy-contact.ts';
import { runWatchdog } from '../_shared/desk-health.ts';
const DESK_URL = Deno.env.get('DESK_URL') ?? 'https://mechanixpro-crm.pages.dev/crm/';

const OPEN = ['new', 'contacted', 'quoted', 'payment_sent'];

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);
  const secret = env('DESK_CRON_SECRET');
  if (!secret || !safeEqual(req.headers.get('x-desk-cron') ?? '', secret)) return json(req, { error: 'Forbidden' }, 403);
  if (!env('AISENSY_PROJECT_KEY') || !env('AISENSY_PROJECT_ID')) return json(req, { ok: false, error: 'AiSensy is not connected' });

  const db = adminDb();
  const since = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: leads } = await db.from('leads').select('id,phone,last_customer_msg_at,wa_last_message_at').is('deleted_at', null).in('status', OPEN).eq('opted_out', false).gte('created_at', since)
    .order('wa_last_message_at', { ascending: true, nullsFirst: true }).limit(120);
  let checked = 0, updated = 0, failed = 0;
  const queue = [...(leads ?? [])];
  const worker = async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      const r = await fetchContact({ projectId: env('AISENSY_PROJECT_ID'), password: env('AISENSY_PROJECT_KEY'), phone: l.phone });
      checked++;
      if (!r.ok) { failed++; continue; }
      const s = r.state!; if (!s.found) continue;
      const patch: Record<string, unknown> = {};
      if (s.lastActive && (!l.last_customer_msg_at || Date.parse(l.last_customer_msg_at) < s.lastActive)) patch.last_customer_msg_at = new Date(s.lastActive).toISOString();
      if (s.lastMessage && (!l.wa_last_message_at || Date.parse(l.wa_last_message_at) !== s.lastMessage)) patch.wa_last_message_at = new Date(s.lastMessage).toISOString();
      if (Object.keys(patch).length) { await db.from('leads').update(patch).eq('id', l.id); updated++; }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  await db.from('settings').upsert({ key: 'desk_poll_heartbeat', value: { at: new Date().toISOString(), checked, updated, failed } }, { onConflict: 'key' }).then(() => {}, () => {});
  const health = await runWatchdog(db, DESK_URL, 'poll').catch(() => null);
  return json(req, { ok: true, checked, updated, failed, health });
});
