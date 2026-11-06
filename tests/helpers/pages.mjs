// Shared by the SEO tests: every generated public page (and llms.txt), JSON-LD blocks and visible text.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
export const ROOT = new URL('../..', import.meta.url).pathname;
export const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SKIP = new Set(['node_modules', '.git', 'dist-site', 'dist-admin', 'dist-crm', 'admin', 'crm', 'supabase', 'docs', 'tests', 'scripts', 'brand-src', 'src', 'assets']);
export const publicFiles = () => {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (/ 2(\.|$)/.test(e.name)) continue;
      if (!rel && SKIP.has(e.name)) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(join(dir, e.name), r); else if (e.name.endsWith('.html') || e.name === 'llms.txt') out.push(r);
    }
  };
  walk(ROOT, '');
  return out;
};
export const htmlFiles = () => publicFiles().filter((f) => f.endsWith('.html'));
export const jsonld = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map((m) => JSON.parse(m[1]));
export const flat = (docs) => docs.flatMap((d) => (d && d['@graph'] ? d['@graph'] : [d]));
export const strip = (s) => s.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&rsquo;/g, '’').replace(/\s+/g, ' ');
