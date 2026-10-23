// Pure rules for the desk watchdog (no imports, so tests can load it).
const MIN = 60_000, HOUR = 3_600_000;

export interface Health {
  now: number; hour: number;
  autoAt?: string | null; pollAt?: string | null; pollChecked?: number; pollFailed?: number;
  recentJobFailures?: number; campaignsReady?: boolean; waitingNames?: string[]; waitingSince?: string | null;
}
export interface Problem { key: string; line: string; coolHours: number }

/** Pure: which problems exist right now. The reply checker only runs 7:30 AM to 10:30 PM IST, so it is judged only from 8 AM to 10 PM. */
export function findProblems(h: Health): Problem[] {
  const out: Problem[] = [];
  const age = (iso?: string | null) => (iso ? h.now - Date.parse(iso) : Infinity);
  if (age(h.autoAt) > 15 * MIN) out.push({ key: 'automation_stale', line: 'The desk automation has not run for more than 15 minutes. Quote, booking and rating messages and wait alerts are paused.', coolHours: 6 });
  if (h.hour >= 8 && h.hour < 22 && age(h.pollAt) > 25 * MIN) out.push({ key: 'poll_stale', line: 'The customer reply checker has not run for more than 25 minutes, so new WhatsApp replies may not show in the Inbox.', coolHours: 6 });
  if ((h.pollChecked ?? 0) > 0 && (h.pollFailed ?? 0) >= (h.pollChecked ?? 0)) out.push({ key: 'poll_failing', line: `Every AiSensy check failed on the last run (${h.pollFailed} of ${h.pollChecked}). The AiSensy key or plan may need attention.`, coolHours: 6 });
  if ((h.recentJobFailures ?? 0) >= 3) out.push({ key: 'jobs_failing', line: `${h.recentJobFailures} automation steps failed in the last hour. Open the desk, Team, Automation to see which.`, coolHours: 3 });
  if (!h.campaignsReady && h.waitingSince && h.now - Date.parse(h.waitingSince) > 24 * HOUR) out.push({ key: 'templates_waiting', line: `WhatsApp templates are still waiting for Meta approval after more than a day: ${(h.waitingNames ?? []).join(', ') || 'see the desk'}. Messages that need them are not being sent. Meta business verification usually speeds this up.`, coolHours: 24 });
  return out;
}

