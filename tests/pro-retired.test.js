// The old "Pro" helper is retired: Mechu is the only mascot. Nothing may load or style the old helper.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const pages = (d = ROOT) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', '.git', 'dist-site', 'dist-admin', 'dist-crm', 'supabase'].includes(e.name) ? [] : e.isDirectory() ? pages(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []));

test('the old Pro and sphere helper files are gone', () => {
  for (const f of ['assets/js/pro.js', 'assets/js/pro-script.js', 'assets/js/sphere.js', 'assets/data/sphere.json']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
});
test('no page, script or the generator loads pro.js, pro-script.js or sphere.js', () => {
  assert.doesNotMatch(read('scripts/build_pages.py'), /js\/(pro|pro-script|sphere)\.js/);
  for (const f of pages().filter((p) => !/ 2/.test(p))) assert.doesNotMatch(fs.readFileSync(f, 'utf8'), /js\/(pro|pro-script|sphere)\.js/, f);
});
test('no CSS is left for the old helper, and the config has no helperStyle switch', () => {
  const c = read('assets/css/style.css');
  assert.doesNotMatch(c, /\.pro-(launch|svg|card|chip|say|bob)|\.pro\.open|\.sphere-host|#pro\b/);
  assert.doesNotMatch(read('assets/js/config.js'), /helperStyle/);
});
test('Mechu is the mascot on the home page and the booking form still announces its state', () => {
  assert.match(read('index.html'), /assets\/js\/mechu\.js/);
  assert.match(read('assets/js/app.js'), /mxp:state/);
});
