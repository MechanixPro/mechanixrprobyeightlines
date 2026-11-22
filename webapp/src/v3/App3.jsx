import { useState, useMemo } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { House, Wrench, ClipboardList, User, MapPin, Search, Bike, Car, LifeBuoy, CircleHelp, ShieldCheck, Receipt, KeyRound, Camera, ChevronRight, X, Check, Phone } from 'lucide-react';
import { ART, PRICE, FEE, CLASS_LABEL, ADDONS, FAQ, BRANDS, inr } from '../data.js';
import { SERVICE_ID } from '../booking-rules.js';
import logo from '../assets/logo-mark.png';

const q = new URLSearchParams(location.search);
const gst = (n) => Math.round(n * 118) / 100;
// Hand-off to the live /book/ page, which takes the real payment. Choices only (no personal details) go in sessionStorage; /book/ restores them at the address and slot step.
function toBook(o) {
  try { sessionStorage.setItem('mxp_book_choices_v1', JSON.stringify({ ...o, step: 2 })); } catch (e) { /* storage blocked: /book/ opens at step 1 */ }
  location.href = '/book/';
}
const TILES = [
  ['basic', 'Basic service', Wrench, 'from ' + inr(gst(499)), '15 checks'],
  ['standard', 'Standard service', Wrench, 'from ' + inr(gst(799)), '24 checks'],
  ['full', 'Full service', Wrench, 'from ' + inr(gst(1299)), '28 checks'],
  ['problem', 'Problem check', CircleHelp, '₹349 visit and quote', 'Tell us the issue'],
  ['road', 'Roadside help', LifeBuoy, 'Quoted before we move', 'Share your location'],
  ['car', 'Car service', Car, 'from ' + inr(gst(474)), 'Inspection first'],
];
const STEPS = [[Bike, 'Tell us the bike'], [Receipt, 'Pay a small slot fee'], [ClipboardList, 'Approve the quote'], [KeyRound, 'Share the handover code']];
const NAV = [['home', 'Home', House], ['services', 'Services', Wrench], ['track', 'Track', ClipboardList], ['account', 'Account', User]];

function Sheet({ svc, onClose }) {
  const [cls, setCls] = useState('std'); const [add, setAdd] = useState({}); const [brand, setBrand] = useState('Honda'); const [model, setModel] = useState('Activa 6G');
  const pickBrand = (b) => { setBrand(b); setModel(BRANDS[b][0][0]); setCls(BRANDS[b][0][1]); };
  const pickModel = (m) => { setModel(m); setCls(BRANDS[brand].find((x) => x[0] === m)[1]); };
  const go = () => (svc === 'road' ? (location.href = '/roadside/') : toBook(svc === 'car' ? { vehicle: 'car' } : { vehicle: 'bike', brand, model, engine_class: cls, service_id: SERVICE_ID[svc === 'problem' ? 'repair' : svc] }));
  const key = svc === 'basic' || svc === 'standard' || svc === 'full' ? svc : null;
  const t = TILES.find((x) => x[0] === svc);
  const extra = ADDONS.reduce((s, [k, , p]) => s + (add[k] ? p : 0), 0);
  const base = key ? PRICE[key][cls] : 0;
  return (
    <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.aside className="sheet" role="dialog" aria-modal="true" aria-label={t[1]} onClick={(e) => e.stopPropagation()}
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 30, stiffness: 320 }}>
        <button className="x" onClick={onClose} aria-label="Close"><X size={20} /></button>
        <p className="eb">{t[4]}</p><h2>{t[1]}</h2>
        {svc !== 'car' && svc !== 'road' && (<div className="pick"><label>Brand<select value={brand} onChange={(e) => pickBrand(e.target.value)}>{Object.keys(BRANDS).map((b) => <option key={b}>{b}</option>)}</select></label><label>Model<select value={model} onChange={(e) => pickModel(e.target.value)}>{BRANDS[brand].map(([m]) => <option key={m}>{m}</option>)}</select></label></div>)}
        {key ? (<>
          <p className="mut">Engine size for {model}: <b>{CLASS_LABEL[cls]}</b></p>
          <div className="tot"><span>{inr(gst(base + extra))}</span><small>including 18% GST · {inr(base + extra)} + GST {inr(gst(base + extra) - (base + extra))}</small></div>
          <h3>Add-ons</h3>
          <div className="seg wrap">{ADDONS.map(([k, l, p]) => <button key={k} aria-pressed={!!add[k]} onClick={() => setAdd((a) => ({ ...a, [k]: !a[k] }))}>{l} · {p ? '+' + inr(p) : 'free'}</button>)}</div>
          <ul className="inc"><li><Check size={18} />Itemised quote before any extra work</li><li><Check size={18} />One-time code at handover, photos, GST invoice</li><li><Check size={18} />Same work fails in 30 days: redone free</li></ul>
          <div className="bar"><div><b>{inr(FEE[cls])}</b><small>slot fee now, comes off your bill</small></div><button className="btn" onClick={go}>Continue</button></div>
        </>) : (<>
          <p className="lead">{svc === 'problem' ? 'Describe the problem. A mechanic visits, finds the cause and sends a quote you can approve or decline. If you decline after a mechanic is assigned, a ₹349 visit-and-quote charge applies.' : svc === 'road' ? 'Share your location. The nearest available mechanic is sent. The price is quoted to you before anyone starts.' : 'Doorstep inspection first, with written findings. The exact price comes after the inspection.'}</p>
          <div className="bar"><div><b>{t[3].replace('from ', 'From ')}</b><small>{svc === 'car' ? 'GST included' : 'quoted before work'}</small></div><button className="btn" onClick={go}>{svc === 'road' ? 'Get roadside help' : 'Continue'}</button></div>
        </>)}
      </motion.aside>
    </motion.div>
  );
}

