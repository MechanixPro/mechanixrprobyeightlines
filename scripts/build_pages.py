"""Generates area landing pages, legal pages and sitemap.xml.
Run:  python3 scripts/build_pages.py   (from the repo root). Edit AREAS / legal text below, then re-run."""
import html, json, os, re, datetime, urllib.parse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = 'https://mechanixpro.in'
TODAY = datetime.date.today().isoformat()

NAV = '''<a class="skip" href="#main">Skip to content</a>
<header class="nav"><div class="wrap">
  <a class="brand" href="/" aria-label="Mechanix Pro home"><img src="/assets/img/logo.svg" alt="" width="26" height="27"><img class="wm" src="/assets/img/logo-wordmark.webp" alt="" width="137" height="12"></a>
  <nav class="links" aria-label="Main"><a href="/services/">Services and prices</a><a href="/help/">How it works</a><a href="/help/#areas">Areas</a><a href="/help/#faq">FAQ</a></nav>
  <details class="menu"><summary aria-label="Menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></summary>
    <div class="menu-panel"><a href="/services/">Services and prices</a><a href="/help/">How it works</a><a href="/roadside/">Roadside help</a><a href="/coming-soon/">Coming soon</a><a href="/fleet/">Fleets and delivery riders</a><a href="/societies/">Apartments and offices</a><a href="/help/#areas">Areas</a><a href="/help/#faq">FAQ</a><a href="/track/">Track your booking</a><a href="/contact/">Contact</a><a href="#" data-call>Call us</a></div></details>
  <a class="btn btn-ghost btn-sm call-btn" href="#" data-call><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>Call us</a>
  <a class="btn btn-primary btn-sm cta" href="/book/">Get a quote</a>
</div></header>
'''
FOOTER = '''<footer>
  <div class="wrap cols">
    <div>
      <a class="brand" href="/" aria-label="Mechanix Pro home" style="margin-bottom:8px"><img src="/assets/img/logo.svg" alt="" width="22" height="23"><img class="wm" src="/assets/img/logo-wordmark.webp" alt="" width="125" height="11"></a>
      <p>Your roadside first responders. Doorstep bike service and breakdown help in Bengaluru.</p>
      <p><span data-phone>+91 XXXXX XXXXX</span> · <a href="mailto:hello@mechanixpro.in" style="display:inline">hello@mechanixpro.in</a></p>
    </div>
    <div><b>Areas</b>{area_links}<a href="/areas/">All Bengaluru PIN codes</a></div>
    <div><b>Company</b><a href="/services/">Services and prices</a><a href="/help/">How it works</a><a href="/roadside/">Roadside help</a><a href="/fleet/">Fleets and delivery riders</a><a href="/societies/">Apartments and offices</a><a href="/track/">Track your booking</a><a href="https://www.instagram.com/themechanixpro/" rel="me noopener" target="_blank">Instagram</a><a href="/contact/">Contact</a><a href="/terms/">Terms</a><a href="/privacy/">Privacy</a><a href="/refund-policy/">Refund policy</a><a href="/terms/#credits">Credits</a></div>
  </div>
  <div class="wrap"><p class="tiny" style="margin-top:20px">© 2026 Mechanix Pro. All rights reserved.</p><p class="tiny">Mechanix Pro is a brand of {company_name}, {company_addr}. GSTIN {company_gstin}</p><p class="tiny">Brand and model names belong to their owners and are used only to show which bikes we service. Mechanix Pro is an independent service and is not affiliated with or endorsed by them.</p></div>
</footer>
'''
HEAD = '''<!doctype html>
<html lang="en-IN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="canonical" href="{url}">
<meta name="theme-color" content="#14295A">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}"><meta property="og:url" content="{url}"><meta property="og:image" content="{site}/assets/img/og.png"><meta property="og:type" content="website"><meta property="og:site_name" content="Mechanix Pro"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32"><link rel="icon" href="/assets/img/logo.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">
<link rel="stylesheet" href="/assets/css/style.css">
{schema}
<script src="/assets/js/loader.js"></script>
<script src="/assets/js/config.js" defer></script>
<script src="/assets/js/tags.js" defer></script>
{scripts}
</head>
<body class="{body}">
<div class="loader" aria-hidden="true"><div class="ld-stage"><div class="ld-mark"><img src="/assets/img/logo-mark.webp" alt="" width="124" height="129"><u class="ld-shine"></u></div><img class="ld-word" src="/assets/img/logo-wordmark.webp" alt="" width="260" height="23"><img class="ld-tag" src="/assets/img/logo-tagline.webp" alt="" width="260" height="15"></div><i class="ld-road"></i></div>
{nav}<main id="main" class="{main}">
'''
FOOT = '''</main>
{footer}{extra}<script src="/assets/js/pincodes.js" defer></script><script src="/assets/js/pins-live.js" defer></script><script src="/assets/js/pingeo.js" defer></script><script src="/assets/js/pinmap.js" defer></script><script src="/assets/js/pincheck.js" defer></script><script src="/assets/js/waitlist.js" defer></script><script src="/assets/js/reveal.js" defer></script><script src="/assets/js/media.js" defer></script><script src="/assets/js/pro-script.js" defer></script><script src="/assets/js/pro.js" defer></script></body>
</html>
'''
LEGAL_JS = '<script src="/assets/js/page.js" defer></script>'
APP_JS = '<script src="/assets/js/pincodes.js" defer></script>\n<script src="/assets/js/pingeo.js" defer></script>\n<script src="/assets/js/pins-live.js" defer></script>\n<script src="/assets/js/bikes.js" defer></script>\n<script src="/assets/js/model-photos.js" defer></script>\n<script src="/assets/js/logic.js" defer></script>\n<script src="/assets/js/gmaps.js" defer></script>\n<script src="/assets/js/app.js" defer></script>'
FLOAT = '''<a class="wa-fab" href="#" data-wa="general" aria-label="Chat on WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8.5 8.5 0 0 1-12.6 7.4L3 21l1.6-5.2A8.5 8.5 0 1 1 21 12z"/></svg>WhatsApp us</a>
<div class="mbar" id="mbar"><a class="btn btn-ghost" href="#" data-call aria-label="Call us"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/></svg>Call</a><a class="btn btn-wa" href="#" data-wa="general">WhatsApp</a><a class="btn btn-primary" href="/book/">Get a quote</a></div>
'''

AREAS = [
  ('hsr-layout', 'HSR Layout', '560102', 'Sectors 1 to 7, Agara, Parangi Palya and Somasundarapalya', 'Short hops to Koramangala and the Outer Ring Road add up: stop-start traffic wears brakes, clutch plates and chains faster than highway riding.'),
  ('koramangala', 'Koramangala', '560034, 560095, 560047', 'all 8 blocks, Ejipura and Viveknagar', 'Dense traffic around Sony World, Forum and the 80 Feet Road means a lot of idling, which is hard on engine oil and air filters.'),
  ('btm-layout', 'BTM Layout', '560076, 560029', 'BTM 1st and 2nd Stage, Madiwala and N.S. Palya', 'Daily commutes through Silk Board junction mean long idle times and heavy brake use — exactly what a regular service protects.'),
  ('bellandur', 'Bellandur', '560103', 'Kadubeesanahalli, Green Glen Layout, Devarabisanahalli and the ORR tech parks', 'Office commutes on the Outer Ring Road and Sarjapur Road are tough on chains, tyres and brakes; we can service your bike while you work.'),
  ('electronic-city', 'Electronic City', '560100', 'Phase 1 and Phase 2, Neeladri Nagar, Hosa Road and Konappana Agrahara', 'Long rides on Hosur Road and the elevated expressway mean more kilometres per month, so oil and chain care matter more.'),
  ('marathahalli', 'Marathahalli', '560037', 'Munnekollal, Kundalahalli, AECS Layout and Doddanekundi', 'Heavy traffic on the ORR and Varthur Road means frequent braking and overheating risk in summer.'),
]
PRICES = [(k, v['name']) for k, v in json.load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'src', 'site.json'), encoding='utf-8'))['services'].items()]

AREA_LINKS = ''.join(f'<a href="/bike-service-{slug}/">{name}</a>' for slug, name, *_ in AREAS)
def foot(extra=''):
    return FOOT.format(footer=FOOTER.format(area_links=AREA_LINKS, company_name=COMPANY['legalName'], company_addr=', '.join(COMPANY['addressLines']) + f", {COMPANY['city']} {COMPANY['pincode']}", company_gstin=COMPANY['gstin']), extra=extra)

