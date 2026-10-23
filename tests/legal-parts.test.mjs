import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('terms say parts are OEM or aftermarket from Axlio, with a service warranty and a limited parts warranty', () => {
  const t = read('../terms/index.html');
  assert.match(t, /OEM or aftermarket/); assert.match(t, /partner Axlio/);
  assert.match(t, /Service warranty:<\/b> Our service work is covered for 30 days/);
  assert.match(t, /Parts warranty:<\/b> parts carry a limited warranty/);
});
test('privacy covers join applications, Axlio, AiSensy, cookies, children and DPDP rights', () => {
  const p = read('../privacy/index.html');
  for (const re of [/apply to join our network/, /Our partner Axlio/, /AiSensy/, /Cookies and local storage/, /Children/, /nominate another person/, /Data Protection Board/]) assert.match(p, re, String(re));
});
test('no page still calls parts OEM-certified', () => {
  for (const f of ['../index.html', '../services/index.html', '../help/index.html', '../terms/index.html']) assert.doesNotMatch(read(f), /OEM[- ]certified/i, f);
});
