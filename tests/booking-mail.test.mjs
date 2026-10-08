import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FROM_DEFAULT, FROM_BOOKING } from '../supabase/functions/_shared/resend.ts';
import { bookingReceived, bookingConfirmed, invoiceEmail } from '../supabase/functions/_shared/email-templates.ts';
import { buildInvoice as serverInvoice } from '../supabase/functions/_shared/invoice.ts';
import { buildInvoice as adminInvoice } from '../admin/invoice.js';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SITE = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 97430 31301', phoneTel: '+919743031301', whatsappUrl: 'https://wa.me/919743031301', email: 'hello@mechanixpro.in' };

test('booking mail comes from booking@, login and offer mail from no-reply@', () => {
  assert.equal(FROM_BOOKING, 'Mechanix Pro Bookings <booking@mechanixpro.in>');
  assert.equal(FROM_DEFAULT, 'Mechanix Pro <no-reply@mechanixpro.in>');
  for (const f of ['submit-lead', 'confirm-booking', 'send-invoice']) assert.match(read(`../supabase/functions/${f}/index.ts`), /from: FROM_BOOKING/, f);
  assert.doesNotMatch(read('../supabase/functions/send-broadcast/index.ts'), /FROM_BOOKING/);
  assert.match(read('../supabase/config.toml'), /admin_email = "no-reply@mechanixpro\.in"/);
});
test('booking mails show the customer\'s own build and a link to edit it (the IKEA effect)', () => {
  const d = { ...SITE, name: 'Asha', ref: 'MP-1', bike: '"Raja" (Honda Activa 6G)', nick: 'Raja', service: 'General service', area: 'HSR', whenText: 'Sat, 11 Oct · 10–11 AM', estimate: 1299, buildUrl: 'https://mechanixpro.in/book/?brand=Honda&model=Activa%206G&nick=Raja' };
  for (const m of [bookingReceived(d), bookingConfirmed(d)]) {
    assert.match(m.html, /Your package for/); assert.match(m.html, /&quot;Raja&quot; \(Honda Activa 6G\)/);
    assert.match(m.html, /Edit your build/); assert.match(m.html, /nick=Raja/);
    assert.match(m.text, /Edit your build: https:\/\/mechanixpro\.in\/book/);
  }
});
test('mail headers use the real logo and wordmark images', () => {
  const h = bookingReceived({ ...SITE, name: 'A', ref: 'R', bike: 'B', service: 'S', area: 'A', whenText: 'W', estimate: 1 }).html;
  assert.match(h, /assets\/img\/email-logo\.png/); assert.match(h, /assets\/img\/email-wordmark\.png/);
});
test('invoice mail lists items, splits GST, shows company details and what was paid', () => {
  const inv = adminInvoice({ ref: 'MP-1', name: 'Asha', phone: '9876543210', service_id: 'general', addons: ['wash'], coupon_discount: 100, paid_amount: 349 }, [
    { id: 'general', kind: 'service', name: 'General service', price: 1299 }, { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 }], { date: '2026-10-08T05:00:00Z' });
  const m = invoiceEmail({ ...SITE, invoice: inv, company: { legalName: 'NOVA VENTURES', addressLines: ['Haralur Main Rd'], city: 'Bengaluru', state: 'Karnataka', pincode: '560102', gstin: '29DVCPR0895G1Z3' } });
  assert.match(m.subject, /INV-MP-1/);
  for (const t of ['General service', 'Foam wash', 'CGST', 'SGST', 'NOVA VENTURES', '29DVCPR0895G1Z3', 'Balance due', '1,049.00']) assert.ok(m.html.includes(t), t);
  assert.match(m.text, /Balance due/);
});
test('the server invoice figures match the admin invoice figures', () => {
  const services = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }, { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 }, { id: 'bigbike', kind: 'fee', name: 'Big bike surcharge', price: 300 }];
  for (const lead of [{ ref: 'A', name: 'x', phone: '9', service_id: 'general', addons: ['wash'], big_bike: true, coupon_discount: 100, paid_amount: 349 }, { ref: 'B', name: 'y', phone: '9', service_id: 'general', addons: [], paid_amount: 1299 }]) {
    const a = adminInvoice(lead, services, { date: '2026-10-08T05:00:00Z' }), b = serverInvoice(lead, services, { date: '2026-10-08T05:00:00Z' });
    assert.deepEqual(b, a);
  }
});
test('send-invoice is admin-only, logs the mail, and the admin invoice has an email button', () => {
  const f = read('../supabase/functions/send-invoice/index.ts');
  assert.match(f, /from\('admins'\)/); assert.match(f, /invoiceEmail\(/); assert.match(f, /template: 'invoice'/);
  assert.match(read('../admin/admin.js'), /data-act="invEmail"/); assert.match(read('../admin/admin.js'), /functions\.invoke\('send-invoice'/);
});
