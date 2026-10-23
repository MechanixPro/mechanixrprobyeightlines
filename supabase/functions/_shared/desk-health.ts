// Desk watchdog: finds problems in the WhatsApp automation and emails the supervisors once per problem (again after a cool-down).
import { getSetting, istHour } from './util.ts';
import { sendEmail } from './resend.ts';
import { supervisorEmails } from './desk-notify.ts';
import { findProblems } from './desk-health-rules.ts';

const MIN = 60_000, HOUR = 3_600_000;

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Reads the heartbeats and logs, finds problems, and emails the ones not already reported inside their cool-down. */
export async function runWatchdog(db: any, deskUrl: string, only?: 'poll' | 'automation'): Promise<{ problems: string[]; emailed: number }> {
  const [auto, poll, last, since] = await Promise.all([
    getSetting<any>(db, 'desk_automation_heartbeat', null), getSetting<any>(db, 'desk_poll_heartbeat', null), getSetting<Record<string, string>>(db, 'desk_health_alerts', {}),
    db.from('crm_automation_log').select('ran_at').eq('job', 'campaigns').order('ran_at', { ascending: true }).limit(1),
  ]);
  const [{ count: bad }, { data: lastCamp }, ready] = await Promise.all([
    db.from('crm_automation_log').select('id', { count: 'exact', head: true }).eq('ok', false).gt('ran_at', new Date(Date.now() - HOUR).toISOString()),
    db.from('crm_automation_log').select('summary').eq('job', 'campaigns').order('ran_at', { ascending: false }).limit(1),
    getSetting<boolean>(db, 'desk_campaigns_ready', false),
  ]);
  let problems = findProblems({
    now: Date.now(), hour: istHour(), autoAt: auto?.at, pollAt: poll?.at, pollChecked: poll?.checked, pollFailed: poll?.failed, recentJobFailures: bad ?? 0,
    campaignsReady: !!ready, waitingNames: (lastCamp?.[0]?.summary?.waiting ?? []).map((w: string) => w.split(':')[0]), waitingSince: since?.data?.[0]?.ran_at ?? null,
  });
  // each cron function judges what the other one reports, so a stopped job is still noticed
  if (only === 'poll') problems = problems.filter((p) => p.key === 'automation_stale');
  if (only === 'automation') problems = problems.filter((p) => p.key !== 'automation_stale');
  const fresh = problems.filter((p) => !last[p.key] || Date.now() - Date.parse(last[p.key]) > p.coolHours * HOUR);
  let emailed = 0;
  if (fresh.length) {
    const to = await supervisorEmails(db);
    const text = `Desk automation needs a look:\n\n- ${fresh.map((p) => p.line).join('\n- ')}\n\nOpen the desk: ${deskUrl}#team`;
    const html = `<p><b>Desk automation needs a look</b></p><ul>${fresh.map((p) => `<li>${esc(p.line)}</li>`).join('')}</ul><p><a href="${deskUrl}#team">Open the desk, Team</a></p>`;
    for (const addr of to) { const r = await sendEmail({ to: addr, subject: 'Desk automation needs a look', html, text, tags: { template: 'desk_health' } }); if (r.ok) emailed++; }
    if (emailed > 0 || to.length === 0) { const now = new Date().toISOString(); for (const p of fresh) last[p.key] = now; await db.from('settings').upsert({ key: 'desk_health_alerts', value: last }, { onConflict: 'key' }); }
  }
  return { problems: problems.map((p) => p.key), emailed };
}