COMPANY = json.load(open(os.path.join(ROOT, 'src', 'company.json'), encoding='utf-8'))
_ADDR = ', '.join(COMPANY['addressLines']) + f", {COMPANY['city']}, {COMPANY['state']} {COMPANY['pincode']}"
_UPDATED = datetime.date.fromisoformat(COMPANY['updated']).strftime('%-d %B %Y')
def company_fill(s):
    """Replaces the fill-in-the-blank placeholders in the legal text with the company record in src/company.json."""
    return (s.replace('[Name], [Registered business name], [address]', f"Grievance Officer, {COMPANY['legalName']}, {_ADDR}")
             .replace('[Registered business name], [registered address], Bengaluru, Karnataka', f"{COMPANY['legalName']}, {_ADDR}")
             .replace('[Registered business name]', COMPANY['legalName']).replace('[registered address]', _ADDR)
             .replace('[GSTIN]', COMPANY['gstin']).replace('[date]', _UPDATED))

SITE_DATA = json.load(open(os.path.join(ROOT, 'src', 'site.json'), encoding='utf-8'))
def _inr(n): return 'Free' if n == 0 else '₹' + format(int(n), ',')
def _price(key):
    d = SITE_DATA['services'].get(key)
    return d['price'] if d else SITE_DATA['addons'][key]
def tok(s):
    """Fills {{price:id}} (a span the browser can refresh), {{text:id}}, {{fee:advance|bigbike}}, {{feetext:..}}, {{days}} and {{includes_li:id}} from src/site.json."""
    def rep(m):
        kind, key = m.group(1), m.group(2)
        if kind == 'price': return f'<span data-price="{key}">{_inr(_price(key))}</span>'
        if kind == 'text': return _inr(_price(key))
        fee = SITE_DATA['advance'] if key == 'advance' else SITE_DATA['bigBike']
        if kind == 'fee': return f'<span data-fee="{key}">{_inr(fee)}</span>'
        if kind == 'feetext': return _inr(fee)
        if kind == 'includes_li': return ''.join(f'<li>{html.escape(x)}</li>' for x in SITE_DATA['services'][key]['includes'])
        return m.group(0)
    s = re.sub(r'\{\{(price|text|fee|feetext|includes_li):([a-z0-9]+)\}\}', rep, s)
    return s.replace('{{days}}', str(SITE_DATA['warrantyDays']))
def write(path, content):
    full = os.path.join(ROOT, path); os.makedirs(os.path.dirname(full), exist_ok=True)
    open(full, 'w', encoding='utf-8').write(tok(content) if path.endswith('.html') else content)

_pc = json.load(open(os.path.join(ROOT, 'src', 'model-photos.json'), encoding='utf-8'))
POPULAR = ''.join(f'<a href="/bike-service/{k}/">{html.escape(_pc[k]["brand"] + " " + _pc[k]["model"])}</a>' for k in ['honda-activa-6g', 'honda-dio', 'tvs-jupiter', 'hero-splendor-plus', 'bajaj-pulsar-ns160', 'royal-enfield-classic-350', 'ola-electric-s1-pro'] if k in _pc)
urls = [('/', '1.0')]
for slug, name, pins, locs, why in AREAS:
    url = f'{SITE}/bike-service-{slug}/'
    title = f'Doorstep Bike Service in {name}, Bengaluru | Mechanix Pro'
    desc = f'Bike and scooter service at your home or office in {name} ({pins}). Prices from {{text:basic}}, Mechanix Pro-certified mechanics, OEM-certified parts, {{days}}-day service warranty. Get a quote on WhatsApp.'
    book = f'/book/?area={html.escape(name)}'
    faq = [
      (f'Do you come to my home in {name}?', f'Yes. Our mechanics cover {locs}. We service your bike at home, at your office parking or at the roadside.'),
      (f'How much is a bike service in {name}?', 'Basic service from {{text:basic}}, General from {{text:general}}, Full from {{text:full}} for bikes up to 180cc; above 180cc add {{feetext:bigbike}}. GST included. Your exact quote comes on WhatsApp, and parts only after your approval.'),
      ('How fast can a mechanic reach me?', 'Scheduled services are done in your chosen slot. For breakdowns, use the Get help button and we send the nearest available mechanic.'),
    ]
    schema = '<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "AutoRepair", "name": f"Mechanix Pro — {name}", "url": url,
      "image": f"{SITE}/assets/img/og.png", "telephone": "+91-9743031301", "priceRange": "{{text:repair}}–{{text:full}}",
      "areaServed": {"@type": "Place", "name": f"{name}, Bengaluru"},
      "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"}}, ensure_ascii=False) + '</script>\n<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in faq]}, ensure_ascii=False) + '</script>'
    body = f'''<p class="breadcrumb"><a href="/">Home</a> › Bike service in {name}</p>
<h1 style="font-size:clamp(34px,6vw,52px)">Doorstep bike service in {name}.</h1>
<p class="muted" style="font-size:20px">Mechanix Pro-certified mechanics at your home or office across {locs}, with OEM-certified parts. Get a quote on WhatsApp, and nothing starts without your OK.</p>
<p><a class="btn btn-primary" href="{book}">Build your service</a> <a class="btn btn-wa" href="#" data-wa="{html.escape(name)}">Get a quote on WhatsApp</a></p>
<h2>Why riders in {name} service at home</h2>
<p>{why} Instead of losing half a day at a garage, a Mechanix Pro mechanic services your bike where it is parked, usually in 60 to 90 minutes.</p>
<h2>Starting prices in {name}</h2>
<div class="card">{''.join(f'<div class="price-row"><span>{n}</span><b>{{{{price:{k}}}}}</b></div>' for k, n in PRICES)}</div>
<p class="tiny muted" style="margin-top:8px">Bikes and scooters up to 180cc; above 180cc add {{fee:bigbike}} to service packages. GST included. Pincodes: {pins}.</p>
<h2>Popular bikes we service in {name}</h2>
<p class="areas">{POPULAR}</p>
<h2>How it works</h2>
<ol><li>Build your service on the website and send it on WhatsApp.</li><li>Our expert checks what is needed, confirms if it can be done at home, and sends your quote.</li><li>You approve, we lock your slot ({{fee:advance}} checkup and quote fee, adjusted in your bill if you go ahead), and the mechanic arrives.</li></ol>
<h2>Questions from {name} riders</h2>
{''.join(f'<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>' for q, a in faq)}
<div class="final" style="margin-top:32px"><h2>Book a service in {name}.</h2><p>Takes under a minute.</p><a class="btn btn-primary" href="{book}">Build your service</a></div>
'''
    write(f'bike-service-{slug}/index.html', HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema=schema, scripts=LEGAL_JS, body='', nav=NAV, main='page') + body + foot())
    urls.append((f'/bike-service-{slug}/', '0.8'))

