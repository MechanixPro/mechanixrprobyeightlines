// Razorpay Standard Checkout helpers. No Deno APIs, so Node can test them. Docs: https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/integration-steps/
import { cleanLookup } from './track.ts';

const MIN_PAISE = 100;          // Razorpay's minimum
const MAX_RUPEES = 100000;      // same ceiling as the admin payment links

// What the customer owes on a booking, in paise: the amount due the admin set, otherwise the checkup and quote fee.
export function orderBody(lead: { id: string; ref: string; amount_due?: number | null }, advanceRupees: number, now: number):
  { ok: true; body: { amount: number; currency: 'INR'; receipt: string; notes: { lead_id: string; ref: string } } } | { ok: false; error: string } {
  const rupees = Number(lead.amount_due) > 0 ? Number(lead.amount_due) : Number(advanceRupees);
  const amount = Math.round(rupees * 100);
  if (!(amount >= MIN_PAISE)) return { ok: false, error: 'The amount is below the minimum of ₹1' };
  if (rupees > MAX_RUPEES) return { ok: false, error: 'The amount is above the online limit' };
  return { ok: true, body: { amount, currency: 'INR', receipt: `${lead.ref}-${now.toString(36)}`.slice(0, 40), notes: { lead_id: lead.id, ref: lead.ref } } };
}

export const cleanOrderRequest = cleanLookup;

export function cleanVerify(b: Record<string, unknown>): { ok: true; order_id: string; payment_id: string; signature: string } | { ok: false } {
  const order_id = String(b?.razorpay_order_id ?? ''), payment_id = String(b?.razorpay_payment_id ?? ''), signature = String(b?.razorpay_signature ?? '').toLowerCase();
  if (!/^order_[A-Za-z0-9]{6,30}$/.test(order_id) || !/^pay_[A-Za-z0-9]{6,30}$/.test(payment_id) || !/^[0-9a-f]{64}$/.test(signature)) return { ok: false };
  return { ok: true, order_id, payment_id, signature };
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
// HMAC-SHA256(order_id + "|" + payment_id, key_secret), compared in constant time.
export async function validSignature(orderId: string, paymentId: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(orderId + '|' + paymentId)));
  if (want.length !== signature.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// A payment counts as paid only once it is captured. "authorized" is money not yet taken.
export function paymentState(p: { status?: string }): 'paid' | 'pending' | 'unpaid' {
  if (p?.status === 'captured') return 'paid';
  if (p?.status === 'authorized') return 'pending';
  return 'unpaid';
}
