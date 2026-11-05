import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const lds = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));

test('one business entity: the home page defines it, area and roadside pages point to it', () => {
  const home = lds(read('index.html')).find((x) => x['@type'] === 'AutoRepair');
  assert.equal(home['@id'], 'https://mechanixpro.in/#business');
  assert.equal(home.address.postalCode, '560102'); assert.match(home.priceRange, /^₹499–₹1,299$/);
  const svc = lds(read('bike-service-hsr-layout/index.html')).find((x) => x['@type'] === 'Service');
  assert.equal(svc.provider['@id'], 'https://mechanixpro.in/#business'); assert.ok(svc.offers.some((o) => o.price === '499'));
  const road = lds(read('roadside/index.html'));
  assert.ok(road.some((x) => x['@type'] === 'FAQPage')); assert.ok(road.find((x) => x['@type'] === 'Service').offers.some((o) => o.price === '1299'));
});

test('area pages answer the questions riders ask, with only the allowed claims', () => {
  const t = read('bike-service-hsr-layout/index.html');
  for (const s of ['How much is a bike service in HSR Layout?', 'What is included in a Standard service?', 'Is doorstep bike service safe?', 'Do you help with breakdowns in HSR Layout?', '10,000+ services done', '1,300+ gated communities trust us', 'Prices checked on', 'doorstep-service-p.webp']) assert.ok(t.includes(s), s);
  assert.doesNotMatch(t, /★|rating|reviews? from/i);
});

test('no GST or phone contradictions in the built pages, and llms.txt carries the key facts', () => {
  for (const p of ['two-wheeler-service-at-home-bangalore/index.html', 'help/index.html', 'terms/index.html', 'bike-service-hsr-layout/index.html']) {
    const t = read(p); assert.doesNotMatch(t, /Prices include GST|prices include GST|up to 180cc/, p); assert.doesNotMatch(t, /XXXXX XXXXX/, p);
  }
  const l = read('llms.txt');
  for (const s of ['10,000+ services done', '1,300+ gated communities', 'roadside emergency visit ₹1,299', 'a small confirmation fee, ₹49 to ₹99 depending on your vehicle', '560001 to 560110', '+91 79652 95649']) assert.ok(l.includes(s), s);
  assert.match(read('robots.txt'), /Content-Signal: search=yes, ai-input=yes, ai-train=no/);
});

test('robots.txt lets AI search read the site and keeps AI training out', () => {
  // Groups: consecutive User-agent lines share the rules that follow them.
  const groups = []; let cur = null;
  for (const line of read('robots.txt').split('\n').map((l) => l.trim())) {
    const m = line.match(/^(User-agent|Allow|Disallow):\s*(.*)$/i); if (!m) continue;
    if (/^user-agent$/i.test(m[1])) { if (!cur || cur.rules.length) groups.push(cur = { agents: [], rules: [] }); cur.agents.push(m[2]); } else cur.rules.push(m[1].toLowerCase() + ' ' + m[2]);
  }
  const rules = (bot) => groups.find((g) => g.agents.includes(bot)).rules;
  for (const bot of ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'PerplexityBot', 'Perplexity-User']) assert.ok(rules(bot).includes('allow /'), bot);
  for (const bot of ['GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'CCBot']) assert.deepEqual(rules(bot), ['disallow /'], bot);
});