LEGAL = {
 'privacy': ('Privacy Policy', 'How Mechanix Pro collects, uses and protects your personal data.', '''
<p class="muted">Last updated: [date]. This policy follows India's Digital Personal Data Protection Act, 2023.</p>
<h2>Who we are</h2><p>Mechanix Pro is operated by [Registered business name], [registered address], Bengaluru, Karnataka ("we", "us").</p>
<h2>What we collect</h2><ul><li>Name and mobile number; email if you give it.</li><li>Website analytics and advertising tags (Google and Meta) record which pages and ads brought you here and whether you sent a request. They do not receive your name, number or email.</li><li>Your location (a map pin and nearest area) only if you tap "Use my current location". You can remove it before sending.</li><li>Service details: area or address, bike brand, model, nickname and registration number, the service you choose, photos taken during inspection.</li><li>WhatsApp messages you send us about your booking.</li><li>Payment status from Razorpay. We never see or store your card or UPI PIN.</li><li>Basic technical data (device, browser, approximate location from IP) for security and to prevent misuse.</li></ul>
<h2>Why we use it</h2><p>To confirm and deliver your service, send booking updates and reminders on WhatsApp (only if you agree), process payments, give warranty support, prevent fraud and meet tax law. With your consent we may send offers; you can stop them anytime by replying STOP.</p>
<h2>Automated replies</h2><p>Some WhatsApp replies are written by an AI assistant trained on our services and prices. A team member reviews conversations and you can ask for a person at any time.</p>
<h2>Who we share it with</h2><p>Only as needed: the mechanic assigned to your job; service providers who process data for us — Supabase (database), Cloudflare (hosting and security), Meta (WhatsApp), Razorpay (payments), Anthropic (AI replies), Google (analytics, if enabled); and authorities where the law requires. We do not sell your data.</p>
<h2>How long we keep it</h2><p>Booking records and invoices for 8 years (tax law). Leads that do not become bookings are deleted or anonymised after 12 months. Chat logs for up to 24 months.</p>
<h2>Security</h2><p>Encrypted connections, access limited by role, bot and attack protection by Cloudflare, and audit logs of staff actions.</p>
<h2>Your rights</h2><p>You can ask to access, correct or delete your data, withdraw consent, or raise a complaint by writing to our Grievance Officer below. We respond within the time set by law.</p>
<h2>Grievance Officer</h2><p>[Name], [Registered business name], [address]. Email: hello@mechanixpro.in</p>'''),
 'terms': ('Terms & Conditions', 'Terms for booking and using Mechanix Pro doorstep bike services.', '''
<p class="muted">Last updated: [date]. Draft — to be reviewed by a lawyer before launch.</p>
<h2>1. Service</h2><p>Mechanix Pro, operated by [Registered business name] (GSTIN [GSTIN]), provides two-wheeler service and repair at your location in our service areas in Bengaluru, through trained mechanics from our partner workshops.</p>
<h2>2. Booking</h2><p>You can request a booking on our website or WhatsApp. A booking is confirmed when we confirm your slot and you pay the checkup and quote fee (currently {{fee:advance}}). The fee is adjusted in your final bill if you go ahead with the service.</p>
<h2>3. Prices and extra work</h2><p>Listed prices include GST and cover the labour and items described for each package. Parts used are OEM-certified. Parts, oil above standard grade and work outside the package are charged only after you approve an itemised estimate.</p>
<h2>4. Payment</h2><p>The checkup and quote fee and final payments are made through Razorpay (UPI, cards, wallets, net banking) or as agreed with us. Invoices show GST separately.</p>
<h2>5. Cancellation</h2><p>See our <a href="/refund-policy/">Refund & Cancellation Policy</a>.</p>
<h2>6. Vehicle handover</h2><p>If your bike must go to a workshop, it leaves only after you share a one-time code with the mechanic, and returns the same way. Please remove valuables. Keep your registration and insurance documents valid.</p>
<h2>7. Warranty</h2><p>Our service work is covered for {{days}} days from the service date. Parts also carry the manufacturer's warranty. Accidents, misuse and work by others after our service are not covered.</p>
<h2>8. Your responsibilities</h2><p>Give accurate details, provide safe access to the vehicle, and be reachable during your slot. Abuse towards our staff may lead to cancellation.</p>
<h2>9. Liability</h2><p>We are liable for loss or damage caused by our negligence during service, up to the invoice value of that booking, except where the law does not allow such a limit. We are not liable for pre-existing defects or normal wear.</p>
<h2>10. Law</h2><p>These terms are governed by Indian law. Courts in Bengaluru, Karnataka have jurisdiction.</p>
<h2>11. Contact</h2><p>hello@mechanixpro.in · <span data-phone>+91 XXXXX XXXXX</span></p>'''),
 'refund-policy': ('Refund & Cancellation Policy', 'How cancellations and refunds work for Mechanix Pro bookings.', '''
<p class="muted">Last updated: [date].</p>
<h2>Cancelling a booking</h2><ul><li><b>More than 2 hours before your slot:</b> free. Your {{fee:advance}} checkup and quote fee is refunded in full.</li><li><b>Less than 2 hours before, or after the mechanic has left:</b> the {{fee:advance}} checkup and quote fee covers the visit and is not refunded.</li><li><b>Emergency (SOS) visits:</b> cancellable free until a mechanic is assigned.</li></ul>
<h2>If we cancel</h2><p>If we cannot reach you in your slot, we offer another slot or a full refund — your choice.</p>
<h2>Service issues</h2><p>If something we fixed fails within {{days}} days, we redo that work free. If we cannot fix it, we refund the charge for that item.</p>
<h2>How refunds are paid</h2><p>Refunds go to your original payment method through Razorpay within 5–7 working days of approval.</p>
<h2>Contact</h2><p>Write to hello@mechanixpro.in or message us on WhatsApp with your booking reference.</p>'''),
 'contact': ('Contact Mechanix Pro', 'Reach Mechanix Pro for bookings, support and partnerships in Bengaluru.', '''
<p class="muted" style="font-size:20px">Fastest: message us on WhatsApp. We reply from 8 AM to 9 PM, every day.</p>
<p><a class="btn btn-wa" href="#" data-wa="Contact">Chat on WhatsApp</a></p>
<div class="card" style="margin-top:20px"><div class="price-row"><span>Phone</span><b data-phone>+91 XXXXX XXXXX</b></div><div class="price-row"><span>Email</span><b>hello@mechanixpro.in</b></div><div class="price-row"><span>Areas</span><b>All of Bengaluru (560001 to 560110)</b></div></div>
<!--FINDUS-->
<h2>Garage partners</h2><p>Run a two-wheeler workshop in Bengaluru and want more jobs? Email us with your garage name, area and number of mechanics.</p>
<p class="tiny muted">[Registered business name], [registered address], Bengaluru, Karnataka. GSTIN [GSTIN].</p>'''),
}
def brand_chips():
    src = open(os.path.join(ROOT, 'assets', 'js', 'bikes.js'), encoding='utf-8').read()
    names = [n for n in re.findall(r"^  '([^']+)': \[", src, flags=re.M) if n != 'Other']
    return ''.join(f'<a href="/book/?brand={urllib.parse.quote(n, safe="")}">{html.escape(n)}</a>' for n in names)

def credits_html():
    rows = []
    mp = os.path.join(ROOT, 'src', 'model-photos.json')
    if os.path.exists(mp):
        for c in json.load(open(mp, encoding='utf-8')).values():
            rows.append(f'<li>{html.escape(c["brand"])} {html.escape(c["model"])}: "{html.escape(c["title"])}" by {html.escape(c["author"])}, <a href="{html.escape(c["license_url"])}" rel="noopener">{html.escape(c["license"])}</a>, <a href="{html.escape(c["source"])}" rel="noopener">source on Wikimedia Commons</a></li>')
    pp = os.path.join(ROOT, 'src', 'part-photos.json')
    if os.path.exists(pp):
        for c in json.load(open(pp, encoding='utf-8')).values():
            rows.append(f'<li>{html.escape(c["caption"])}: "{html.escape(c["title"])}" by {html.escape(c["author"])}, <a href="{html.escape(c["license_url"])}" rel="noopener">{html.escape(c["license"])}</a>, <a href="{html.escape(c["source"])}" rel="noopener">source on Wikimedia Commons</a></li>')
    return ('<h2 id="credits">Photo and image credits</h2><p>Bike and part photos come from the Wikimedia Commons community and are used under their free licences, listed below. They show example bikes, not our customers. Brand and model names belong to their owners.</p><p>PIN code locations on the booking form: map data &copy; <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL); PIN codes and area names: India Post directory. Illustration on the How it works page: <a href="http://www.freepik.com" rel="noopener">Designed by macrovector / Freepik</a>. Oil change photo on the Services page: <a href="https://www.vecteezy.com" rel="noopener">Vecteezy</a>.</p><ul>' + ''.join(rows) + '</ul>')

LEGAL = {k: (t, d, company_fill(body)) for k, (t, d, body) in LEGAL.items()}
LEGAL['terms'] = (LEGAL['terms'][0], LEGAL['terms'][1], LEGAL['terms'][2] + credits_html())
def findus_html():
    addr = ', '.join(COMPANY['addressLines']) + f", {COMPANY['city']}, {COMPANY['state']} {COMPANY['pincode']}"
    q = urllib.parse.quote(addr, safe='')
    return (f'<section id="findus"><h2>Find us.</h2><p>{html.escape(addr)}</p>'
            f'<div class="gmap" data-gmap-embed data-q="{html.escape(addr)}" data-title="Map of the Mechanix Pro office"></div>'
            f'<p><a class="btn btn-ghost" href="https://www.google.com/maps/search/?api=1&amp;query={q}" target="_blank" rel="noopener">Get directions in Google Maps</a></p></section>')
for slug, (title, desc, body) in LEGAL.items():
    url = f'{SITE}/{slug}/'
    write(f'{slug}/index.html', HEAD.format(title=html.escape(title + ' | Mechanix Pro'), desc=html.escape(desc), url=url, site=SITE, schema='', scripts=LEGAL_JS + ('<script src="/assets/js/gmaps.js" defer></script>' if slug == 'contact' else ''), body='', nav=NAV, main='page') + f'<h1 style="font-size:40px">{title}</h1>\n' + body.replace('<!--FINDUS-->', findus_html()) + foot())
    urls.append((f'/{slug}/', '0.3'))

# Unsubscribe page: linked from marketing emails, kept out of search results and the sitemap.
_ub = HEAD.format(title='Unsubscribe from offer emails | Mechanix Pro', desc='Stop offer emails from Mechanix Pro.', url=f'{SITE}/unsubscribe/', site=SITE, schema='', scripts='<script src="/assets/js/unsub.js" defer></script>', body='', nav=NAV, main='page')
_ub = _ub.replace('</title>', '</title><meta name="robots" content="noindex,nofollow">', 1)
write('unsubscribe/index.html', _ub + '<h1 style="font-size:40px">Unsubscribe from offer emails</h1>\n<p class="muted" style="font-size:18px">Tap the button to stop offer emails from Mechanix Pro. Updates about a booking you made will still reach you.</p>\n<p><button class="btn btn-primary" type="button" id="unsubGo">Stop offer emails</button></p><p role="status" id="unsubMsg" class="small"></p>' + foot())

