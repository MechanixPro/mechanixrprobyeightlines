import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { vehiclePickedUp } from '../supabase/functions/_shared/email-templates.ts';

const site = { siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 79652 95649', phoneTel: '+917965295649', whatsappUrl: 'https://wa.me/918042303061', email: 'hello@mechanixpro.in' };
test('pickup email names the vehicle, registration and booking, and promises no extra work without approval', () => {
  const m = vehiclePickedUp({ ...site, name: 'Ravi Kumar', ref: 'MP-26-27-0001', bike: 'Honda Activa 6G', reg: 'KA01AB1234', service: 'General service' });
  assert.equal(m.subject, 'Your Honda Activa 6G has been picked up MP-26-27-0001');
  assert.match(m.text, /KA01AB1234/); assert.match(m.text, /quote for any extra work/); assert.match(m.html, /Ravi/);
});
test('admin booking sheet edits customer and vehicle, sends pickup notice, auto-confirms on Scheduled', () => {
  const a = readFileSync('admin/admin.js', 'utf8');
  for (const id of ['cv-name', 'cv-email', 'cv-brand', 'cv-model', 'cv-reg']) assert.match(a, new RegExp(id));
  assert.match(a, /booking-notice/); assert.match(a, /Share confirmation on WhatsApp/); assert.match(a, /upd\.status === 'scheduled' && l\.status !== 'scheduled'/);
  assert.match(readFileSync('supabase/functions/booking-notice/index.ts', 'utf8'), /from\('admins'\)/);
});
