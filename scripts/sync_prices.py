"""Pulls the live prices, fees and "what is included" lists from Supabase (public read) into src/site.json and the first-paint
defaults in assets/js/app.js, so the next build matches whatever the owner set in the admin Prices tab.
Run: python3 scripts/sync_prices.py     (build_site.sh runs it before every build; it does nothing if offline)"""
import json, os, re, sys, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'src', 'site.json'); APP = os.path.join(ROOT, 'assets', 'js', 'app.js')
q = lambda s: json.dumps(s, ensure_ascii=False).replace('"', "'")
DESC = {'basic': 'Oil level check, chain lube, brake adjust, wash', 'general': 'Engine oil change, filter clean, 20-point check', 'full': 'General service plus throttle body clean, brake pads check, polish', 'repair': 'Checkup and quote visit; repair quoted before work starts', 'sos': 'Puncture, battery or breakdown; mechanic dispatched now'}
ADDON_NAMES = {'wash': 'Foam wash', 'chain': 'Chain clean and lube', 'brake': 'Brake tuning', 'tyre': 'Tyre and puncture check', 'battery': 'Battery health test'}

def write_defaults(site):
    rows = [f"    {{ id: '{k}', kind: 'service', name: {q(v['name'])}, price: {v['price']}, description: {q(DESC.get(k, ''))}, includes: [{', '.join(q(x) for x in v['includes'])}] }}" for k, v in site['services'].items()]
    rows += [f"    {{ id: '{k}', kind: 'addon', name: {q(ADDON_NAMES.get(k, k))}, price: {n} }}" for k, n in site['addons'].items()]
    rows += [f"    {{ id: 'advance', kind: 'fee', name: 'Checkup and quote fee', price: {site['advance']} }}", f"    {{ id: 'bigbike', kind: 'fee', name: 'Above-180cc surcharge', price: {site['bigBike']} }}"]
    s = open(APP, encoding='utf-8').read()
    s = re.sub(r"  var DEFAULT_ITEMS = \[.*?\n  \];\n", lambda m: "  var DEFAULT_ITEMS = [\n" + ",\n".join(rows) + "\n  ];\n", s, count=1, flags=re.S)
    open(APP, 'w', encoding='utf-8').write(s)

def main():
    cfg = open(os.path.join(ROOT, 'assets', 'js', 'config.js'), encoding='utf-8').read()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", cfg); key = re.search(r"supabaseAnonKey:\s*'([^']+)'", cfg)
    if not (url and key): print('sync_prices: Supabase is not configured, keeping src/site.json'); return 0
    try:
        req = urllib.request.Request(url.group(1).rstrip('/') + '/rest/v1/services?select=id,kind,price,includes&active=eq.true', headers={'apikey': key.group(1), 'Authorization': 'Bearer ' + key.group(1)})
        rows = json.load(urllib.request.urlopen(req, timeout=15))
    except Exception as e:
        print('sync_prices: could not reach Supabase (' + str(e)[:60] + '), keeping src/site.json'); return 0
    site = json.load(open(SITE, encoding='utf-8')); changed = []
    for r in rows:
        if r['kind'] == 'service' and r['id'] in site['services']:
            t = site['services'][r['id']]
            if t['price'] != r['price']: changed.append(f"{r['id']} {t['price']} -> {r['price']}"); t['price'] = r['price']
            if isinstance(r.get('includes'), list) and r['includes'] and r['includes'] != t['includes']: changed.append(f"{r['id']} includes"); t['includes'] = r['includes']
        elif r['kind'] == 'addon' and r['id'] in site['addons'] and site['addons'][r['id']] != r['price']:
            changed.append(f"{r['id']} {site['addons'][r['id']]} -> {r['price']}"); site['addons'][r['id']] = r['price']
        elif r['kind'] == 'fee':
            k = 'advance' if r['id'] == 'advance' else 'bigBike' if r['id'] == 'bigbike' else None
            if k and site[k] != r['price']: changed.append(f"{r['id']} {site[k]} -> {r['price']}"); site[k] = r['price']
    json.dump(site, open(SITE, 'w', encoding='utf-8'), indent=2, ensure_ascii=False); open(SITE, 'a').write('\n')
    write_defaults(site)
    print('sync_prices:', ('updated ' + ', '.join(changed)) if changed else 'already up to date')
    return 0
if __name__ == '__main__': sys.exit(main())