# ---- Model pages: one per photographed model, with content that differs by type, engine class and price ----
def load_bikes():
    src = open(os.path.join(ROOT, 'assets', 'js', 'bikes.js'), encoding='utf-8').read()
    out = []
    for brand, rows in re.findall(r"^  '([^']+)': \[(.*)\],?$", src, flags=re.M):
        for name, t, big in re.findall(r"\['([^']+)', '([mse])', (\d)\]", rows):
            out.append((brand, name, t, big == '1'))
    return out
def model_slug(brand, name):
    return re.sub(r'[^a-z0-9]+', '-', (brand + ' ' + name).lower()).strip('-')
KIND = {
  'm': ('motorcycle', 'Chain clean, lube and adjust, brake pads, clutch and throttle cable play, spark plug and air filter.',
        ['Chain noise or a loose chain', 'Weak or noisy brakes', 'Hard starting or rough idle', 'Clutch that slips or feels heavy'],
        'Most services take 60 to 90 minutes at your doorstep.'),
  's': ('scooter', 'Engine oil and gear oil, air filter, CVT belt and roller check, brake shoes, battery and tyre pressure.',
        ['Weak pickup or a belt that slips', 'Spongy or noisy brakes', 'Slow or no self-start', 'Vibration at low speed'],
        'Most services take 60 to 75 minutes at your doorstep.'),
  'e': ('electric scooter', 'There is no engine oil to change. We check battery health and connectors, brakes, tyres, suspension, lights and charging behaviour.',
        ['Range lower than before', 'Charging that stops early or is slow', 'Brakes that feel weak', 'Warning lights or unexpected power cuts'],
        'A problem check usually takes 45 to 60 minutes at your doorstep.'),
}
model_pages = []
photo_credits = json.load(open(os.path.join(ROOT, 'src', 'model-photos.json'), encoding='utf-8'))
for brand, name, t, big in load_bikes():
    slug = model_slug(brand, name)
    if slug not in photo_credits: continue
    c = photo_credits[slug]; full = f'{brand} {name}'; kind, checks, problems, timing = KIND[t]
    url = f'{SITE}/bike-service/{slug}/'
    first = 'repair' if t == 'e' else 'basic'
    first_name = 'Repair or problem check' if t == 'e' else 'Basic service'
    surcharge = ' Because this bike is above 180cc, add {{fee:bigbike}} to Basic, General and Full service packages.' if big else ''
    title = f'{full} Service at Home in Bengaluru | Mechanix Pro'
    desc = f'Doorstep {full} {"problem check" if t == "e" else "service"} in Bengaluru, from {{{{text:{first}}}}}. Mechanix Pro certified mechanics, OEM-certified parts, {{{{days}}}}-day warranty. Quote on WhatsApp first.'
    book = f'/book/?brand={urllib.parse.quote(brand, safe="")}&amp;model={urllib.parse.quote(name, safe="")}'
    schema = '<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "AutoRepair", "name": f"Mechanix Pro: {full} service", "url": url,
      "image": f"{SITE}/assets/img/models/{slug}.webp", "telephone": "+91-9743031301", "priceRange": "{{text:repair}}–{{text:full}}",
      "areaServed": {"@type": "City", "name": "Bengaluru"},
      "address": {"@type": "PostalAddress", "addressLocality": "Bengaluru", "addressRegion": "Karnataka", "addressCountry": "IN"}}, ensure_ascii=False) + '</script>'
    price_rows = ''.join(f'<div class="price-row"><span>{n}</span><b>{{{{price:{k}}}}}</b></div>' for k, n in PRICES if k in ('basic', 'general', 'full', 'repair'))
    body = f'''<p class="breadcrumb"><a href="/">Home</a> › <a href="/book/?brand={urllib.parse.quote(brand, safe="")}">{html.escape(brand)}</a> › {html.escape(name)}</p>
<h1 style="font-size:clamp(32px,6vw,50px)">{html.escape(full)} service at your doorstep in Bengaluru.</h1>
<p class="muted" style="font-size:20px">A Mechanix Pro certified mechanic comes to your home or office for your {html.escape(full)}, a {kind} {'above 180cc' if big else 'up to 180cc'}. Quote on WhatsApp first, and nothing starts without your OK.</p>
<figure class="model-fig"><img src="/assets/img/models/{slug}.webp" width="600" height="420" decoding="async" alt="{html.escape(full)} {kind} (example photo)"><figcaption class="tiny muted">Example photo: "{html.escape(c['title'])}" by {html.escape(c['author'])}, <a href="{html.escape(c['license_url'])}" rel="noopener">{html.escape(c['license'])}</a>, <a href="{html.escape(c['source'])}" rel="noopener">source</a>. It shows an example bike, not a customer's.</figcaption></figure>
<p><a class="btn btn-primary" href="{book}">Build your service for this bike</a> <a class="btn btn-wa" href="#" data-wa="Bengaluru" data-wa-text="Hi Mechanix Pro, I need a quote for my {html.escape(full)}.">Get a quote on WhatsApp</a></p>
<h2>What we check on a {html.escape(full)}</h2>
<p>{checks} {timing}</p>
<h2>Common {kind} problems we fix</h2>
<ul>{''.join(f'<li>{html.escape(x)}</li>' for x in problems)}</ul>
<h2>Prices for your {html.escape(name)}</h2>
<div class="card">{price_rows}</div>
<p class="tiny muted" style="margin-top:8px">Starting from {{{{text:{first}}}}} for the {first_name}. GST included.{surcharge} Your exact quote comes on WhatsApp.</p>
<h2>How it works</h2>
<ol><li>Build your service and send it on WhatsApp.</li><li>Our expert checks what is needed and sends your quote.</li><li>You approve, we confirm your slot, and the mechanic arrives. The {{{{fee:advance}}}} checkup and quote fee is adjusted in your bill if you go ahead.</li></ol>
<div class="final" style="margin-top:32px"><h2>Book a service for your {html.escape(name)}.</h2><p>Takes under a minute.</p><a class="btn btn-primary" href="{book}">Build your service</a></div>
'''
    write(f'bike-service/{slug}/index.html', HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema=schema, scripts=LEGAL_JS, body='', nav=NAV, main='page') + body + foot())
    urls.append((f'/bike-service/{slug}/', '0.6'))
    model_pages.append(slug)

# ---- Fleet and societies pages: group requests that open WhatsApp with a ready message ----
GROUP = {
 'fleet': ('Bike Fleet and Delivery Rider Service in Bengaluru | Mechanix Pro', 'Regular doorstep service for delivery riders and small bike fleets in Bengaluru. One quote for the whole fleet, work at your parking, OEM-certified parts. Quote on WhatsApp.', 'Service for delivery riders and small fleets.',
   'Keep every bike on the road. We service a group of bikes at your hub or parking, one visit at a time, and send one quote for the whole fleet.',
   ['One quote for all bikes, shown before any work starts', 'Servicing at your parking or hub, so riders lose less time', 'A service record for every bike, kept by registration number', 'Mechanix Pro certified mechanics and OEM-certified parts', '{{days}}-day warranty on the work'],
   'Hi Mechanix Pro, I run a bike fleet and need a fleet service quote. Number of bikes: __. Area: __.', 'Get a fleet quote on WhatsApp'),
 'societies': ('Bike Service for Apartments and Offices in Bengaluru | Mechanix Pro', 'Doorstep bike service days for apartment societies and office parking in Bengaluru. Many bikes in one visit, a group quote on WhatsApp, work starts only after approval.', 'Service days for apartments and offices.',
   'Trusted by 1,300+ gated communities. Gather a few bikes and we come to your society or office parking. Residents and staff book on the same day, so it is easier for everyone.',
   ['A set service day in your parking area', 'Each owner gets their own quote and approves for their own bike', 'Group visits mean quicker slots', 'Mechanix Pro certified mechanics and OEM-certified parts', '{{days}}-day warranty on the work'],
   'Hi Mechanix Pro, I would like a bike service day at our apartment or office. Society or office name: __. Area: __. Approximate bikes: __.', 'Plan a service day on WhatsApp'),
}
for slug, (title, desc, h1, lead, points, msg, cta) in GROUP.items():
    url = f'{SITE}/{slug}/'
    body = f'''<h1 style="font-size:clamp(32px,6vw,50px)">{h1}</h1>
<p class="muted" style="font-size:20px">{lead}</p>
<p><a class="btn btn-wa" href="#" data-wa="Bengaluru" data-wa-text="{html.escape(msg)}">{cta}</a></p>
<h2>What you get</h2>
<ul>{''.join(f'<li>{p}</li>' for p in points)}</ul>
<h2>Prices</h2>
<div class="card">{''.join(f'<div class="price-row"><span>{n}</span><b>{{{{price:{k}}}}}</b></div>' for k, n in PRICES if k in ('basic', 'general', 'full', 'repair'))}</div>
<p class="tiny muted" style="margin-top:8px">Per bike, up to 180cc; above 180cc add {{{{fee:bigbike}}}} to service packages. GST included. Group quotes are confirmed on WhatsApp.</p>
<h2>How it works</h2>
<ol><li>Message us the number of bikes and your location.</li><li>We reply with a group quote and a service day.</li><li>Each owner approves, and the mechanics arrive on the day.</li></ol>
'''
    write(f'{slug}/index.html', HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema='', scripts=LEGAL_JS, body='', nav=NAV, main='page') + body + foot())
    urls.append((f'/{slug}/', '0.6'))

