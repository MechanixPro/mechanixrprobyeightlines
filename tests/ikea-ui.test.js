const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const app = read('assets/js/app.js');

test('the visitor can share, copy and send their build from the package step and the summary', () => {
  for (const a of ['copyBuild', 'shareBuild', 'sendDraft']) assert.match(app, new RegExp("data-act=\\\\\"" + a + "\\\\\"|data-act=\"" + a + "\"|'" + a + "'"), a);
  assert.match(app, /decodeBuild\(/); assert.match(app, /encodeBuild\(/);
});
test('there is an explicit "save my build and call me back" choice that creates a callback lead', () => {
  assert.match(app, /Save my build and call me back/); assert.match(app, /requestType = 'callback'/); assert.match(app, /We will call you/);
});
test('the leave prompt exists, is reachable by keyboard, and never traps the visitor', () => {
  assert.match(app, /'exitSheet'/); assert.match(app, /setAttribute\('role', 'dialog'\)/); assert.match(app, /setAttribute\('aria-modal', 'true'\)/); assert.match(app, /Escape/);
  assert.match(app, /mouseout|mouseleave/); assert.match(app, /shouldPromptExit\(/); assert.match(app, /sessionStorage/);
});
test('the form offers pick up and drop, a registration number and a service reminder choice', () => {
  assert.match(app, /Pick up and drop/); assert.match(app, /Registration number/); assert.match(app, /Remind me when my next service is due/);
});
test('the page keeps the visitor informed: nothing here is hidden behind a trick', () => {
  assert.doesNotMatch(app, /beforeunload/); assert.doesNotMatch(app, /history\.pushState/);
});
