import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { orderBody, validSignature, cleanVerify, cleanOrderRequest, paymentState } from '../supabase/functions/_shared/checkout.ts';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

const SECRET = 'test_secret_value';
const sig = (o, p, s = SECRET) => createHmac('sha256', s).update(o + '|' + p).digest('hex');

test('the signature check matches Razorpay: HMAC-SHA256 of order_id|payment_id with the key secret', async () => {
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', sig('order_AAA111', 'pay_BBB222'), SECRET), true);
});
test('a wrong signature, a swapped payment, another secret or an empty value is rejected', async () => {
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', sig('order_AAA111', 'pay_OTHER1'), SECRET), false);
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', sig('order_AAA111', 'pay_BBB222', 'another'), SECRET), false);
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', '', SECRET), false);
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', 'zz', SECRET), false);
  assert.equal(await validSignature('order_AAA111', 'pay_BBB222', sig('order_AAA111', 'pay_BBB222'), ''), false); // no secret configured
});
test('verify input needs all three Razorpay fields in the right shape', () => {
  assert.equal(cleanVerify({ razorpay_order_id: 'order_AAA111', razorpay_payment_id: 'pay_BBB222', razorpay_signature: sig('order_AAA111', 'pay_BBB222') }).ok, true);
  for (const miss of ['razorpay_order_id', 'razorpay_payment_id', 'razorpay_signature']) {
    const b = { razorpay_order_id: 'order_AAA111', razorpay_payment_id: 'pay_BBB222', razorpay_signature: sig('a', 'b') }; delete b[miss];
    assert.equal(cleanVerify(b).ok, false, miss);
  }
  assert.equal(cleanVerify({ razorpay_order_id: 'x', razorpay_payment_id: 'pay_BBB222', razorpay_signature: sig('a', 'b') }).ok, false);
});
test('an order is built in paise, in INR, with a short receipt and the booking in the notes', () => {
  const r = orderBody({ id: 'lead-uuid', ref: 'MP-ABC123', amount_due: 349 }, 349, 1_800_000_000_000);
  assert.equal(r.ok, true); assert.equal(r.body.amount, 34900); assert.equal(r.body.currency, 'INR');
  assert.ok(r.body.receipt.length <= 40); assert.match(r.body.receipt, /^MP-ABC123-/);
  assert.deepEqual(r.body.notes, { lead_id: 'lead-uuid', ref: 'MP-ABC123' });
});
test('the amount is what is due on the booking, else the checkup fee, and never below 100 paise', () => {
  assert.equal(orderBody({ id: 'x', ref: 'MP-1', amount_due: 1500 }, 349, 1).body.amount, 150000);
  assert.equal(orderBody({ id: 'x', ref: 'MP-1', amount_due: null }, 349, 1).body.amount, 34900);
  assert.equal(orderBody({ id: 'x', ref: 'MP-1', amount_due: 0 }, 0, 1).ok, false);
  assert.equal(orderBody({ id: 'x', ref: 'MP-1', amount_due: 0.5 }, 349, 1).ok, false); // 50 paise
  assert.equal(orderBody({ id: 'x', ref: 'MP-1', amount_due: 999999 }, 349, 1).ok, false); // above the limit
});
test('creating an order needs the booking reference and the mobile number it was made with', () => {
  assert.deepEqual(cleanOrderRequest({ ref: ' mp-0cebac ', phone: '+91 98765 43210' }), { ok: true, ref: 'MP-0CEBAC', phone: '9876543210' });
  assert.equal(cleanOrderRequest({ ref: 'nope', phone: '9876543210' }).ok, false);
});
test('only a captured payment counts as paid; an authorised one is pending; anything else is not paid', () => {
  assert.equal(paymentState({ status: 'captured' }), 'paid');
  assert.equal(paymentState({ status: 'authorized' }), 'pending');
  for (const s of ['failed', 'created', 'refunded', undefined]) assert.equal(paymentState({ status: s }), 'unpaid');
});
test('the two functions are public, check everything on the server and never put the secret in the response', () => {
  const cfg = read('supabase/config.toml');
  assert.match(cfg, /\[functions\.create-order\]\nverify_jwt = false/); assert.match(cfg, /\[functions\.verify-payment\]\nverify_jwt = false/);
  const c = read('supabase/functions/create-order/index.ts'), v = read('supabase/functions/verify-payment/index.ts');
  assert.match(c, /api\.razorpay\.com\/v1\/orders/); assert.match(c, /key_id/); assert.doesNotMatch(c, /json\([^)]*RAZORPAY_KEY_SECRET/);
  assert.match(v, /validSignature/); assert.match(v, /status: 400|, 400\)/); assert.match(v, /api\.razorpay\.com\/v1\/payments/); assert.match(v, /payment_id/); // checks the payment itself and stops replays
});
test('no Razorpay secret is written anywhere in the project files', () => {
  for (const f of ['assets/js/pay.js', 'assets/js/config.js', 'docs/RAZORPAY.md', 'supabase/functions/create-order/index.ts', 'supabase/functions/verify-payment/index.ts']) {
    if (!existsSync(new URL('../' + f, import.meta.url))) continue;
    assert.doesNotMatch(read(f), /rzp_(test|live)_[A-Za-z0-9]{8,}/, f); assert.doesNotMatch(read(f), /key_secret\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i, f);
  }
});
test('the pay page asks for the reference and number, loads Razorpay checkout, is kept out of search, and the policy allows it', () => {
  const h = read('pay/index.html'), j = read('assets/js/pay.js'), hd = read('_headers');
  assert.match(h, /noindex/); assert.match(h, /id="payForm"/); assert.equal((h.match(/<h1[ >]/g) || []).length, 1);
  assert.match(j, /checkout\.razorpay\.com\/v1\/checkout\.js/); assert.match(j, /payment\.failed/); assert.match(j, /ondismiss/); assert.match(j, /functions\/v1\/' \+ fn/); assert.match(j, /call\('create-order'/); assert.match(j, /call\('verify-payment'/);
  assert.match(hd, /script-src[^;]*https:\/\/checkout\.razorpay\.com/); assert.match(hd, /script-src[^;]*https:\/\/cdn\.razorpay\.com/); assert.match(hd, /frame-src[^;]*https:\/\/api\.razorpay\.com/);
  assert.doesNotMatch(read('sitemap.xml'), /\/pay\//); assert.match(read('scripts/build_site.sh'), /\bpay\b/);
});
