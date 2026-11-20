import puppeteer from 'puppeteer-core';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = 'file://' + process.cwd() + '/dist/index.html';
const out = process.argv[2] || 'shots';
import fs from 'fs'; fs.mkdirSync(out, { recursive: true });
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(w, h, q = '') { const p = await b.newPage(); await p.setViewport({ width: w, height: h, deviceScaleFactor: 1 }); await p.goto(url + q); await wait(1800); return p; }
// 1 home hero (desktop)
let p = await page(1440, 900);
await p.screenshot({ path: `${out}/01-home-hero.png` });
// full page after scrolling to trigger reveals
await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } window.scrollTo(0, 0); });
await wait(1200);
await p.screenshot({ path: `${out}/02-home-full.png`, fullPage: true });
// 3 pick a service
await p.evaluate(() => document.getElementById('services').scrollIntoView());
await wait(600);
await p.click('.svc:nth-child(2)'); await wait(900);
await p.screenshot({ path: `${out}/03-service-selected.png` });
await p.close();
// 4 picker
p = await page(1440, 900, '?picker=1'); await wait(700);
await p.screenshot({ path: `${out}/04-city-picker.png` });
await p.type('input[aria-label="Search a state or city"]', 'ma'); await wait(700);
await p.screenshot({ path: `${out}/05-picker-search.png` });
await p.close();
// 6 Delhi coming soon + success
p = await page(1440, 900, '?city=Delhi');
await p.screenshot({ path: `${out}/06-delhi-coming-soon.png` });
await p.evaluate(() => window.scrollTo(0, 560)); await wait(600);
await p.type('#n', 'Asha'); await p.type('#m', '9900000000');
await p.screenshot({ path: `${out}/07-waitlist-form.png` });
await p.click('form button[class*="btn"]'); await wait(1200);
await p.screenshot({ path: `${out}/08-waitlist-done.png` });
await p.close();
// 9 other city with no art
p = await page(1440, 900, '?city=Pune');
await p.screenshot({ path: `${out}/09-pune-no-art.png` });
await p.close();
// 10 phone
p = await page(390, 844);
await p.screenshot({ path: `${out}/10-phone-hero.png` });
await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 200)); } });
await wait(600); await p.evaluate(() => window.scrollTo(0, 0)); await wait(500);
await p.screenshot({ path: `${out}/11-phone-full.png`, fullPage: true });
await b.close();
console.log('done');
