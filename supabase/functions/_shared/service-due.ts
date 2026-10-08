// Which completed bookings should get a "your next service is due" email. No Deno APIs, so Node can test it.
export const DUE_DAYS = 75;
type L = { status?: string; reminder_opt_in?: boolean; reminder_sent_at?: string | null; completed_at?: string | null };
type C = { email?: string | null; email_unsubscribed_at?: string | null; blocked?: boolean | null };
export function isReminderDue(l: L, c: C | null, now: Date): boolean {
  if (!c || !c.email || c.blocked || c.email_unsubscribed_at) return false;
  if (l.status !== 'completed' || !l.reminder_opt_in || l.reminder_sent_at || !l.completed_at) return false;
  return now.getTime() - new Date(l.completed_at).getTime() >= DUE_DAYS * 86400_000;
}