# ---- Every Bengaluru PIN code: a small script for the PIN check, and a page that lists them all ----
_pins = json.load(open(os.path.join(ROOT, 'src', 'pincodes.json'), encoding='utf-8'))['pins']
with open(os.path.join(ROOT, 'assets', 'js', 'pincodes.js'), 'w', encoding='utf-8') as _f:
    _f.write('/* Bengaluru PIN codes we serve: PIN -> main area name. Written by scripts/build_pages.py from src/pincodes.json. */\nwindow.MXP_PINS = ' + json.dumps({k: v['name'] for k, v in _pins.items()}, ensure_ascii=False, separators=(',', ':')) + ';\n')
_geo = {k: [v['lat'], v['lng']] + v['bbox'] for k, v in _pins.items() if 'lat' in v}
with open(os.path.join(ROOT, 'assets', 'js', 'pingeo.js'), 'w', encoding='utf-8') as _f:
    _f.write('/* Centre point and outline of each Bengaluru PIN code: PIN -> [lat, lng, south, north, west, east]. Map data © OpenStreetMap contributors (ODbL). Written by scripts/build_pages.py from src/pincodes.json. */\nwindow.MXP_PIN_GEO = ' + json.dumps(_geo, separators=(',', ':')) + ';\n')
# Real PIN code outlines, drawn ahead of time into a 300x300 map frame (the same projection the browser uses for exact places).
import math as _m
_W = _H = 300; _PAD = 14
_shape = {}
for _k, _v in _pins.items():
    if 'shape' in _v: _shape[_k] = _v['shape']
    elif 'bbox' in _v:
        _s, _n, _w, _e = _v['bbox']; _shape[_k] = [[[_w, _s], [_e, _s], [_e, _n], [_w, _n], [_w, _s]]]
_lngs = [x for r in _shape.values() for ring in r for x, y in ring]; _lats = [y for r in _shape.values() for ring in r for x, y in ring]
_b = dict(s=min(_lats), n=max(_lats), w=min(_lngs), e=max(_lngs))
_k = _m.cos(((_b['s'] + _b['n']) / 2) * _m.pi / 180); _spanx = (_b['e'] - _b['w']) * _k; _spany = _b['n'] - _b['s']
_scale = min((_W - 2 * _PAD) / _spanx, (_H - 2 * _PAD) / _spany); _offx = (_W - _spanx * _scale) / 2; _offy = (_H - _spany * _scale) / 2
def _pj(lng, lat): return (round(_offx + (lng - _b['w']) * _k * _scale, 1), round(_offy + (_b['n'] - lat) * _scale, 1))
_paths = {}
for _pin, _rings in _shape.items():
    _d = ''
    for _ring in _rings:
        _pts = [_pj(x, y) for x, y in _ring]; _d += 'M' + ' '.join(f'{x:g} {y:g}' for x, y in [_pts[0]]) + ''.join(f'L{x:g} {y:g}' for x, y in _pts[1:]) + 'Z'
    _paths[_pin] = _d
_proj = dict(s=_b['s'], n=_b['n'], w=_b['w'], e=_b['e'], k=round(_k, 6), scale=round(_scale, 4), offX=round(_offx, 2), offY=round(_offy, 2))
_hub = [_pins['560102']['lat'], _pins['560102']['lng']]
with open(os.path.join(ROOT, 'assets', 'js', 'pinshapes.js'), 'w', encoding='utf-8') as _f:
    _f.write('/* Outlines of the Bengaluru PIN code areas, pre-drawn for the Mechanix Pro map. Map data \u00a9 OpenStreetMap contributors (ODbL). Written by scripts/build_pages.py from src/pincodes.json. */\nwindow.MXP_PIN_SHAPES = ' + json.dumps(dict(w=_W, h=_H, proj=_proj, hub=_hub, paths=_paths), separators=(',', ':')) + ';\n')
_rows = ''.join(f'<li class="pin-row"><b>{k}</b><span>{html.escape(v["name"])}</span><small>{html.escape(", ".join(a for a in v["areas"] if a != v["name"])[:140])}</small></li>' for k, v in _pins.items())
_areas_body = f'''<h1 style="font-size:clamp(34px,6vw,52px)">We serve all of Bengaluru.</h1>
<p class="muted" style="font-size:20px">Mechanix Pro comes to your home or office in every Bengaluru PIN code, 560001 to 560110. Check yours below, then build your service.</p>
<div class="pincheck card" data-pincheck><label class="label" for="pc-in">Your PIN code</label><div class="pc-row"><input id="pc-in" inputmode="numeric" maxlength="6" autocomplete="postal-code" placeholder="e.g. 560102"><a class="btn btn-primary" href="/book/">Build your service</a></div><p class="pc-out" role="status" aria-live="polite"></p><div class="pm" data-pinmap></div></div>
<h2>All {len(_pins)} PIN codes</h2>
<ul class="pin-list">{_rows}</ul>
<p class="tiny muted">PIN codes and area names are from the India Post directory. Not in Bengaluru? Build your service anyway and we will tell you when we reach you.</p>
'''
write('areas/index.html', HEAD.format(title='Bike Service in All Bengaluru PIN Codes | Mechanix Pro', desc=f'Doorstep bike and scooter service in all of Bengaluru, every PIN code from 560001 to 560110. Check your PIN code and get a quote on WhatsApp.', url=f'{SITE}/areas/', site=SITE, schema='', scripts=LEGAL_JS, body='', nav=NAV, main='page') + _areas_body + foot())
urls.append(('/areas/', '0.7'))

