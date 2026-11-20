import puppeteer from 'puppeteer-core';
import fs from 'fs';
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const url = 'file://' + process.cwd() + '/dist/index.html';
const out = 'shots-flow'; fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox'] });
async function run(w, h, tag, record) {
  const p = await b.newPage(); await p.setViewport({ width: w, height: h });
  let rec; if (record) rec = await p.screencast({ path: 'flow-raw.mp4' });
  await p.goto(url + '?step=0'); await wait(1200);
  await p.screenshot({ path: `${out}/${tag}-1-vehicle.png` });
  await p.click('.tile2:nth-child(3)'); await wait(300); // TVS? brand tiles
  await p.click('.tiles.m .tile2:nth-child(3)'); await wait(500);
  await p.screenshot({ path: `${out}/${tag}-1b-vehicle-picked.png` });
  await p.click('.sum2 .btn.o'); await wait(700);
  await p.click('.svc3:nth-child(2)'); await wait(500);
  await p.click('.add:nth-child(1)'); await wait(500);
  await p.screenshot({ path: `${out}/${tag}-2-service.png` });
  await p.click('.sum2 .btn.o'); await wait(700);
  await p.click('.day:nth-child(2)'); await p.click('.slot2:nth-child(3)'); await wait(300);
  await p.type('#nm', 'Asha'); await p.type('#mb', '9900000000'); await p.type('#ad', '12, 4th Cross, HSR Layout'); await p.type('#pn', '560102'); await wait(500);
  await p.screenshot({ path: `${out}/${tag}-3-slot.png` });
  await p.click('.sum2 .btn.o'); await wait(700);
  await p.screenshot({ path: `${out}/${tag}-4-pay.png` });
  await p.click('.sum2 .btn.o'); await wait(500);
  await p.screenshot({ path: `${out}/${tag}-4b-paying.png` });
  await wait(1800);
  await p.screenshot({ path: `${out}/${tag}-5-done.png` });
  if (rec) await rec.stop();
  await p.close();
}
await run(1440, 900, 'd', true);
await run(390, 844, 'm', false);
await b.close(); console.log('flow done');
