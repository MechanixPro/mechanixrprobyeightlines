// Cashfree Payments (PG) helpers. No Deno-only imports, so Node can test them with a mocked fetch.
// Docs: https://www.cashfree.com/docs/payments/online/  (orders: POST /orders, payments: GET /orders/{id}/payments, links: POST /links, webhooks: x-webhook-signature)
// Secrets come from the environment only: CASHFREE_APP_ID, CASHFREE_SECRET_KEY, CASHFREE_ENV ('production' | 'sandbox').

const envOf = (k: string): string => String((globalThis as any).Deno?.env?.get(k) ?? (globalThis as any).process?.env?.[k] ?? '').trim();

export const CASHFREE_API_VERSION_DEFAULT = '2026-01-01';   // the "latest" version in Cashfree's API reference; override with CASHFREE_API_VERSION after testing in sandbox
export const NOT_CONFIGURED = 'Cashfree keys are not configured';
const MAX_RUPEES = 100000;
const COMPANY_PHONE = '8310621498';   // used only where Cashfree requires a phone and the person has none; links never notify

export const cashfreeReady = (): boolean => Boolean(envOf('CASHFREE_APP_ID') && envOf('CASHFREE_SECRET_KEY'));
export const cashfreeMode = (): 'production' | 'sandbox' => (envOf('CASHFREE_ENV').toLowerCase() === 'sandbox' ? 'sandbox' : 'production');
export const cashfreeBase = (): string => (cashfreeMode() === 'sandbox' ? 'https://sandbox.cashfree.com/pg' : 'https://api.cashfree.com/pg');
const siteUrl = (): string => envOf('SITE_URL') || 'https://mechanixpro.in';
export const webhookUrl = (): string => `${envOf('SUPABASE_URL') || 'https://mejdxsbpyscujpvbwvmg.supabase.co'}/functions/v1/cashfree-webhook`;

/** Order ids we create. The random part makes the id unguessable: only the person who paid ever sees it. */
export const isCashfreeOrderId = (id: unknown): boolean => /^mxp_[A-Za-z0-9-]{3,13}_[0-9a-f]{20}$/.test(String(id ?? ''));
const rand20 = (): string => crypto.randomUUID().replace(/-/g, '').slice(0, 20);
export const newOrderId = (ref: string): string => `mxp_${String(ref).replace(/[^A-Za-z0-9-]/g, '').slice(0, 13) || 'x'}_${rand20()}`;
export const newLinkId = (ref: string): string => `mxp-${String(ref).replace(/[^A-Za-z0-9-]/g, '').slice(0, 13) || 'x'}-${Date.now().toString(36)}-${rand20().slice(0, 10)}`.slice(0, 50);
export const isOurLinkId = (id: unknown): boolean => /^mxp-[A-Za-z0-9-]{1,13}-[0-9a-z]{4,12}-[0-9a-f]{10}$/.test(String(id ?? ''));

export const rupees2 = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;
const phoneOk = (p: string): boolean => /^[6-9]\d{9}$/.test(p);
const cleanPhone = (p: unknown): string => { const d = String(p ?? '').replace(/\D/g, '').slice(-10); return phoneOk(d) ? d : COMPANY_PHONE; };
const cleanName = (n: unknown): string | null => { const s = String(n ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 100); return s.length >= 3 ? s : null; };
const cleanEmail = (e: unknown): string | null => { const s = String(e ?? '').trim(); return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s) && s.length <= 100 ? s : null; };

function headers(): Record<string, string> {
  if (!cashfreeReady()) throw new Error(NOT_CONFIGURED);
  return { 'x-client-id': envOf('CASHFREE_APP_ID'), 'x-client-secret': envOf('CASHFREE_SECRET_KEY'), 'x-api-version': envOf('CASHFREE_API_VERSION') || CASHFREE_API_VERSION_DEFAULT, 'Content-Type': 'application/json', Accept: 'application/json' };
}

export class CashfreeError extends Error { status: number; constructor(msg: string, status = 0) { super(msg); this.status = status; } }

