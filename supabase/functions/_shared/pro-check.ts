// Pro Check 20: a 20-point check and a test ride, recorded in the apps and shown on the customer's tracking page.
// Pure rules, no I/O. The browser copy is assets/js/pro-check-data.js (a test keeps them identical).

export type PointResult = 'ok' | 'needs_attention' | 'not_applicable';
export type RideResult = 'done_fine' | 'done_note' | 'not_done';

/** The 20 points, in the order they are asked, grouped for one screen per group. */
export const GROUPS: { id: string; title: string; points: { key: string; label: string }[] }[] = [
  { id: 'brakes', title: 'Brakes', points: [
    { key: 'brake_front', label: 'Front brake' }, { key: 'brake_rear', label: 'Rear brake' }, { key: 'brake_cable_fluid', label: 'Brake cable or fluid level' } ] },
  { id: 'tyres', title: 'Tyres and wheels', points: [
    { key: 'tyre_front', label: 'Front tyre condition' }, { key: 'tyre_rear', label: 'Rear tyre condition' }, { key: 'tyre_pressure', label: 'Tyre pressure' } ] },
  { id: 'engine', title: 'Engine', points: [
    { key: 'engine_oil', label: 'Engine oil level' }, { key: 'engine_idle', label: 'Engine idle' }, { key: 'air_filter', label: 'Air filter' }, { key: 'spark_plug', label: 'Spark plug' } ] },
  { id: 'electrical', title: 'Electrical', points: [
    { key: 'battery', label: 'Battery' }, { key: 'lights', label: 'Headlight and indicators' }, { key: 'horn', label: 'Horn' } ] },
  { id: 'drive', title: 'Drive', points: [
    { key: 'chain', label: 'Chain tension and lubrication' }, { key: 'clutch', label: 'Clutch' }, { key: 'throttle', label: 'Throttle' } ] },
  { id: 'frame', title: 'Frame', points: [
    { key: 'suspension_fork', label: 'Suspension and fork' }, { key: 'stands', label: 'Stands' }, { key: 'nuts_bolts', label: 'Nuts and bolts tightened' } ] },
  { id: 'leaks_noise', title: 'Leaks and noise', points: [
    { key: 'leak_noise', label: 'Any leak or unusual noise' } ] },
];

export const POINT_KEYS: string[] = GROUPS.flatMap((g) => g.points.map((p) => p.key));
export const POINT_VALUES: PointResult[] = ['ok', 'needs_attention', 'not_applicable'];
export const RIDE_VALUES: RideResult[] = ['done_fine', 'done_note', 'not_done'];
export const RIDE_SKIP_REASONS = ['no_safe_road', 'customer_declined', 'not_rideable'] as const;
export const RIDE_LABEL: Record<string, string> = {
  done_fine: 'Test ride done, all fine', done_note: 'Test ride done, something to note', not_done: 'Test ride not done',
  no_safe_road: 'no safe road nearby', customer_declined: 'customer asked us not to', not_rideable: 'vehicle not rideable',
};
export const SAFETY_LINE = 'Only a rider with a valid licence rides the vehicle. Keep it on safe nearby roads.';
const NOTE_MAX = 140;

export type Results = { points: Record<string, { r: PointResult; n?: string }>; test_ride?: { r: RideResult; why?: string; n?: string } };

const clean = (s: unknown): string => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, NOTE_MAX);

/** Normalises what a phone sent into the stored shape, or returns an error in plain words. Only valid keys and values are kept. */
export function cleanResults(input: any): { ok: true; value: Results } | { ok: false; error: string } {
  const pts: Results['points'] = {};
  const src = input && typeof input === 'object' ? (input.points ?? {}) : {};
  for (const k of POINT_KEYS) {
    const v = src[k];
    if (!v) continue;
    const r = typeof v === 'string' ? v : v.r;
    if (!POINT_VALUES.includes(r)) return { ok: false, error: 'Choose OK, Needs attention or Skip for each point.' };
    const n = typeof v === 'object' ? clean(v.n) : '';
    pts[k] = n ? { r, n } : { r };
  }
  const out: Results = { points: pts };
  const t = input && typeof input === 'object' ? input.test_ride : null;
  if (t) {
    if (!RIDE_VALUES.includes(t.r)) return { ok: false, error: 'Choose a test ride answer.' };
    const ride: NonNullable<Results['test_ride']> = { r: t.r };
    if (t.r === 'not_done') {
      if (!RIDE_SKIP_REASONS.includes(t.why)) return { ok: false, error: 'Say why the test ride was not done.' };
      ride.why = t.why;
    }
    const n = clean(t.n); if (n) ride.n = n;
    out.test_ride = ride;
  }
  return { ok: true, value: out };
}

/** A check is complete when all 20 points are answered and the test ride has an answer. */
export function isComplete(res: Results | null | undefined): boolean {
  if (!res) return false;
  return POINT_KEYS.every((k) => !!res.points?.[k]) && !!res.test_ride;
}

export function missing(res: Results | null | undefined): string[] {
  const out = POINT_KEYS.filter((k) => !res?.points?.[k]);
  if (!res?.test_ride) out.push('test_ride');
  return out;
}

/** Counts for the customer card. */
export function summary(res: Results): { ok: number; attention: number; skipped: number; total: number } {
  let ok = 0, attention = 0, skipped = 0;
  for (const k of POINT_KEYS) { const r = res.points?.[k]?.r; if (r === 'ok') ok++; else if (r === 'needs_attention') attention++; else if (r === 'not_applicable') skipped++; }
  return { ok, attention, skipped, total: POINT_KEYS.length };
}

/** The customer-facing view: labels with results and notes. Nothing else from the job. */
export function customerView(res: Results): { summary: ReturnType<typeof summary>; groups: { title: string; items: { label: string; r: PointResult; n?: string }[] }[]; test_ride: string | null } {
  const groups = GROUPS.map((g) => ({ title: g.title, items: g.points.map((p) => ({ label: p.label, r: (res.points?.[p.key]?.r ?? 'not_applicable') as PointResult, n: res.points?.[p.key]?.n })) }));
  let ride: string | null = null;
  if (res.test_ride) {
    ride = RIDE_LABEL[res.test_ride.r] + (res.test_ride.r === 'not_done' && res.test_ride.why ? ': ' + RIDE_LABEL[res.test_ride.why] : '');
  }
  return { summary: summary(res), groups, test_ride: ride };
}

/** Points that need attention, as plain suggested lines for the quote note. */
export function suggestedQuoteLines(res: Results): string[] {
  const label: Record<string, string> = {};
  for (const g of GROUPS) for (const p of g.points) label[p.key] = p.label;
  return POINT_KEYS.filter((k) => res.points?.[k]?.r === 'needs_attention').map((k) => label[k] + (res.points[k].n ? ': ' + res.points[k].n : ''));
}
