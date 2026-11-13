// Which online payment gateway is live. PAYMENT_GATEWAY = 'razorpay' (the default when unset) or 'cashfree'.
// No Deno-only imports, so Node can test it. Nothing here ever falls back from one gateway to the other for a charge.
import { cashfreeReady, createCashfreeLink } from './cashfree.ts';

const envOf = (k: string): string => String((globalThis as any).Deno?.env?.get(k) ?? (globalThis as any).process?.env?.[k] ?? '').trim();

export type Gateway = 'razorpay' | 'cashfree';

/** The active gateway. Unset or empty means Razorpay. Any value other than razorpay or cashfree is an error, never a guess. */
export function gateway(): Gateway {
  const v = envOf('PAYMENT_GATEWAY').toLowerCase();
  if (v === '' || v === 'razorpay') return 'razorpay';
  if (v === 'cashfree') return 'cashfree';
  throw new Error('PAYMENT_GATEWAY must be razorpay or cashfree');
}

/** True when the ACTIVE gateway has its keys. A bad PAYMENT_GATEWAY value counts as not ready. */
export function paymentsReady(): boolean {
  try {
    if (gateway() === 'cashfree') return cashfreeReady();
    return Boolean(envOf('RAZORPAY_KEY_ID') && envOf('RAZORPAY_KEY_SECRET'));
  } catch { return false; }
}

export type LinkOpts = { amount: number; ref: string; leadId: string; name: string; phone: string; description: string; notes?: Record<string, string> };

/** Collect payment from the garage and technician apps (the final bill, as a link and QR). It stays on Razorpay while Cashfree Payment Links is not approved for the account.
 *  COLLECT_GATEWAY=cashfree makes these follow Cashfree once that is approved; unset or anything else means Razorpay. The website checkout is not affected: it follows PAYMENT_GATEWAY. */
export const collectGateway = (): Gateway => (envOf('COLLECT_GATEWAY').toLowerCase() === 'cashfree' ? 'cashfree' : 'razorpay');
export function collectReady(): boolean {
  if (collectGateway() === 'cashfree') return cashfreeReady();
  return Boolean(envOf('RAZORPAY_KEY_ID') && envOf('RAZORPAY_KEY_SECRET'));
}
export async function createCollectLink(opts: LinkOpts): Promise<{ id: string; url: string }> {
  if (collectGateway() === 'cashfree') return await createCashfreeLink(opts);
  const m = await import('./razorpay.ts');
  return await m.createPaymentLink(opts);
}

/** One Payment Link on the active gateway. Same return shape for both: { id, url }. */
export async function createPaymentLink(opts: LinkOpts): Promise<{ id: string; url: string }> {
  if (gateway() === 'cashfree') return await createCashfreeLink(opts);
  const m = await import('./razorpay.ts');
  return await m.createPaymentLink(opts);
}
