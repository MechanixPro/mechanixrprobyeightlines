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

# ---------- bike types and parts (original flat art for cards) ----------
def scooter_art(body=EMBER, trim='#F2F5FB', ink='#2F4A8C', bolt=False):
    b = f'''<g>
{wheel(200, 420, 56)}{wheel(590, 420, 50)}
<path d="M200 420 L300 405" stroke="{ink}" stroke-width="12" stroke-linecap="round"/>
<path d="M590 420 L556 205" stroke="{STEEL}" stroke-width="10" stroke-linecap="round"/>
<path d="M205 332 Q215 268 305 260 L405 260 Q438 270 424 335 L402 398 L252 398 Q214 392 205 332 Z" fill="{body}"/>
<path d="M226 262 Q330 232 446 256 L434 288 L232 292 Z" fill="{ink}"/>
<path d="M330 396 L508 396 Q522 396 522 410 L522 418 L330 418 Z" fill="{trim}"/>
<path d="M548 208 Q504 300 498 404 L536 404 Q546 322 590 214 Z" fill="{body}"/>
<path d="M548 208 L560 160 L612 150" fill="none" stroke="{ink}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
<ellipse cx="588" cy="210" rx="17" ry="21" fill="#fff"/><ellipse cx="593" cy="210" rx="9" ry="13" fill="#FFE9A8"/>
<rect x="192" y="288" width="22" height="14" rx="4" fill="#E5412D"/>
<path d="M262 262 Q252 232 232 226" fill="none" stroke="{STEEL}" stroke-width="6" stroke-linecap="round"/>
{('<path d="M360 300 l-26 40 h20 l-12 38 l46 -56 h-24 l16 -22 z" fill="#fff"/>' if bolt else '')}
</g>'''
    return b
def card_scene(name, art, c1='#18316B', c2='#0F1F45', dx=0, dy=0, sc=1.0):
    defs = f'<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="{c1}"/><stop offset="1" stop-color="{c2}"/></linearGradient></defs>'
    inner = (f'<rect width="800" height="600" fill="url(#g)"/><circle cx="640" cy="150" r="86" fill="{EMBER}" opacity=".92"/>'
             f'<path d="M0 470 L130 360 L250 470 Z M170 470 L320 330 L450 470 Z" fill="#fff" opacity=".06"/>'
             f'<rect y="478" width="800" height="122" fill="#0A1530" opacity=".55"/><line x1="0" y1="538" x2="800" y2="538" stroke="#fff" stroke-width="4" stroke-dasharray="36 28" opacity=".3"/>'
             f'<g transform="translate({dx} {dy}) scale({sc})">{art}</g>')
    w(name, svg(800, 600, inner, defs))
def motorcycle_variant(body, tank, fairing=False, cruiser=False):
    m = motorcycle(body=body, tank=tank)
    if fairing: m = m.replace('<g>', f'<g><path d="M432 100 L506 122 L474 176 L440 150 Z" fill="{body}"/>', 1)
    return m
card_scene('type-scooter.svg', scooter_art(), dx=-35, dy=-45, sc=1.1)
card_scene('type-commuter.svg', motorcycle_variant('#F2F5FB', '#5E9BFF'), dx=0, dy=105, sc=1.3)
card_scene('type-sports.svg', motorcycle_variant('#F2F5FB', '#E5412D', fairing=True), dx=0, dy=105, sc=1.3)
card_scene('type-cruiser.svg', motorcycle_variant('#2F4A8C', '#F2801F'), dx=0, dy=105, sc=1.3, c1='#1D3A7A')
card_scene('type-electric.svg', scooter_art(body='#3DDC84', trim='#F2F5FB', bolt=True), dx=-35, dy=-45, sc=1.1, c1='#14295A')

def part_scene(name, art):
    card_scene(name, f'<g transform="translate(0 0)">{art}</g>', c1='#1D3A7A', c2='#0F1F45')
