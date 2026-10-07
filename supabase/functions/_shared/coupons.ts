// Coupon rules, kept free of Deno APIs so Node can test them.
export type Coupon = { code: string; kind: 'percent' | 'flat'; value: number; min_amount: number | null; active: boolean; starts_on: string | null; ends_on: string | null; max_uses: number | null };
export const normalizeCode = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 20);
const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const no = (reason: string) => ({ valid: false, discount: 0, reason });

/** `used` = quotes already accepted with this code. Returns the discount in rupees. */
export function applyCoupon(c: Coupon | null, subtotal: number, used: number, now = new Date()) {
  if (!c) return no('This code is not valid.');
  if (!c.active) return no('This code is not active.');
  const today = istDate(now);
  if (c.starts_on && today < c.starts_on) return no(`This code starts on ${c.starts_on}.`);
  if (c.ends_on && today > c.ends_on) return no('This code has expired.');
  if (c.max_uses != null && used >= c.max_uses) return no('This code has been fully used.');
  if (c.min_amount && subtotal < c.min_amount) return no(`This code needs an order of at least ₹${c.min_amount.toLocaleString('en-IN')}.`);
  const raw = c.kind === 'percent' ? Math.floor((subtotal * c.value) / 100) : c.value;
  return { valid: true, discount: Math.max(0, Math.min(raw, subtotal)), reason: '' };
}
