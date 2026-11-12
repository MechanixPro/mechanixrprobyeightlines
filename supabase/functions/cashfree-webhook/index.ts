// Cashfree webhook: confirms Cashfree payments (Checkout orders and Payment Links) even when the customer closed the tab. Deploy with verify_jwt = false (see config.toml).
// Cashfree Dashboard > Developers > Webhooks: enable PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_USER_DROPPED (and the Payment Link event). See docs/CASHFREE-CUTOVER.md.
// The signature is checked first; then Cashfree is asked about the order itself, so the webhook body is never trusted for money.
import { adminDb, env } from '../_shared/util.ts';
import { webhookValid } from '../_shared/cashfree.ts';
import { settleCashfreeOrder } from '../_shared/cashfree-settle.ts';
import { liveDeps } from '../_shared/payment-effects-live.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  const raw = await req.text();   // the signature covers the raw text, not the parsed JSON
  if (!(await webhookValid(raw, req.headers.get('x-webhook-timestamp'), req.headers.get('x-webhook-signature'), env('CASHFREE_SECRET_KEY')))) return new Response('Bad signature', { status: 401 });
  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response('Bad body', { status: 400 }); }

  let orderId = '';
  if (evt?.type === 'PAYMENT_SUCCESS_WEBHOOK') orderId = String(evt?.data?.order?.order_id ?? '');
  else if (evt?.type === 'PAYMENT_LINK_EVENT' && evt?.data?.link_status === 'PAID') orderId = String(evt?.data?.order?.order_id ?? '');   // same payment as the success event; the payment id makes the second one a no-op
  else return new Response('ignored');   // PAYMENT_FAILED_WEBHOOK, PAYMENT_USER_DROPPED_WEBHOOK and anything else: nothing to do
  if (!orderId) return new Response('ignored');

  const r = await settleCashfreeOrder(adminDb(), orderId, 'webhook', liveDeps);
  if (r.kind === 'retry') return new Response('retry', { status: 500 });   // Cashfree delivers again
  if (r.kind === 'unpaid') return new Response('retry', { status: 500 });   // Cashfree says success but its API does not yet: try again shortly
  return new Response(r.kind === 'paid' ? 'ok' : r.kind);
});