# ---- Coming soon: an overview page and one page per service, where visitors show their interest ----
SOON = [
 dict(id='car', slug='car-service', title='Car service', tag='Doorstep car service in Bengaluru',
  line='Your car, serviced where you are.',
  desc='We are bringing the Mechanix Pro way to cars: tell us what your car needs, get a quote first, and approve it before any work starts.',
  feats=[('Quote first', 'You see an itemised quote on WhatsApp and approve it before any work starts.'), ('We come to you', 'Service at your home or office parking, so you do not lose half a day at a garage.'), ('Parts you can trust', 'Parts are fitted only after your approval, with the same care as our bike service.')],
  steps=['Tell us your car and what it needs.', 'Get an itemised quote on WhatsApp.', 'Approve it, and we come to you.'],
  icon='M5 16l1.5-5a2 2 0 0 1 1.9-1.4h7.2a2 2 0 0 1 1.9 1.4L19 16M4 16h16v3h-2v-1H6v1H4zM7.5 13.5h.01M16.5 13.5h.01'),
 dict(id='echallan', slug='e-challan-services', title='E-challan services', tag='Check and settle traffic e-challans',
  line='Traffic e-challans, sorted in one place.',
  desc='Look up the e-challans on your vehicle and settle what is due, without chasing several websites.',
  feats=[('One place to check', 'Look up e-challans against your vehicle number.'), ('Help to settle them', 'We help you pay what is due, with a clear record of it.'), ('A nudge before it grows', 'Reminders so a small fine does not turn into a bigger problem.')],
  steps=['Enter your vehicle number.', 'See the e-challans that are pending.', 'Settle them with our help.'],
  icon='M7 3h8l4 4v14H7zM15 3v4h4M9.5 14l2 2 3.5-4'),
 dict(id='pdi', slug='ai-pdi-reports', title='AI PDI reports', tag='Pre-delivery inspection, prepared with AI',
  line='Know the vehicle before you take it home.',
  desc='A pre-delivery inspection report for a new or pre-owned vehicle, prepared with the help of AI, so you can check it before you pay.',
  feats=[('Photo-led inspection', 'Share photos and details, and the inspection follows a clear checklist.'), ('AI-assisted report', 'Findings written up in plain words, prepared with the help of AI.'), ('Something you can share', 'A simple report you can show the dealer or seller before you decide.')],
  steps=['Tell us about the vehicle.', 'Share the photos and details we ask for.', 'Get your report.'],
  icon='M9 4h6l1 2h3v15H5V6h3zM9 13l2 2 4-4'),
 dict(id='damage', slug='ai-damage-analysis', title='AI damage analysis', tag='Photos in, damage analysis out',
  line='Show us the damage. Get a clear picture.',
  desc='Share photos of damage to your vehicle and get an AI-assisted analysis of what needs fixing.',
  feats=[('Just share photos', 'Take a few photos from your phone, no technical know-how needed.'), ('AI-assisted analysis', 'Spot the damage and the likely repairs, prepared with the help of AI.'), ('An estimate you approve', 'A repair estimate on WhatsApp. Nothing starts until you say yes.')],
  steps=['Take photos of the damage.', 'Send them to us.', 'Get the analysis and an estimate.'],
  icon='M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M12 8.5l1.1 2.4 2.4 1.1-2.4 1.1L12 15.5l-1.1-2.4-2.4-1.1 2.4-1.1z'),
 dict(id='rental', slug='bike-rental', title='Bike rental', tag='Rent a bike by the day', backed='Backed by Eightlines Fleet Private Limited',
  line='Ride when you need to. Return when you are done.',
  desc='Bike rental is coming to Mechanix Pro, backed by Eightlines Fleet Private Limited.',
  feats=[('Rent by the day', 'Pick a bike for as long as you need it.'), ('Clear terms', 'Straightforward pricing, deposit and rules, explained before you ride.'), ('Easy pickup and return', 'A simple handover, with a checklist at pickup and return.')],
  steps=['Choose a bike and your dates.', 'Confirm the terms and the handover.', 'Ride, and return it when you are done.'],
  icon='M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15l4-7h5l3 7M10 8l2 7'),
 dict(id='oem', slug='oem-parts', title='OEM parts', tag='Genuine parts, ordered through us',
  line='The right part for your bike.',
  desc='Genuine OEM parts for your bike, ordered through Mechanix Pro and fitted by our mechanics, or delivered to you.',
  feats=[('Genuine OEM parts', 'Parts made for your bike, not a guess.'), ('Ordered through us', 'Tell us your bike and the part, and we find it for you.'), ('Fitted or delivered', 'Have our mechanic fit it at your door, or get it delivered.')],
  steps=['Tell us your bike and the part.', 'Get the price and availability.', 'Approve, and we fit or deliver it.'],
  icon='M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4'),
 dict(id='insurance', slug='insurance-claim-service', title='Insurance claim service', tag='Help with your vehicle insurance claim',
  line='A claim without the runaround.',
  desc='Help with your vehicle insurance claim, from the paperwork to the repair.',
  feats=[('Paperwork help', 'We guide you through what the claim needs.'), ('Repair coordination', 'Repairs lined up so the claim and the work move together.'), ('Kept in the loop', 'Updates on WhatsApp, so you always know where the claim stands.')],
  steps=['Tell us what happened.', 'We guide you through the claim.', 'Get the repair done.'],
  icon='M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6zM9 12l2 2 4-4'),
 dict(id='franchise', slug='franchise', title='Franchise model', tag='Run Mechanix Pro in your city',
  line='Bring Mechanix Pro to your city.',
  desc='We are planning a franchise model so the Mechanix Pro way of doing bike service can reach more cities. Tell us where you are.',
  feats=[('Your city, our standards', 'The same quote-first, approval-first way of working.'), ('Support to get started', 'Training and guidance as part of the plan.'), ('Tell us about you', 'Share your city and interest, and we will get in touch as the model takes shape.')],
  steps=['Tell us your city and your interest.', 'We share how the model will work.', 'We talk about getting started.'],
  icon='M4 10l1.5-5h13L20 10M4 10v10h16V10M4 10h16M9 20v-5h6v5'),
]
def soon_icon(path, cls='soon-ico-svg'):
    return f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="{path}"/></svg>'
def soon_cards(skip=None):
    out = []
    for n, x in enumerate(SOON):
        if x['id'] == skip: continue
        out.append(f'<a class="soon-card reveal" href="/coming-soon/{x["slug"]}/" style="--i:{n}"><span class="soon-ico">{soon_icon(x["icon"])}</span><span class="soon-pill">Coming soon</span><h3>{html.escape(x["title"])}</h3><p>{html.escape(x["tag"])}</p><span class="soon-go">Show your interest <i aria-hidden="true">&rarr;</i></span></a>')
    return ''.join(out)
def soon_form(pre=None):
    chips = ''.join(f'<label class="chip-check"><input type="checkbox" name="wl-interest" value="{x["id"]}"><span>{html.escape(x["title"])}</span></label>' for x in SOON)
    pre_attr = f' data-preselect="{pre}"' if pre else ''
    legend = 'Also interested in' if pre else 'What are you interested in?'
    return f'''<form class="wl card" id="waitlistForm"{pre_attr} novalidate>
      <h3>Get early-bird access</h3>
      <p class="muted" style="margin-top:-4px">Leave your details and we will message you when it starts. Your interest also helps us decide what to launch first.</p>
      <fieldset class="wl-interests"><legend class="label">{legend}</legend><div class="wl-chips">{chips}</div></fieldset>
      <div class="wl-grid">
        <div><label class="label" for="wl-name">Your name</label><input id="wl-name" maxlength="60" autocomplete="name"></div>
        <div><label class="label" for="wl-phone">Mobile number</label><input id="wl-phone" inputmode="numeric" maxlength="10" autocomplete="tel-national" placeholder="10-digit number"></div>
        <div><label class="label" for="wl-email">Email (optional if you gave a number)</label><input id="wl-email" type="email" maxlength="120" autocomplete="email"></div>
        <div><label class="label" for="wl-city">City or area</label><input id="wl-city" maxlength="40" autocomplete="address-level2"></div>
      </div>
      <label class="label" for="wl-note">Anything else? (optional)</label><input id="wl-note" maxlength="200">
      <label class="check"><input type="checkbox" id="wl-consent"><span>It is fine to contact me about the services I picked.</span></label>
      <button class="btn btn-primary" type="submit" style="margin-top:14px">Join the waitlist</button>
      <p class="wl-msg" id="wlMsg" role="status" aria-live="polite"></p>
    </form>'''
def soon_page(slug, title, desc, body):
    url = f'{SITE}/coming-soon/{slug}/' if slug else f'{SITE}/coming-soon/'
    write(f'coming-soon/{slug}/index.html' if slug else 'coming-soon/index.html', HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema='', scripts=LEGAL_JS, body='', nav=NAV, main='') + body + foot())
    urls.append((f'/coming-soon/{slug}/' if slug else '/coming-soon/', '0.5'))
for x in SOON:
    backed = f'<p class="soon-backed">{html.escape(x["backed"])}</p>' if x.get('backed') else ''
    feats = ''.join(f'<div class="soon-feature reveal" style="--i:{i}"><h3>{html.escape(t)}</h3><p>{html.escape(d)}</p></div>' for i, (t, d) in enumerate(x['feats']))
    steps = ''.join(f'<li class="soon-step reveal" style="--i:{i}"><span class="soon-n">{i + 1}</span><span>{html.escape(t)}</span></li>' for i, t in enumerate(x['steps']))
    body = f'''<section class="soon-hero"><div class="soon-glow" aria-hidden="true"></div><div class="wrap">
  <p class="breadcrumb soon-crumb"><a href="/">Home</a> &rsaquo; <a href="/coming-soon/">Coming soon</a> &rsaquo; {html.escape(x["title"])}</p>
  <div class="soon-hero-grid"><div class="soon-copy"><span class="soon-pill">Coming soon</span><h1>{html.escape(x["title"])}</h1><p class="lead">{html.escape(x["line"])}</p><p class="soon-desc">{html.escape(x["desc"])}</p>{backed}
    <div class="row"><a class="btn btn-primary" href="#interest">Show your interest</a><a class="btn btn-ghost-light" href="/coming-soon/">All coming-soon services</a></div></div>
  <div class="soon-art" aria-hidden="true"><span class="soon-ring r1"></span><span class="soon-ring r2"></span><span class="soon-badge">{soon_icon(x["icon"], "soon-art-svg")}</span></div></div>
</div></section>
<section><div class="wrap"><div class="sec-head"><h2>What we are planning.</h2><p>This is how {html.escape(x["title"].lower() if x["id"] not in ("franchise",) else "the franchise model")} is shaping up.</p></div><div class="soon-features">{feats}</div></div></section>
<section class="band"><div class="wrap"><div class="sec-head"><h2>How it will work.</h2></div><ol class="soon-steps">{steps}</ol></div></section>
<section id="interest"><div class="wrap"><div class="sec-head"><h2>Be the first to know.</h2><p>Early-bird access for the people who ask first.</p></div>{soon_form(x["id"])}</div></section>
<section><div class="wrap"><div class="sec-head"><h2>Also coming soon.</h2></div><div class="soon-grid">{soon_cards(x["id"])}</div></div></section>'''
    soon_page(x['slug'], f'{x["title"]}: Coming Soon | Mechanix Pro', f'{x["title"]} is coming soon from Mechanix Pro. {x["desc"]} Join the waitlist for early-bird access.', body)
