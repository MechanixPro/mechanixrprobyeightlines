"""Generates the original bike illustrations and backgrounds in assets/img/. Run: python3 scripts/make_art.py
Flat vector art drawn for Mechanix Pro (no third-party imagery). Replace with real photos when available."""
import os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'assets', 'img')
NAVY, EMBER, INK, STEEL, SKY = '#14295A', '#F2801F', '#0F1F45', '#C9D4EA', '#FFFFFF'

def wheel(cx, cy, r, rim=STEEL, tyre='#0A1530'):
    spokes = ''.join(f'<line x1="{cx}" y1="{cy}" x2="{cx + (r-14) * __import__("math").cos(a):.1f}" y2="{cy + (r-14) * __import__("math").sin(a):.1f}" stroke="{rim}" stroke-width="2.5"/>' for a in [i * 3.14159 / 6 for i in range(12)])
    return (f'<circle cx="{cx}" cy="{cy}" r="{r}" fill="{tyre}" stroke="#5E78B5" stroke-width="2.5"/><circle cx="{cx}" cy="{cy}" r="{r-14}" fill="#fff" opacity=".12"/>'
            f'<circle cx="{cx}" cy="{cy}" r="{r-14}" fill="none" stroke="{rim}" stroke-width="3"/>{spokes}'
            f'<circle cx="{cx}" cy="{cy}" r="8" fill="{rim}"/><circle cx="{cx}" cy="{cy}" r="3.5" fill="{tyre}"/>')

def motorcycle(body='#F2F5FB', tank=EMBER, INK='#2F4A8C'):
    return f'''<g>
{wheel(130, 235, 68)}{wheel(480, 235, 68)}
<path d="M130 235 L262 214 L300 232" fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M480 235 L448 128" stroke="{STEEL}" stroke-width="9" stroke-linecap="round"/>
<path d="M480 235 L452 142" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>
<path d="M262 196 L300 140 L420 150 L445 130 L458 142 L440 200 L380 232 L310 238 Z" fill="{body}"/>
<rect x="268" y="176" width="108" height="62" rx="14" fill="{INK}"/>
<rect x="282" y="190" width="30" height="34" rx="6" fill="{STEEL}" opacity=".85"/><rect x="318" y="190" width="42" height="34" rx="6" fill="{STEEL}" opacity=".5"/>
<path d="M296 138 Q352 82 428 118 L420 152 Q352 168 292 150 Z" fill="{tank}"/>
<path d="M310 124 Q352 102 396 118" fill="none" stroke="#fff" stroke-width="4" opacity=".55" stroke-linecap="round"/>
<path d="M168 150 Q238 120 298 128 L292 156 L172 164 Q150 160 168 150 Z" fill="{INK}"/>
<path d="M150 170 L86 160 L96 186 L160 190 Z" fill="{body}"/>
<rect x="76" y="164" width="14" height="10" rx="3" fill="#E5412D"/>
<path d="M440 118 L476 78 L496 82" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="466" cy="122" r="17" fill="#fff"/><circle cx="470" cy="122" r="10" fill="#FFE9A8"/>
<path d="M300 240 L210 252 Q170 258 152 246 L150 232 L212 234 L296 224 Z" fill="{STEEL}"/>
<path d="M300 240 L210 252 Q170 258 152 246" fill="none" stroke="{INK}" stroke-width="4" opacity=".4"/>
<rect x="455" y="190" width="38" height="14" rx="6" fill="{body}"/>
</g>'''

def scooter(body=EMBER, trim='#F2F5FB', INK='#2F4A8C'):
    return f'''<g>
{wheel(140, 245, 48)}{wheel(468, 245, 48)}
<path d="M140 245 L238 232 L238 150 Q330 130 392 170" fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M468 245 L440 118" stroke="{STEEL}" stroke-width="9" stroke-linecap="round"/>
<path d="M468 245 L444 130" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>
<path d="M120 190 Q130 120 232 128 L240 220 L210 232 L150 232 Q118 226 120 190 Z" fill="{body}"/>
<path d="M240 232 L400 232 Q428 232 436 206 L432 150 Q420 128 400 122 L392 232" fill="{trim}"/>
<path d="M232 232 L392 232 L392 248 L232 248 Z" fill="{INK}"/>
<path d="M140 128 Q200 108 262 122 L252 150 L148 152 Z" fill="{INK}"/>
<path d="M388 122 Q430 96 454 110 Q466 140 448 232 L398 232 Z" fill="{body}"/>
<path d="M434 108 L452 70 L488 66" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
<ellipse cx="458" cy="104" rx="15" ry="19" fill="#fff"/><ellipse cx="462" cy="104" rx="8" ry="12" fill="#FFE9A8"/>
<rect x="108" y="170" width="16" height="12" rx="3" fill="#E5412D"/>
<rect x="258" y="200" width="104" height="14" rx="7" fill="{body}" opacity=".9"/>
</g>'''

def svg(w, h, inner, defs=''):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img">{defs}{inner}</svg>'

def w(name, content):
    open(os.path.join(IMG, name), 'w', encoding='utf-8').write(content)

# hero bike on a road
road = f'<rect x="0" y="318" width="640" height="5" fill="{EMBER}" opacity=".9"/><line x1="0" y1="338" x2="640" y2="338" stroke="#fff" stroke-width="3" stroke-dasharray="26 22" opacity=".5"/>'
w('hero-bike.svg', svg(640, 350, f'<g transform="translate(20 0)">{motorcycle()}</g>{road}'))

# gallery scenes (placeholders until real photos): bike illustration on tinted scene
def scene(name, art, label, c1, c2):
    defs = f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
    inner = (f'<rect width="800" height="600" fill="url(#g)"/>'
             f'<circle cx="650" cy="120" r="70" fill="{EMBER}" opacity=".9"/>'
             f'<path d="M0 430 L120 330 L230 430 Z M160 430 L300 300 L420 430 Z" fill="#fff" opacity=".07"/>'
             f'<rect y="470" width="800" height="130" fill="{INK}" opacity=".55"/><line x1="0" y1="530" x2="800" y2="530" stroke="#fff" stroke-width="4" stroke-dasharray="36 28" opacity=".35"/>'
             f'<g transform="translate(110 150) scale(.95)">{art}</g>'
             f'<text x="28" y="570" font-family="-apple-system,Helvetica,Arial,sans-serif" font-size="22" fill="#C9D4EA">{label}</text>')
    w(name, svg(800, 600, inner, defs))
scene('photo-mechanic.svg', motorcycle(), 'Photo coming soon: service at the doorstep', '#18316B', '#0F1F45')
scene('photo-inspection.svg', motorcycle(body='#FFD9B0', tank='#F2801F'), 'Photo coming soon: inspection with you', '#1D3A7A', '#14295A')
scene('photo-handover.svg', motorcycle(body='#7FD39B', tank=EMBER), 'Photo coming soon: ready to ride', '#14295A', '#0B1733')

# background textures
w('pattern-dots.svg', svg(24, 24, f'<circle cx="2" cy="2" r="1.4" fill="{NAVY}" opacity=".13"/>'))
w('pattern-grid.svg', svg(48, 48, f'<path d="M48 0H0V48" fill="none" stroke="#fff" stroke-width="1" opacity=".07"/>'))
print('art written')