async function cf(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
  const h = headers();   // throws 'Cashfree keys are not configured' before any network call
  const r = await fetch(cashfreeBase() + path, { method: init.method ?? 'GET', headers: h, body: init.body === undefined ? undefined : JSON.stringify(init.body), signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new CashfreeError(String(j?.message ?? 'Cashfree error'), r.status);   // the message is shown to staff only; the keys are never in it
  return j;
}

/* ---------- orders (Checkout) ---------- */
export type OrderOpts = { leadId: string; ref: string; rupees: number; phone: string; email?: string | null; name?: string | null; note?: string; returnPath?: string; orderId?: string; now?: number };

/** The body for POST /orders. The amount is in RUPEES (a decimal number), never paise. Pure, so it is tested without a network. */
export function orderPayload(o: OrderOpts) {
  const amount = rupees2(o.rupees);
  if (!(amount >= 1)) throw new Error('The amount is below the minimum of ₹1');
  if (amount > MAX_RUPEES) throw new Error('The amount is above the online limit');
  const name = cleanName(o.name), email = cleanEmail(o.email), now = o.now ?? Date.now();
  const cust: Record<string, string> = { customer_id: 'c' + String(o.leadId).replace(/[^A-Za-z0-9]/g, '').slice(0, 40), customer_phone: cleanPhone(o.phone) };
  if (email) cust.customer_email = email;
  if (name) cust.customer_name = name;
  return {
    order_id: o.orderId ?? newOrderId(o.ref), order_amount: amount, order_currency: 'INR', customer_details: cust,
    order_meta: { return_url: `${siteUrl()}${o.returnPath ?? '/pay/'}?cf_order={order_id}`, notify_url: webhookUrl() },
    order_note: String(o.note ?? 'Mechanix Pro booking').slice(0, 200),
    order_tags: { lead_id: String(o.leadId), ref: String(o.ref) },
    order_expiry_time: new Date(now + 60 * 60_000).toISOString(),
  };
}

export async function createCashfreeOrder(o: OrderOpts): Promise<{ order_id: string; payment_session_id: string; amount: number }> {
  const body = orderPayload(o);
  const j = await cf('/orders', { method: 'POST', body });
  if (!j?.payment_session_id || j.order_id !== body.order_id) throw new CashfreeError('Cashfree did not return a payment session');
  return { order_id: String(j.order_id), payment_session_id: String(j.payment_session_id), amount: body.order_amount };
}
export const getCashfreeOrder = (orderId: string) => cf(`/orders/${encodeURIComponent(orderId)}`);
export const getCashfreeOrderPayments = async (orderId: string): Promise<any[]> => { const j = await cf(`/orders/${encodeURIComponent(orderId)}/payments`); return Array.isArray(j) ? j : []; };
export const getCashfreeLink = (linkId: string) => cf(`/links/${encodeURIComponent(linkId)}`);

/** What the browser needs to open Cashfree Checkout for an order that is still payable (reuse), or null when a new order is needed. */
export async function reusableOrder(orderId: string, wantRupees: number): Promise<{ order_id: string; payment_session_id: string; amount: number } | { paid: true } | null> {
  if (!isCashfreeOrderId(orderId)) return null;
  const o = await getCashfreeOrder(orderId).catch(() => null);
  if (!o) return null;
  if (o.order_status === 'PAID') return { paid: true };
  if (o.order_status === 'ACTIVE' && o.payment_session_id && rupees2(o.order_amount) === rupees2(wantRupees)) return { order_id: orderId, payment_session_id: String(o.payment_session_id), amount: rupees2(wantRupees) };
  return null;
}

/* ---------- confirming a payment with Cashfree (never from the browser's word) ---------- */
export type Confirmed =
  | { state: 'paid'; orderId: string; paymentId: string; amount: number; fee: number; tags: Record<string, string>; order: any }
  | { state: 'pending' | 'unpaid' | 'mismatch' | 'foreign'; reason?: string };

/** Asks Cashfree for the order and its payments. Paid only when a payment has payment_status SUCCESS, INR, and its amount equals the order amount we created (and `expectedRupees` when given). Throws on a Cashfree or network failure. */
export async function confirmOrderPayment(orderId: string, expectedRupees?: number): Promise<Confirmed> {
  const order = await getCashfreeOrder(orderId);
  if (!order || order.order_id !== orderId) return { state: 'foreign', reason: 'order not found' };
  const tags: Record<string, string> = order.order_tags && typeof order.order_tags === 'object' ? order.order_tags : {};
  if (!tags.lead_id && !tags.link_id) return { state: 'foreign', reason: 'not one of our orders' };
  const pays = await getCashfreeOrderPayments(orderId);
  const ok = pays.find((p) => p?.payment_status === 'SUCCESS');
  if (!ok) return { state: pays.some((p) => p?.payment_status === 'PENDING') ? 'pending' : 'unpaid' };
  const paid = rupees2(ok.payment_amount), due = rupees2(order.order_amount);
  if (String(order.order_currency ?? 'INR') !== 'INR' || String(ok.payment_currency ?? 'INR') !== 'INR') return { state: 'mismatch', reason: 'currency' };
  if (!(paid >= 1) || paid !== due || (expectedRupees != null && rupees2(expectedRupees) !== paid)) return { state: 'mismatch', reason: `paid ${paid} but expected ${expectedRupees ?? due}` };
  if (!ok.cf_payment_id) return { state: 'unpaid', reason: 'no payment id' };
  return { state: 'paid', orderId, paymentId: String(ok.cf_payment_id), amount: paid, fee: 0, tags, order };
}

/* ---------- Payment Links ---------- */
export type LinkOpts = { amount: number; ref: string; leadId: string; name: string; phone: string; description: string; notes?: Record<string, string>; linkId?: string; now?: number };

export function linkPayload(o: LinkOpts) {
  const amount = rupees2(o.amount);
  if (!(amount >= 1)) throw new Error('The amount is below the minimum of ₹1');
  if (amount > MAX_RUPEES) throw new Error('The amount is above the online limit');
  const now = o.now ?? Date.now(), name = cleanName(o.name);
  const cust: Record<string, string> = { customer_phone: cleanPhone(o.phone) };
  if (name) cust.customer_name = name;
  return {
    link_id: o.linkId ?? newLinkId(o.ref), link_amount: amount, link_currency: 'INR', link_purpose: String(o.description).slice(0, 500), customer_details: cust,
    link_expiry_time: new Date(now + 3 * 24 * 3600_000).toISOString(), link_notify: { send_sms: false, send_email: false }, link_auto_reminders: false, link_partial_payments: false,
    link_meta: { notify_url: webhookUrl(), return_url: `${siteUrl()}/track/` },
    link_notes: { lead_id: String(o.leadId), ref: String(o.ref), ...(o.notes ?? {}) },   // Cashfree allows at most 5 notes
  };
}
export async function createCashfreeLink(o: LinkOpts): Promise<{ id: string; url: string }> {
  const body = linkPayload(o);
  const j = await cf('/links', { method: 'POST', body });
  if (!j?.link_url) throw new CashfreeError('Cashfree did not return a payment link');
  return { id: String(j.link_id ?? body.link_id), url: String(j.link_url) };
}

/* ---------- webhook signature ---------- */
const b64 = (b: ArrayBuffer): string => { let s = ''; for (const x of new Uint8Array(b)) s += String.fromCharCode(x); return btoa(s); };
export const WEBHOOK_MAX_AGE_MS = 10 * 60_000;
/** x-webhook-signature = base64(HMAC-SHA256(secret, x-webhook-timestamp + rawBody)). Constant-time compare; a timestamp more than 10 minutes from now is rejected (replay). */
export async function webhookValid(rawBody: string, timestamp: string | null, signature: string | null, secret: string, nowMs = Date.now()): Promise<boolean> {
  if (!secret || !timestamp || !signature) return false;
  let t = Number(timestamp);
  if (!Number.isFinite(t)) t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return false;
  if (t < 1e12) t *= 1000;   // seconds
  if (Math.abs(nowMs - t) > WEBHOOK_MAX_AGE_MS) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const want = b64(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(timestamp + rawBody)));
  if (want.length !== signature.length) return false;
  let diff = 0; for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
