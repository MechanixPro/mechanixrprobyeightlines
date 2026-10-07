// Razorpay Payment Links. Docs: https://razorpay.com/docs/api/payments/payment-links/
import { env } from './util.ts';

export const razorpayReady = () => Boolean(env('RAZORPAY_KEY_ID') && env('RAZORPAY_KEY_SECRET'));

export async function createPaymentLink(opts: { amount: number; ref: string; leadId: string; name: string; phone: string; description: string }) {
  if (!razorpayReady()) throw new Error('Razorpay keys are not configured');
  const auth = btoa(`${env('RAZORPAY_KEY_ID')}:${env('RAZORPAY_KEY_SECRET')}`);
  const r = await fetch('https://api.razorpay.com/v1/payment_links', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: Math.round(opts.amount * 100), currency: 'INR', accept_partial: false,
      description: opts.description.slice(0, 2048),
      reference_id: `${opts.ref}-${Date.now().toString(36)}`,
      customer: { name: opts.name, contact: '+91' + opts.phone },
      notify: { sms: false, email: false }, reminder_enable: false,
      notes: { lead_id: opts.leadId, ref: opts.ref },
      expire_by: Math.floor(Date.now() / 1000) + 3 * 24 * 3600,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.description ?? 'Razorpay error');
  return { id: j.id as string, url: j.short_url as string };
}