_overview = f'''<section class="soon-hero soon-hero-sm"><div class="soon-glow" aria-hidden="true"></div><div class="wrap">
  <p class="breadcrumb soon-crumb"><a href="/">Home</a> &rsaquo; Coming soon</p>
  <span class="soon-pill">Coming soon</span><h1>Coming soon from Mechanix Pro.</h1><p class="lead">Eight new things on the way. Pick the ones you want and join the waitlist for early-bird access.</p>
  <div class="row"><a class="btn btn-primary" href="#interest">Join the waitlist</a></div></div></section>
<section><div class="wrap"><div class="soon-grid">{soon_cards()}</div></div></section>
<section id="interest" class="band"><div class="wrap"><div class="sec-head"><h2>Get early-bird access.</h2><p>Tell us what you are interested in. We will message you when it starts.</p></div>{soon_form()}</div></section>'''
soon_page('', 'Coming Soon: Car Service, E-challan, Bike Rental and More | Mechanix Pro', 'New from Mechanix Pro: car service, e-challan services, AI PDI reports, AI damage analysis, bike rental, OEM parts, insurance claim service and a franchise model. Join the waitlist for early-bird access.', _overview)

def _load_json(name):
    p = os.path.join(ROOT, 'src', name)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else []

def reviews_html():
    """Real reviews only: every entry needs a name, text, date and a link to where it was posted. An empty src/reviews.json shows nothing."""
    items = [r for r in _load_json('reviews.json') if all(str(r.get(k, '')).strip() for k in ('name', 'text', 'date', 'url'))]
    if not items: return ''
    cards = ''.join(f'<li><blockquote>{html.escape(r["text"])}</blockquote><p><b>{html.escape(r["name"])}</b> · {html.escape(r["date"])} · <a href="{html.escape(r["url"])}" rel="noopener nofollow">Source</a></p></li>' for r in items)
    return f'<section id="reviews" class="reveal"><div class="wrap"><div class="sec-head"><h2>What riders say.</h2><p>Real reviews, each linked to where it was posted.</p></div><ul class="review-list">{cards}</ul></div></section>'

def mechanics_html():
    """Real mechanics only: name and years of experience are required. A photo is optional and needs alt text. An empty src/mechanics.json shows nothing."""
    items = [m for m in _load_json('mechanics.json') if str(m.get('name', '')).strip() and str(m.get('years', '')).strip()]
    if not items: return ''
    def card(m):
        img = f'<img src="{html.escape(m["photo"])}" width="320" height="320" loading="lazy" decoding="async" alt="{html.escape(m.get("alt") or m["name"])}">' if m.get('photo') else ''
        spec = f'<span>{html.escape(m["speciality"])}</span>' if m.get('speciality') else ''
        return f'<li>{img}<b>{html.escape(m["name"])}</b><span>{html.escape(str(m["years"]))} years of experience</span>{spec}</li>'
    return f'<section id="mechanics" class="reveal"><div class="wrap"><div class="sec-head"><h2>Meet the mechanics.</h2><p>Mechanix Pro-certified, and the people who come to your door.</p></div><ul class="mech-list">{"".join(card(m) for m in items)}</ul></div></section>'

IG_POST = re.compile(r'^https://www\.instagram\.com/(p|reel)/([A-Za-z0-9_-]{5,30})/?(\?.*)?$')
def instagram_html():
    """Follow card, always. Real posts appear below it only for links listed in src/instagram.json (Instagram's own embed, lazy-loaded)."""
    d = _load_json('instagram.json') or {}
    if not isinstance(d, dict): d = {}
    handle = re.sub(r'[^A-Za-z0-9_.]', '', str(d.get('handle', 'themechanixpro'))) or 'themechanixpro'
    profile = f'https://www.instagram.com/{handle}/'
    posts = []
    for u in d.get('posts', []):
        m = IG_POST.match(str(u).strip())
        if m: posts.append((m.group(1), m.group(2)))
    embeds = ''.join(f'<li><iframe src="https://www.instagram.com/{kind}/{code}/embed" title="Instagram post from Mechanix Pro" loading="lazy" width="400" height="520" scrolling="no" allowtransparency="true"></iframe></li>' for kind, code in posts[:6])
    icon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>'
    grid = f'<ul class="ig-grid">{embeds}</ul>' if embeds else ''
    return f'<section id="instagram" class="reveal"><div class="wrap"><div class="sec-head"><h2>Follow our work.</h2><p>Real bikes and doorsteps, on Instagram at @{handle}.</p></div>{grid}<p style="margin-top:18px"><a class="btn btn-primary" href="{profile}" rel="me noopener" target="_blank">{icon}Follow @{handle}</a></p></div></section>'

# Track page: a customer looks up their booking with the reference and the mobile number they booked with.
_tr = HEAD.format(title='Track Your Booking | Mechanix Pro', desc='Check the progress of your Mechanix Pro booking with your reference and mobile number.', url=f'{SITE}/track/', site=SITE, schema='', scripts=LEGAL_JS + '<script src="/assets/js/track.js" defer></script>', body='', nav=NAV, main='page')
_tr = _tr.replace('</title>', '</title><meta name="robots" content="noindex,nofollow">', 1)
write('track/index.html', _tr + '''<h1 style="font-size:40px">Track your booking.</h1>
<p class="muted" style="font-size:18px">Enter the reference from your confirmation (it looks like MP-AB12CD) and the mobile number you booked with.</p>
<form class="card track-form" id="trackForm" novalidate>
  <label class="label" for="tr-ref">Booking reference</label><input id="tr-ref" name="ref" autocapitalize="characters" autocomplete="off" maxlength="9" placeholder="MP-AB12CD">
  <label class="label" for="tr-phone">Mobile number</label><input id="tr-phone" name="phone" inputmode="numeric" autocomplete="tel-national" maxlength="14" placeholder="10-digit number">
  <button class="btn btn-primary" type="submit" id="trGo" style="margin-top:14px">Check progress</button>
  <p class="small" id="trMsg" role="status" aria-live="polite"></p>
</form>
<div id="trResult" aria-live="polite"></div>
<p class="tiny muted">Can't find it? Message us on WhatsApp with your name and number and we will tell you where it stands.</p>''' + foot(FLOAT))


# ---- Languages: Kannada and Hindi copies of the home page, published only when every line has been reviewed by a fluent reader ----
LANG_META = {'kn': 'kn-IN', 'hi': 'hi-IN'}
def i18n_ready(data):
    """True only when there is at least one string and every string is marked reviewed."""
    items = data.get('strings') or []
    return bool(items) and all(x.get('reviewed') is True and str(x.get('t', '')).strip() for x in items)

def i18n_apply(page, data):
    """Swaps each English line for its translation, longest lines first so a short line never breaks a longer one. A line missing from the page is an error."""
    for x in sorted(data['strings'], key=lambda x: -len(x['en'])):
        if x['en'] not in page: raise SystemExit('i18n: line not found on the page: ' + x['en'][:60])
        page = page.replace(x['en'], html.escape(x['t'], quote=False))
    return page

def i18n_build(english_page, slug_url):
    """Returns ({lang: page}, hreflang block) for the languages that are ready."""
    made, links = {}, []
    for code, tag in LANG_META.items():
        fp = os.path.join(ROOT, 'src', 'i18n', code + '.json')
        if not os.path.exists(fp): continue
        data = json.load(open(fp, encoding='utf-8'))
        if not i18n_ready(data): print(f'i18n: {code} not published (lines still need review)'); continue
        made[code] = (i18n_apply(english_page, data), data.get('name', code), tag)
    return made