function Home({ open, go }) {
  const [cls, setCls] = useState('std'); const [sv, setSv] = useState('standard');
  const base = PRICE[sv][cls];
  return (
    <div className="scr">
      <section className="banner" style={{ '--art': `url(${ART.Bengaluru})` }}>
        <span className="live"><i />Live in Bengaluru</span>
        <h1>Bike service<br />at your door.</h1>
        <p>Quote first. Pay after you say yes.</p>
        <button className="btn" onClick={() => open('standard')}>Book a service</button>
      </section>
      <h2 className="h">What do you need?</h2>
      <div className="tiles">{TILES.map(([id, n, I, p, s]) => (
        <button key={id} className="tile" onClick={() => open(id)}><span className="ic"><I size={26} /></span><b>{n}</b><small>{p}</small><em>{s}</em><ChevronRight className="go" size={18} /></button>))}</div>
      <div className="two">
        <section className="panel"><h2 className="h sm">Your price in seconds</h2>
          <div className="seg" role="group" aria-label="Engine size">{Object.entries(CLASS_LABEL).map(([k, l]) => <button key={k} aria-pressed={cls === k} onClick={() => setCls(k)}>{l}</button>)}</div>
          <div className="seg" role="group" aria-label="Service">{[['basic', 'Basic'], ['standard', 'Standard'], ['full', 'Full']].map(([k, l]) => <button key={k} aria-pressed={sv === k} onClick={() => setSv(k)}>{l}</button>)}</div>
          <div className="tot"><span>{inr(gst(base))}</span><small>including 18% GST · slot fee {inr(FEE[cls])} comes off the bill</small></div>
          <button className="btn wide" onClick={() => open(sv)}>Book this service</button></section>
        <section className="panel dark"><h2 className="h sm">Track your booking</h2><p className="mut">No active booking. Enter your booking ID and phone number to see where your mechanic is.</p>
          <button className="btn ghost wide" onClick={() => go('track')}>Track a booking</button></section>
      </div>
      <h2 className="h">How a visit works</h2>
      <ol className="steps">{STEPS.map(([I, t], i) => (<li key={t}><span className="n">{String(i + 1).padStart(2, '0')}</span><I size={28} /><b>{t}</b></li>))}</ol>
      <div className="pills">{[[ShieldCheck, '30-day redo'], [Receipt, 'GST invoice'], [Camera, 'Photos of findings'], [KeyRound, 'One-time handover code']].map(([I, t]) => <span key={t}><I size={18} />{t}</span>)}</div>
      <h2 className="h">Areas we serve in Bengaluru</h2>
      <div className="chips">{['HSR Layout', 'Koramangala', 'Indiranagar', 'Whitefield', 'Jayanagar', 'BTM Layout', 'Marathahalli', 'Electronic City'].map((a) => <button key={a}>{a}</button>)}</div>
      <h2 className="h">Good to know</h2>
      <div className="faq">{FAQ.map(([a, b]) => <details key={a}><summary>{a}</summary><p>{b}</p></details>)}</div>
      <footer className="foot">Mechanix Pro, a brand of NOVA VENTURES · Prices include 18% GST · GST invoice on every job</footer>
    </div>
  );
}