part_scene('part-oilfilter.svg', f'''<rect x="290" y="190" width="220" height="250" rx="26" fill="{EMBER}"/>
<rect x="290" y="190" width="220" height="40" rx="20" fill="#C9650F"/><rect x="270" y="420" width="260" height="30" rx="12" fill="{STEEL}"/>
<rect x="318" y="268" width="164" height="92" rx="10" fill="#fff"/><path d="M400 282 q-22 30 0 52 q22 -22 0 -52z" fill="{NAVY}"/>
<ellipse cx="400" cy="190" rx="110" ry="14" fill="#F5A25C"/>''')
part_scene('part-sparkplug.svg', f'''<rect x="382" y="100" width="36" height="46" rx="8" fill="{STEEL}"/>
<rect x="364" y="140" width="72" height="170" rx="14" fill="#F4EBD8"/>
{''.join(f'<rect x="358" y="{160+i*24}" width="84" height="10" rx="5" fill="#E2D5BA"/>' for i in range(5))}
<path d="M350 310 H450 L462 350 H338 Z" fill="{STEEL}"/>
<rect x="372" y="350" width="56" height="100" fill="#9FB0D2"/>{''.join(f'<line x1="372" y1="{362+i*14}" x2="428" y2="{358+i*14}" stroke="#6E80A6" stroke-width="3"/>' for i in range(6))}
<path d="M400 450 v16 h30 v-12" fill="none" stroke="{EMBER}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>''')
part_scene('part-airfilter.svg', f'''<rect x="250" y="210" width="300" height="220" rx="22" fill="{EMBER}"/>
<rect x="276" y="236" width="248" height="168" rx="12" fill="#F4EBD8"/>
{''.join(f'<path d="M{296+i*24} 244 v152" stroke="#C9B68F" stroke-width="6" stroke-linecap="round"/>' for i in range(10))}
<rect x="250" y="210" width="300" height="22" rx="11" fill="#C9650F"/>''')
part_scene('part-brake.svg', f'''<circle cx="400" cy="320" r="150" fill="{STEEL}"/><circle cx="400" cy="320" r="116" fill="#1D3A7A"/>
{''.join(f'<circle cx="{400+82*__import__("math").cos(i*0.5236):.0f}" cy="{320+82*__import__("math").sin(i*0.5236):.0f}" r="9" fill="{STEEL}" opacity=".9"/>' for i in range(12))}
<circle cx="400" cy="320" r="46" fill="{STEEL}"/><circle cx="400" cy="320" r="16" fill="#1D3A7A"/>
<path d="M505 200 q60 20 66 120 q-6 100 -66 120 l-28 -40 q28 -40 0 -160 z" fill="{EMBER}"/>
<rect x="540" y="296" width="24" height="48" rx="6" fill="#C9650F"/>''')
part_scene('part-tyre.svg', f'''<circle cx="400" cy="320" r="170" fill="#0A1530" stroke="#5E78B5" stroke-width="4"/>
{''.join(f'<rect x="394" y="146" width="12" height="26" rx="4" fill="#2B406F" transform="rotate({i*15} 400 320)"/>' for i in range(24))}
<circle cx="400" cy="320" r="104" fill="none" stroke="{STEEL}" stroke-width="10"/><circle cx="400" cy="320" r="92" fill="#16294F"/>
{''.join(f'<line x1="400" y1="320" x2="{400+92*__import__("math").cos(i*0.7854):.0f}" y2="{320+92*__import__("math").sin(i*0.7854):.0f}" stroke="{STEEL}" stroke-width="7"/>' for i in range(8))}
<circle cx="400" cy="320" r="22" fill="{EMBER}"/>''')

# background textures
w('pattern-dots.svg', svg(24, 24, f'<circle cx="2" cy="2" r="1.4" fill="{NAVY}" opacity=".13"/>'))
w('pattern-grid.svg', svg(48, 48, f'<path d="M48 0H0V48" fill="none" stroke="#fff" stroke-width="1" opacity=".07"/>'))
print('art written')
