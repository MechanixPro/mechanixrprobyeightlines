// "Sunday, 11 Oct · Morning (9 AM – 12 PM)": the same wording the website uses. No Deno APIs.
const SLOT: Record<string, string> = { morning: 'Morning (9 AM – 12 PM)', afternoon: 'Afternoon (12 – 4 PM)', evening: 'Evening (4 – 8 PM)' };
export function formatWhen(date: string, slot: string, timeText?: string | null): string {
  if (slot === 'asap') return 'As soon as possible';
  const d = new Date(date + 'T12:00:00+05:30');
  const day = isNaN(d.getTime()) ? date : new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d).replace(/^(\w+) (\d+) (\w+)$/, '$1, $2 $3');
  if (timeText && SLOT[slot]) return `${day} · ${timeText}`;
  return SLOT[slot] ? `${day} · ${SLOT[slot]}` : day;
}