# ---- Ad landing pages (kept out of search and the sitemap) and the roadside help page ----
_TICK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4 4 10-10"/></svg>'
PROMISES = '<section class="strip" aria-label="Our promises"><div class="wrap"><ul><li>Quote first, work after your OK</li><li>OEM-certified parts, fitted after your approval</li><li>{{days}}-day service warranty</li><li>OTP-safe bike handover</li></ul></div></section>'
def offer_page(o):
    sid, slug = o['service'], o['slug']
    book = f'/book/?service={sid}&campaign={slug}'
    checks = ''.join(f'<li>{html.escape(c)}</li>' for c in o['checks'])
    wa = html.escape(o['wa'] + f' (campaign: {slug})')
    body = f'''<section class="hero"><div class="wrap"><div class="hero-copy">
  <h1>{html.escape(o['headline'])}</h1>
  <p class="lead">{html.escape(o['lead'])}</p>
  <p class="offer-price"><b>{{{{text:{sid}}}}}</b> <span>starting price, GST included. Your exact quote comes on WhatsApp.</span></p>
  <div class="row"><a class="btn btn-primary" href="{book}">Build your service</a><a class="btn btn-wa" href="#" data-wa="general" data-wa-text="{wa}">Get a quote on WhatsApp</a><a class="btn btn-ghost" href="#" data-call>Call us</a></div>
</div></div></section>
{PROMISES}
<section><div class="wrap pricing"><div class="sec-head"><h2>{html.escape(o['checks_title'])}.</h2><p>Parts and oil above standard grade are quoted first and fitted only after you approve.</p></div><ul class="tick">{checks}</ul></div></section>
<section class="band"><div class="wrap"><div class="sec-head"><h2>How it works.</h2></div>
<ol class="steps3"><li><b>Build</b><span>Pick your bike and what it needs. See a starting price right away.</span></li><li><b>Get your quote</b><span>Our expert checks the details and sends your quote on WhatsApp.</span></li><li><b>We come to you</b><span>Approve the quote, pick a slot, and a Mechanix Pro-certified mechanic services your bike at your door. The {{{{fee:advance}}}} checkup and quote fee is adjusted in your bill if you go ahead.</span></li></ol></div></section>
<section><div class="wrap"><div class="final"><h2>Ready when your bike is.</h2><p>Build your service in under a minute, or just message us.</p><div class="row"><a class="btn btn-primary" href="{book}">Build your service</a><a class="btn btn-wa" href="#" data-wa="general" data-wa-text="{wa}">Get a quote on WhatsApp</a></div></div></div></section>'''
    page = HEAD.format(title=html.escape(o['title'] + ' | Mechanix Pro'), desc=html.escape(o['lead']), url=f'{SITE}/offers/{slug}/', site=SITE, schema='', scripts=LEGAL_JS, body='page-offer', nav=NAV, main='')
    page = page.replace('</title>', '</title><meta name="robots" content="noindex,nofollow">', 1)
    write(f'offers/{slug}/index.html', page + body + foot(FLOAT))
for _o in _load_json('offers.json'): offer_page(_o)

_road = HEAD.format(title='Bike Breakdown and Puncture Help in Bengaluru | Mechanix Pro', desc='Bike broken down or punctured in Bengaluru? Share your location and Mechanix Pro sends the nearest mechanic. Call or WhatsApp now.', url=f'{SITE}/roadside/', site=SITE, schema='', scripts=LEGAL_JS, body='page-offer', nav=NAV, main='')
_road_wa = html.escape('Hi Mechanix Pro, my bike has broken down. I am sharing my live location now.')
write('roadside/index.html', _road + f'''<section class="hero"><div class="wrap"><div class="hero-copy">
  <h1>Bike broken down in Bengaluru? We send the nearest mechanic.</h1>
  <p class="lead">Share your live location on WhatsApp and tell us what happened. A Mechanix Pro mechanic comes to you, and you approve any extra work before it starts.</p>
  <p class="offer-price"><b>{{{{text:sos}}}}</b> <span>roadside emergency visit, GST included.</span></p>
  <div class="row"><a class="btn btn-wa" href="#" data-wa="general" data-wa-text="{_road_wa}">Send my location on WhatsApp</a><a class="btn btn-primary" href="#" data-call>Call us now</a></div>
</div></div></section>
{PROMISES}
<section><div class="wrap pricing"><div class="sec-head"><h2>Tell us what happened.</h2><p>The more you tell us, the better the mechanic can prepare.</p></div>
<ul class="tick"><li>Puncture or flat tyre</li><li>Bike will not start</li><li>Battery or self-start problem</li><li>Brakes, chain or clutch trouble</li><li>Engine heating or a strange noise</li><li>Electric scooter that stopped or lost range</li></ul></div></section>
<section class="band"><div class="wrap"><div class="sec-head"><h2>While you wait.</h2></div>
<ol class="steps3"><li><b>Get safe</b><span>Move the bike off the road if you can, switch on the hazard lights, and stand well away from traffic.</span></li><li><b>Send your location</b><span>Tap the WhatsApp button and share your live location, so the mechanic can find you.</span></li><li><b>Approve before we start</b><span>The mechanic checks the problem and quotes first. Nothing extra starts until you say yes.</span></li></ol></div></section>
<section><div class="wrap"><div class="final"><h2>Stuck right now?</h2><p>Message us with your location, or call.</p><div class="row"><a class="btn btn-wa" href="#" data-wa="general" data-wa-text="{_road_wa}">Send my location on WhatsApp</a><a class="btn btn-ghost" href="#" data-call>Call us now</a></div></div></div></section>''' + foot(FLOAT))
urls.append(('/roadside/', '0.8'))

MAIN = [
  ('', 'home', 'Doorstep Bike Service in Bengaluru | Mechanix Pro', 'Bike and scooter service at your home or office in Bengaluru. Prices from {{text:basic}}, Mechanix Pro-certified mechanics, OEM-certified parts, {{days}}-day service warranty. Build your service and get a quote on WhatsApp. Work starts only after you approve.', 'home.jsonld', 'home', APP_JS + '\n<script src="/assets/js/hero.js" defer></script>\n<script src="/assets/js/showcase.js" defer></script>', '1.0'),
  ('book', 'book', 'Build Your Bike Service and Get a Quote | Mechanix Pro', 'Pick your bike model, tell us what it needs and send it on WhatsApp. Get a quote from our expert. Work starts only after you approve. Doorstep bike service in Bengaluru.', None, 'page-book', APP_JS, '0.9'),
  ('services', 'services', 'Bike Service Prices in Bengaluru | Mechanix Pro', 'Basic service from {{text:basic}}, General from {{text:general}}, Full from {{text:full}}. GST included. Doorstep bike and scooter service in Bengaluru with a quote on WhatsApp before any work starts.', None, 'page-services', APP_JS, '0.9'),
  ('help', 'help', 'How Doorstep Bike Service Works and FAQ | Mechanix Pro', 'How Mechanix Pro works: build your service, get a WhatsApp quote, approve, and we service your bike at your door in Bengaluru. Answers to common questions.', 'help.jsonld', 'page-help', APP_JS, '0.8'),
]
for slug, src, title, desc, ld, body, scripts, prio in MAIN:
    url = f'{SITE}/{slug}/' if slug else f'{SITE}/'
    schema = ('<script type="application/ld+json">' + open(os.path.join(ROOT, 'src', ld), encoding='utf-8').read() + '</script>') if ld else ''
    content = open(os.path.join(ROOT, 'src', src + '.html'), encoding='utf-8').read().replace('<!--BRAND_CHIPS-->', brand_chips()).replace('<!--SOON_CARDS-->', soon_cards()).replace('<!--REVIEWS-->', reviews_html()).replace('<!--MECHANICS-->', mechanics_html()).replace('<!--INSTAGRAM-->', instagram_html())
    out = HEAD.format(title=html.escape(title), desc=html.escape(desc), url=url, site=SITE, schema=schema, scripts=scripts, body=body, nav=NAV, main='') + content + foot(FLOAT)
    if src == 'home':
        langs = i18n_build(out, url)
        if langs:
            alt = f'<link rel="alternate" hreflang="en-IN" href="{SITE}/">' + ''.join(f'<link rel="alternate" hreflang="{tag}" href="{SITE}/{code}/">' for code, (_, _, tag) in langs.items()) + '<link rel="alternate" hreflang="x-default" href="{SITE}/">'.replace('{SITE}', SITE)
            switch = '<p class="tiny lang-links wrap">' + ' · '.join(['<a href="/" hreflang="en-IN">English</a>'] + [f'<a href="/{code}/" hreflang="{tag}" lang="{tag}">{name}</a>' for code, (_, name, tag) in langs.items()]) + '</p>'
            out = out.replace('</head>', alt + '</head>', 1).replace('</footer>', switch + '</footer>', 1)
            for code, (pg, name, tag) in langs.items():
                pg = pg.replace('<html lang="en-IN">', f'<html lang="{tag}">', 1).replace(f'<link rel="canonical" href="{url}">', f'<link rel="canonical" href="{SITE}/{code}/">', 1).replace('</head>', alt + '</head>', 1).replace('</footer>', switch + '</footer>', 1)
                write(f'{code}/index.html', pg); urls.append((f'/{code}/', '0.8'))
    write(f'{slug}/index.html' if slug else 'index.html', out)
    if slug: urls.append((f'/{slug}/', prio))
urls[0] = ('/', '1.0')

sm = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + ''.join(f'  <url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod><priority>{p}</priority></url>\n' for u, p in urls) + '</urlset>\n'
write('sitemap.xml', sm)
print('Generated', len(urls), 'pages')
