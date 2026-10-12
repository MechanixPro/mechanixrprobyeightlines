"""Adds a version to every style and script reference in the built site, so a new deploy is never shown with an old stylesheet or script.
Cloudflare keeps style and script files in visitors' browsers for 4 hours; a changed ?v=<hash> makes the browser fetch the new file at once.
Run on the finished site folder:  python3 scripts/cachebust.py dist-site   (build_site.sh does this)."""
import hashlib, os, re, sys

def main(root):
    root = os.path.abspath(root); ver = {}
    def version(path):
        if path not in ver:
            full = os.path.join(root, path.lstrip('/'))
            ver[path] = hashlib.sha256(open(full, 'rb').read()).hexdigest()[:8] if os.path.isfile(full) else None
        return ver[path]
    pat = re.compile(r'''((?:href|src)=["'])(/assets/(?:css|js)/[A-Za-z0-9_.\-]+\.(?:css|js))(?:\?v=[0-9A-Za-z]*)?(["'])''')
    def rep(m):
        v = version(m.group(2))
        return m.group(0) if not v else f'{m.group(1)}{m.group(2)}?v={v}{m.group(3)}'
    n = 0
    for base, _, files in os.walk(root):
        for f in files:
            if not f.endswith('.html'): continue
            p = os.path.join(base, f); s = open(p, encoding='utf-8').read(); t = pat.sub(rep, s)
            if t != s: open(p, 'w', encoding='utf-8').write(t); n += 1
    print(f'cachebust: versioned the asset links in {n} pages')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'dist-site')
