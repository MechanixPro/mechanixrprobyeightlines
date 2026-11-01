import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('the car service page goes through Axlio, claims no price or warranty of its own, and is in the sitemap and the menu', () => {
  const page = read('car-service-bangalore/index.html');
  assert.match(page, /<h1>Car service in Bangalore, quote first\.<\/h1>/); assert.match(page, /partner Axlio/); assert.match(page, /run separately from Mechanix Pro/);
  assert.ok(!/₹\s?\d/.test(page.replace(/<script[\s\S]*?<\/script>/g, '')), 'no rupee amount on the car page');
  assert.match(page, /"@type":\s?"FAQPage"/); assert.match(read('sitemap.xml'), /car-service-bangalore/); assert.match(read('index.html'), /href="\/car-service-bangalore\/"/);
});
test('llms.txt carries the same prices as the site and robots.txt lets AI assistants read the public pages', () => {
  const site = JSON.parse(read('src/site.json')), llms = read('llms.txt');
  for (const k of ['basic', 'general', 'full']) assert.ok(llms.includes('₹' + site.services[k].price.toLocaleString('en-IN')), k);
  assert.match(llms, /30-day service warranty/); assert.match(llms, /Axlio/);
  const robots = read('robots.txt'); for (const bot of ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended']) assert.match(robots, new RegExp('User-agent: ' + bot)); assert.match(robots, /Disallow: \/admin\//);
  assert.match(read('scripts/build_site.sh'), /llms\.txt/);
});
test('blog posts go live on their date, and the daily workflow rebuilds and deploys the site every morning', () => {
  const py = read('scripts/build_pages.py'); assert.match(py, /x\['date'\] <= today/);
  const wf = read('.github/workflows/daily-publish.yml'); assert.match(wf, /cron: '30 0 \* \* \*'/); assert.match(wf, /pages deploy dist-site/);
  assert.match(read('scripts/build_site.sh'), /guides blog car-service-bangalore/);
});
test('the blog posts, when present, follow the brand rules: valid, one a day, no rupee amounts, no invented numbers', () => {
  if (!existsSync(new URL('../src/blog/posts.json', import.meta.url))) return;
  const posts = JSON.parse(read('src/blog/posts.json')), slugs = new Set();
  posts.forEach((p, i) => {
    assert.ok(p.slug && !slugs.has(p.slug), p.slug); slugs.add(p.slug);
    assert.match(p.date, /^\d{4}-\d{2}-\d{2}$/); assert.ok(p.sections.length >= 4 && p.faq.length >= 3, p.slug);
    const text = JSON.stringify(p); assert.ok(!/₹|10,000|1,300|per cent|\d\s?%/.test(text), p.slug + ' has a number we cannot back');
    assert.ok(p.title.length <= 70 && p.desc.length <= 160, p.slug + ' title or description too long');
    if (i) assert.equal((Date.parse(p.date) - Date.parse(posts[i - 1].date)) / 864e5, 1, 'one post per day at ' + p.slug);
  });
});
