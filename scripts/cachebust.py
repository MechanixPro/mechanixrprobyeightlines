"""Adds a version to every style, script, picture and video reference in the built site, so a new deploy is never shown with an old stylesheet or script.
Cloudflare keeps style, script, picture and video files in visitors' browsers for 4 hours (a new picture saved under an old file name would otherwise look unchanged for hours); a changed ?v=<hash> makes the browser fetch the new file at once.
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
    # Pictures and videos: any site-relative /assets/img/... or /assets/video/... file in an attribute (src, srcset, data-src, poster). Absolute URLs (og:image) are left alone.
    media = re.compile(r'''(?<=["'\s,=(])(/assets/(?:img|video)/[A-Za-z0-9_./\-]+\.(?:webp|png|jpg|jpeg|svg|mp4))(?:\?v=[0-9A-Za-z]*)?(?=[\s"',)])''')
    def rep_media(m):
        v = version(m.group(1))
        return m.group(0) if not v else f'{m.group(1)}?v={v}'
    def rep(m):
        v = version(m.group(2))
        return m.group(0) if not v else f'{m.group(1)}{m.group(2)}?v={v}{m.group(3)}'
    n = 0
    for base, _, files in os.walk(root):
        for f in files:
            if not f.endswith('.html'): continue
            p = os.path.join(base, f); s = open(p, encoding='utf-8').read(); t = media.sub(rep_media, pat.sub(rep, s))
            if t != s: open(p, 'w', encoding='utf-8').write(t); n += 1
    print(f'cachebust: versioned the asset links in {n} pages')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'dist-site')
