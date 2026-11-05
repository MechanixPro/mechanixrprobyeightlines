// The confirmation fee: a small amount (Rs 49 to Rs 99) paid to confirm a doorstep slot, adjusted in the final bill. No Deno APIs, so Node can test it.
// Worked out on the SERVER from the vehicle and the model; the browser never sets the amount. Rows live in the services table (kind 'fee', edit in the admin Prices tab):
//   confirm_std (up to 149cc), confirm_mid (150 to 250cc), confirm_big (251cc and above), confirm_car (cars).
// Floor and cap are enforced here and by a database check on those rows (migration 20261228000000).
export const FEE_MIN = 49, FEE_MAX = 99;
export const FEE_IDS = ['confirm_std', 'confirm_mid', 'confirm_big', 'confirm_car'] as const;
export const FEE_DEFAULTS: Record<string, number> = { confirm_std: 49, confirm_mid: 69, confirm_big: 99, confirm_car: 99 };
export const UNKNOWN_FEE = 69;   // model or engine size could not be worked out: charge the middle tier and flag the lead for Crew
export type EngineClass = 'std' | 'mid' | 'big';
export const GST_RATE = 18;

/** Clamp any number into the allowed range. A bad value (NaN, 0, negative, text) becomes the middle tier, never free and never above the cap. */
export function clampFee(n: unknown): number {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return UNKNOWN_FEE;
  return Math.min(FEE_MAX, Math.max(FEE_MIN, v));
}

/** Engine class from a number in the model name (Pulsar 220F, SP 160, CB300F). Same rule as engineGuess in assets/js/logic.js: 251 and up is big, 150 and up is mid, a smaller number is std. null when the name has no number. */
export function engineFromModel(model: unknown): EngineClass | null {
  const nums = (String(model ?? '').match(/\d{2,4}/g) ?? []).map(Number).filter((n) => n >= 50 && n <= 2500);
  if (!nums.length) return null;
  const cc = Math.max(...nums);
  return cc >= 251 ? 'big' : cc >= 150 ? 'mid' : 'std';
}
const RANK: Record<EngineClass, number> = { std: 0, mid: 1, big: 2 };
export const cleanEngine = (v: unknown): EngineClass | null => (v === 'std' || v === 'mid' || v === 'big' ? v : null);

/** The class to price: the higher of the model-name class and the class the form sent (a customer cannot lower the fee by picking a smaller class for a model with a cc number). null = unknown. */
export function engineFor(model: unknown, sent: unknown): { engine: EngineClass | null; conflict: boolean } {
  const a = engineFromModel(model), b = cleanEngine(sent);
  if (a && b) return { engine: RANK[a] >= RANK[b] ? a : b, conflict: a !== b };
  return { engine: a ?? b, conflict: false };
}

export type FeeRow = { id: string; price: number | string };
/** The fee for one booking. rows are the confirm_* rows from services (missing rows fall back to the defaults). Returns the amount, the rule used and whether Crew should review it. */
export function confirmFee(o: { vehicle?: string | null; model?: unknown; engine?: unknown; rows?: FeeRow[] }): { amount: number; id: string; engine: EngineClass | null; review: boolean; reason: string } {
  const price = (id: string) => clampFee(o.rows?.find((r) => r.id === id)?.price ?? FEE_DEFAULTS[id]);
  if (o.vehicle === 'car') return { amount: price('confirm_car'), id: 'confirm_car', engine: null, review: false, reason: 'car' };
  const { engine, conflict } = engineFor(o.model, o.engine);
  if (!engine) return { amount: clampFee(UNKNOWN_FEE), id: 'unknown', engine: null, review: true, reason: 'engine size unknown' };
  const id = 'confirm_' + engine;
  return { amount: price(id), id, engine, review: conflict, reason: conflict ? 'model and picked size differ' : 'engine size' };
}

/** One line shown before paying, from the same amount. */
export function feeLine(vehicle: string | null | undefined, amount: number): string {
  return `Confirmation fee for your ${vehicle === 'car' ? 'car' : 'bike size'}: Rs ${amount}. Adjusted in your final bill.`.replace('Rs ', '₹');
}

/** The part of an amount that is GST when the amount includes it (every website amount does). */
export function gstSplit(inclusive: number, rate = GST_RATE): { base: number; gst: number; total: number } {
  const total = Math.round(Number(inclusive) * 100) / 100;
  const base = Math.round((total / (1 + rate / 100)) * 100) / 100;
  return { base, gst: Math.round((total - base) * 100) / 100, total };
}
