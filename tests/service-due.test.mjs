import test from 'node:test';
import assert from 'node:assert/strict';
import { isReminderDue, DUE_DAYS } from '../supabase/functions/_shared/service-due.ts';
import { serviceDue } from '../supabase/functions/_shared/email-templates.ts';

const now = new Date('2026-12-30T10:00:00Z');
const daysAgo = (n) => new Date(now.getTime() - n * 86400000).toISOString();
const lead = (o) => ({ status: 'completed', reminder_opt_in: true, reminder_sent_at: null, completed_at: daysAgo(DUE_DAYS + 1), ...o });
const cust = (o) => ({ email: 'a@b.in', email_unsubscribed_at: null, blocked: false, ...o });

test('a completed, opted-in booking is due once the interval has passed', () => {
  assert.equal(isReminderDue(lead({}), cust({}), now), true);
});
test('not due too early, twice, without opt-in, or when not completed', () => {
  assert.equal(isReminderDue(lead({ completed_at: daysAgo(DUE_DAYS - 5) }), cust({}), now), false);
  assert.equal(isReminderDue(lead({ reminder_sent_at: daysAgo(1) }), cust({}), now), false);
  assert.equal(isReminderDue(lead({ reminder_opt_in: false }), cust({}), now), false);
  assert.equal(isReminderDue(lead({ status: 'scheduled' }), cust({}), now), false);
});
test('never for a customer without email, unsubscribed or blocked', () => {
  assert.equal(isReminderDue(lead({}), cust({ email: null }), now), false);
  assert.equal(isReminderDue(lead({}), cust({ email_unsubscribed_at: daysAgo(3) }), now), false);
  assert.equal(isReminderDue(lead({}), cust({ blocked: true }), now), false);
});
test('the email names the bike, links to the build and has an unsubscribe link', () => {
  const m = serviceDue({ siteUrl: 'https://mechanixpro.in', phoneDisplay: '+91 97430 31301', phoneTel: '+919743031301', whatsappUrl: 'https://wa.me/919743031301', email: 'hello@mechanixpro.in',
    name: 'Asha Rao', bike: '"Raja" (Honda Activa 6G)', lastService: 'General service', buildUrl: 'https://mechanixpro.in/book/?model=Activa', unsubscribeUrl: 'https://mechanixpro.in/unsubscribe/?c=1&t=2' });
  assert.match(m.subject, /service/i);
  assert.match(m.html, /Raja/); assert.match(m.html, /Unsubscribe/); assert.match(m.html, /book\/\?model=Activa/);
  assert.match(m.text, /Unsubscribe: https:\/\/mechanixpro\.in\/unsubscribe/);
  assert.doesNotMatch(m.html, /\{\{|undefined/);
});