function Track() {
  return (<div className="scr narrow"><h1 className="pg">Track a booking</h1><p className="mut">Use the ID from your confirmation message.</p>
    <label>Booking ID<input placeholder="MP-26-27-0140" /></label><label>Phone number<input inputMode="tel" placeholder="10-digit mobile number" /></label><button className="btn wide">Show my booking</button>
    <div className="tl"><h3>What you will see</h3><ol><li className="on">Slot held</li><li className="on">Mechanic assigned</li><li>Quote ready to approve</li><li>Handover code</li><li>Done and invoiced</li></ol></div></div>);
}
function Account() {
  return (<div className="scr narrow"><h1 className="pg">Your account</h1><p className="mut">Sign in with your email to see bookings, vehicles, invoices and warranty.</p>
    <label>Email<input type="email" autoComplete="email" placeholder="you@example.com" /></label><button className="btn wide">Send me a sign-in code</button>
    <div className="list">{['Your bookings', 'Your vehicles', 'Invoices', 'Warranty cards', 'Service reminders'].map((t) => <span key={t}>{t}<ChevronRight size={18} /></span>)}</div></div>);
}
function Services({ open }) {
  return (<div className="scr"><h1 className="pg">All services</h1><div className="tiles">{TILES.map(([id, n, I, p, s]) => (<button key={id} className="tile" onClick={() => open(id)}><span className="ic"><I size={26} /></span><b>{n}</b><small>{p}</small><em>{s}</em><ChevronRight className="go" size={18} /></button>))}</div></div>);
}

export default function App3() {
  const [tab, setTab] = useState(q.get('tab') || 'home'); const [svc, setSvc] = useState(q.get('svc') || null);
  return (
    <MotionConfig reducedMotion="user">
      <a className="skip" href="#main">Skip to content</a>
      <div className="app">
        <aside className="rail"><a className="brand" href="#"><img src={logo} alt="" width="36" height="36" /><b>Mechanix Pro</b></a>
          <nav aria-label="Main">{NAV.map(([id, l, I]) => <button key={id} aria-current={tab === id} onClick={() => setTab(id)}><I size={22} />{l}</button>)}</nav>
          <a className="call" href="tel:+918310621498"><Phone size={18} />Call us</a></aside>
        <div className="col">
          <header className="top"><button className="loc"><MapPin size={18} /><span><small>Service at</small><b>HSR Layout, Bengaluru</b></span></button>
            <label className="srch"><Search size={18} /><input aria-label="Search" placeholder="Search a service or problem" /></label>
            <span className="lang">EN</span></header>
          <main id="main">{tab === 'home' && <Home open={setSvc} go={setTab} />}{tab === 'services' && <Services open={setSvc} />}{tab === 'track' && <Track />}{tab === 'account' && <Account />}</main>
        </div>
        <nav className="tabs" aria-label="Main">{NAV.map(([id, l, I]) => <button key={id} aria-current={tab === id} onClick={() => setTab(id)}><I size={22} />{l}</button>)}</nav>
        {tab === 'home' && <div className="dock"><button className="btn wide" onClick={() => setSvc('standard')}>Book a service</button></div>}
      </div>
      <AnimatePresence>{svc && <Sheet svc={svc} onClose={() => setSvc(null)} />}</AnimatePresence>
    </MotionConfig>
  );
}
