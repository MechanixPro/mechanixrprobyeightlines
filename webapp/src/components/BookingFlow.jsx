import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Bike, Car, Check, Lock, MapPin, MessageCircle, ShieldCheck } from 'lucide-react';
import { ADDONS, BRANDS, CAR_BRANDS, CLASS_LABEL, FEE, PRICE, SERVICES, inr, total } from '../data.js';
import { CAR_NEEDS, SERVICE_ID, SLOT_LABEL, nextDays, problems, toPayload } from '../booking-rules.js';

const STEPS = ['Vehicle', 'Service', 'Slot and address', 'Review and pay'];
const gst = (p) => Math.round(p * 0.18 * 100) / 100;
const CAR_FROM = [['Car inspection', 474], ['Basic car service', 1994], ['Standard car service', 2535]];

export default function BookingFlow({ city, startStep = 0, startService = null, onClose, live = false }) {
  const days = useMemo(() => nextDays(), []);
  const firstDay = days.find((d) => d.any) || days[1];
  const [step, setStep] = useState(startStep);
  const [tried, setTried] = useState(false);
  const [kind, setKind] = useState('Bike');
  const [brand, setBrand] = useState('Honda');
  const [v, setV] = useState({ vehicle: 'bike', brand: 'Honda', model: 'Activa 6G', engine_class: 'std', service_id: startService ? SERVICE_ID[startService] : '', car_model: '', car_need: '', house: '', street: '', area: '', pincode: '', preferred_date: firstDay.iso, preferred_slot: '', name: '', phone: '', email: '', consent_whatsapp: true });
  const [addons, setAddons] = useState([]);
  const [coupon, setCoupon] = useState('');
  const [phase, setPhase] = useState('edit');
  const set = (o) => setV((x) => ({ ...x, ...o }));
  const isCar = v.vehicle === 'car', cls = v.engine_class;
  const day = days.find((d) => d.iso === v.preferred_date) || firstDay;
  const errs = problems(v, step === 3 ? undefined : step + 1);
  const pkg = Object.entries(SERVICE_ID).find(([, id]) => id === v.service_id)?.[0];
  const mainPrice = isCar ? 0 : v.service_id === 'repair' ? 349 : (pkg ? PRICE[pkg][cls] : 0);
  const extra = isCar ? 0 : addons.reduce((n, a) => n + (ADDONS.find((x) => x[0] === a)?.[2] ?? 0), 0);
  const base = mainPrice + extra, fee = isCar ? FEE.car : FEE[cls];
  const svcName = isCar ? CAR_NEEDS[v.car_need] : v.service_id === 'repair' ? 'Problem check' : SERVICES.find((s) => s.id === pkg)?.name;
  const ok = Object.keys(errs).length === 0;

  useEffect(() => { const u = new URL(location.href); u.searchParams.set('step', step); history.replaceState(null, '', u); window.scrollTo({ top: 0 }); }, [step]);
  const next = () => { if (!ok) { setTried(true); return; } setTried(false); setStep(step + 1); };
  const submit = () => {
    if (!live) { setPhase('paying'); setTimeout(() => setPhase('done'), 1300); return; }
    // Live submit goes through book-start and the payment window. Not enabled in this preview build.
    console.info('payload', toPayload(v, 'preview-key'));
  };
  const note = addons.length ? `Add-ons requested: ${addons.map((a) => ADDONS.find((x) => x[0] === a)[1]).join(', ')}` : '';
  void note;

  if (phase === 'done') return <Done city={city} svcName={svcName} day={day} slot={SLOT_LABEL[v.preferred_slot]} onClose={onClose} />;
  const E = ({ f }) => (tried && errs[f] ? <span className="err" role="alert">{errs[f]}</span> : null);
  return (
    <div className="flow"><div className="wrap">
      <button className="back" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}><ArrowLeft size={18} aria-hidden />{step === 0 ? `Back to ${city}` : 'Back'}</button>
      <ol className="stepper" aria-label="Booking steps">
        {STEPS.map((t, i) => (<li key={t} className={i < step ? 'done' : i === step ? 'cur' : ''} aria-current={i === step ? 'step' : undefined}><span className="dot">{i < step ? <Check size={16} aria-hidden /> : i + 1}</span><span className="lab">{t}</span></li>))}
        <motion.i className="bar" aria-hidden animate={{ scaleX: step / 3 }} transition={{ type: 'spring', stiffness: 220, damping: 28 }} />
      </ol>
      <div className="flowgrid">
        <AnimatePresence mode="wait">
          <motion.div key={step} className="pane" initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }} transition={{ duration: .22 }}>
            {step === 0 && (<>
              <h2>Choose your vehicle</h2>
              <div className="seg2" role="tablist" aria-label="Vehicle type">
                {[['Bike', Bike], ['Car', Car]].map(([k, Icon]) => (
                  <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => { setKind(k); if (k === 'Bike') { setBrand('Honda'); set({ vehicle: 'bike', brand: 'Honda', model: 'Activa 6G', engine_class: 'std', service_id: '' }); } else { setBrand('Maruti'); set({ vehicle: 'car', brand: '', model: '', engine_class: null, service_id: '', car_model: 'Maruti Swift', car_need: '' }); } }}>
                    {kind === k && <motion.span layoutId="seg2" className="ind" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}<Icon size={18} aria-hidden /><span>{k}</span></button>))}
              </div>
              {!isCar ? (<>
                <h3>Brand</h3>
                <div className="tiles">{Object.keys(BRANDS).map((b) => (<button key={b} className={`tile2${brand === b ? ' on' : ''}`} onClick={() => { setBrand(b); const [m, c] = BRANDS[b][0]; set({ brand: b, model: m, engine_class: c }); }}>{b}</button>))}</div>
                <h3>Model</h3>
                <div className="tiles m">{BRANDS[brand].map(([m, c]) => (<button key={m} className={`tile2${v.model === m ? ' on' : ''}`} onClick={() => set({ model: m, engine_class: c })}>{m}</button>))}</div>
                <p className="hint">Engine size: <b>{CLASS_LABEL[cls]}</b>. It sets your price and your small confirmation fee ({inr(FEE[cls])}).</p>
              </>) : (<>
                <h3>Your car</h3>
                <div className="field"><label htmlFor="cm">Make and model</label><input id="cm" name="car_model" autoComplete="off" value={v.car_model} onChange={(e) => set({ car_model: e.target.value })} /><E f="car_model" /></div>
                <div className="field" style={{ marginTop: 14 }}><label htmlFor="cn">What does it need?</label>
                  <select id="cn" name="car_need" value={v.car_need} onChange={(e) => set({ car_need: e.target.value })}><option value="">Choose…</option>{Object.entries(CAR_NEEDS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select><E f="car_need" /></div>
                <p className="hint">The confirmation fee for a car is {inr(FEE.car)}. It comes off your final bill.</p>
              </>)}
            </>)}
            {step === 1 && (<>
              <h2>{isCar ? 'Your car quote' : `Services for ${v.brand} ${v.model}`}</h2>
              {isCar ? (<>
                <div className="card2"><h3 style={{ marginTop: 0 }}>Starting prices before GST</h3><dl className="bill">{CAR_FROM.map(([n, p]) => [<dt key={n}>{n}</dt>, <dd key={n + 'p'}>from {inr(p)}</dd>])}</dl></div>
                <p className="hint">Your exact price comes after the inspection, and nothing starts until you approve it. Pay the small fee next to hold your slot.</p></>) : (<>
                <div className="svcs2" role="radiogroup" aria-label="Choose a service">
                  {SERVICES.map((s) => (<button key={s.id} role="radio" aria-checked={v.service_id === SERVICE_ID[s.id]} className={`svc3${v.service_id === SERVICE_ID[s.id] ? ' on' : ''}`} onClick={() => set({ service_id: SERVICE_ID[s.id] })}>
                    {v.service_id === SERVICE_ID[s.id] && <motion.span layoutId="ring2" className="ring" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                    <b>{s.name}{s.hot && <span className="tag">Most chosen</span>}</b><span className="p">{inr(PRICE[s.id][cls])}<small> + GST</small></span><span className="t">Total {inr(total(PRICE[s.id][cls]))} with GST</span>
                    <ul>{s.bullets.map((x) => <li key={x}>{x}</li>)}</ul></button>))}
                </div>
                <button className={`add${v.service_id === 'repair' ? ' on' : ''}`} style={{ marginTop: 12, width: '100%', textAlign: 'left' }} role="radio" aria-checked={v.service_id === 'repair'} onClick={() => set({ service_id: 'repair' })}>
                  <span className="chk" aria-hidden>{v.service_id === 'repair' && <Check size={14} />}</span><span style={{ flex: 1 }}><b>Not sure? Book a problem check</b><br /><small style={{ color: 'var(--muted)' }}>The mechanic finds the cause and quotes the fix. Adjusted in your bill if you go ahead.</small></span><b>{inr(349)} + GST</b></button>
                <E f="service_id" />
                {v.service_id !== 'repair' && (<>
                  <h3>Add-ons</h3>
                  <div className="addons">{ADDONS.map(([id, n, p]) => (<label key={id} className={`add${addons.includes(id) ? ' on' : ''}`}><input type="checkbox" checked={addons.includes(id)} onChange={() => setAddons((a) => a.includes(id) ? a.filter((x) => x !== id) : [...a, id])} /><span className="chk" aria-hidden>{addons.includes(id) && <Check size={14} />}</span><span style={{ flex: 1 }}>{n}</span><b>{p ? `${inr(p)} + GST` : 'Free'}</b></label>))}</div>
                  <p className="hint">Add-ons go into your quote request. The mechanic confirms them in your itemised quote.</p></>)}
              </>)}
            </>)}
            {step === 2 && (<>
              <h2>Pick a day, time and place</h2>
              <div className="days" role="radiogroup" aria-label="Day">{days.map((d) => (<button key={d.iso} role="radio" aria-checked={v.preferred_date === d.iso} disabled={!d.any} className={`day${v.preferred_date === d.iso ? ' on' : ''}`} onClick={() => set({ preferred_date: d.iso, preferred_slot: d.slots[v.preferred_slot] ? v.preferred_slot : '' })}>{d.label}<small style={{ display: 'block', fontWeight: 500, opacity: .75 }}>{d.sub}</small></button>))}</div>
              <div className="slots" role="radiogroup" aria-label="Time">{['morning', 'afternoon', 'evening', ...(day.slots.asap ? ['asap'] : [])].map((k) => (<button key={k} role="radio" aria-checked={v.preferred_slot === k} disabled={!day.slots[k]} className={`slot2${v.preferred_slot === k ? ' on' : ''}`} onClick={() => set({ preferred_slot: k })}><b>{SLOT_LABEL[k][0]}</b><span>{SLOT_LABEL[k][1]}{!day.slots[k] && ' · passed'}</span></button>))}</div>
              <E f="preferred_slot" />
              <div className="mapbox" aria-hidden><div className="roadx" /><motion.span className="pin" initial={{ y: -28, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 14 }} style={{ position: 'absolute', left: '48%', top: '42%' }} /><span className="mapnote"><MapPin size={14} />Pin your parking spot (coming soon)</span></div>
              <div className="two">
                <div className="field"><label htmlFor="ho">House or flat number</label><input id="ho" name="house" autoComplete="address-line1" value={v.house} onChange={(e) => set({ house: e.target.value })} /><E f="house" /></div>
                <div className="field"><label htmlFor="st">Street or landmark</label><input id="st" name="street" autoComplete="address-line2" value={v.street} onChange={(e) => set({ street: e.target.value })} /><E f="street" /></div>
                <div className="field"><label htmlFor="ar">Area</label><input id="ar" name="area" autoComplete="address-level3" value={v.area} onChange={(e) => set({ area: e.target.value })} /><E f="area" /></div>
                <div className="field"><label htmlFor="pn">PIN code</label><input id="pn" name="pincode" autoComplete="postal-code" inputMode="numeric" value={v.pincode} onChange={(e) => set({ pincode: e.target.value.replace(/\D/g, '').slice(0, 6) })} /><E f="pincode" /></div>
                <div className="field"><label htmlFor="nm">Your name</label><input id="nm" name="name" autoComplete="name" value={v.name} onChange={(e) => set({ name: e.target.value })} /><E f="name" /></div>
                <div className="field"><label htmlFor="mb">Mobile number</label><input id="mb" name="phone" type="tel" autoComplete="tel-national" inputMode="numeric" placeholder="10-digit number" value={v.phone} onChange={(e) => set({ phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} /><E f="phone" /></div>
                <div className="field" style={{ gridColumn: '1 / -1' }}><label htmlFor="em">Email</label><input id="em" name="email" type="email" autoComplete="email" spellCheck={false} placeholder="We send your confirmation and code here" value={v.email} onChange={(e) => set({ email: e.target.value })} /><E f="email" /></div>
              </div>
              <label className="add on" style={{ marginTop: 12 }}><input type="checkbox" checked={v.consent_whatsapp} onChange={(e) => set({ consent_whatsapp: e.target.checked })} /><span className="chk" aria-hidden>{v.consent_whatsapp && <Check size={14} />}</span><span>Send my booking updates on WhatsApp</span></label>
            </>)}
            {step === 3 && (<>
              <h2>Review and pay the small fee</h2>
              <div className="card2"><dl className="bill">
                <dt>{svcName}</dt><dd>{isCar ? 'quote after inspection' : inr(mainPrice)}</dd>
                {addons.map((a) => { const x = ADDONS.find((y) => y[0] === a); return [<dt key={a + 'k'}>{x[1]}</dt>, <dd key={a + 'v'}>{x[2] ? inr(x[2]) : 'Free'}</dd>]; })}
                {!isCar && <><dt>GST 18%</dt><dd>{inr(gst(base))}</dd><dt className="tot">Estimated total</dt><dd className="tot">{inr(total(base))}</dd></>}
              </dl></div>
              <div className="card2 fee"><div><b>Pay a small fee now</b><p>It holds your slot and <b>comes off your final bill</b>. Full refund if you cancel more than 2 hours before the slot.</p></div><span className="feeamt">{inr(fee)}</span></div>
              <div className="two" style={{ alignItems: 'end' }}><div className="field"><label htmlFor="cp">Coupon code</label><input id="cp" name="coupon" autoComplete="off" spellCheck={false} value={coupon} onChange={(e) => setCoupon(e.target.value.toUpperCase())} placeholder="Enter a code…" /></div><button className="btn" type="button">Apply</button></div>
              <p className="hint">If you decline the quote after a mechanic is assigned, a ₹349 visit-and-quote charge applies. If you go ahead, it is not added. The fee is worked out by our server from your vehicle.</p>
            </>)}
          </motion.div>
        </AnimatePresence>
        <aside className="sum2" aria-label="Your booking">
          <h3>Your booking</h3>
          <dl className="bill sm">
            <dt>Vehicle</dt><dd>{isCar ? v.car_model || 'Car' : `${v.brand} ${v.model}`}</dd><dt>Where</dt><dd>{city}</dd>
            {svcName && <><dt>Service</dt><dd>{svcName}</dd></>}
            {step >= 2 && v.preferred_slot && <><dt>When</dt><dd>{day.label}, {SLOT_LABEL[v.preferred_slot][0].toLowerCase()}</dd></>}
            {!isCar && base > 0 && <><dt className="tot">Total with GST</dt><dd className="tot">{inr(total(base))}</dd></>}
            <dt>Fee today</dt><dd>{inr(fee)}</dd>
          </dl>
          <motion.button className="btn o lg wide" disabled={phase === 'paying'} whileTap={{ scale: .98 }} onClick={() => (step === 3 ? submit() : next())}>
            {phase === 'paying' ? <><span className="spin" aria-hidden />Confirming…</> : step === 3 ? `Pay ${inr(fee)} and confirm` : ['Continue to services', 'Continue to slot', 'Continue to pay'][step]}
          </motion.button>
          {tried && !ok && <p className="hint err" role="alert">Fix the highlighted fields to continue.</p>}
          <p className="safe"><Lock size={14} aria-hidden />{live ? 'Secure payment' : 'Preview only. No payment is taken.'}</p>
        </aside>
      </div>
    </div></div>
  );
}

function Done({ city, svcName, day, slot, onClose }) {
  return (
    <div className="flow"><div className="wrap" style={{ maxWidth: 900 }}>
      <motion.div className="donebox" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} role="status" aria-live="polite">
        <motion.svg width="84" height="84" viewBox="0 0 76 76" initial="h" animate="s" aria-hidden>
          <motion.circle cx="38" cy="38" r="34" fill="none" stroke="#15803D" strokeWidth="5" variants={{ h: { pathLength: 0 }, s: { pathLength: 1 } }} transition={{ duration: .5 }} />
          <motion.path d="M22 40 L33 51 L55 27" fill="none" stroke="#15803D" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" variants={{ h: { pathLength: 0 }, s: { pathLength: 1 } }} transition={{ delay: .4, duration: .4 }} />
        </motion.svg>
        <h2>You are booked</h2>
        <p className="lead2">{svcName} in {city}, {day.label.toLowerCase()} {day.sub}, {slot[0].toLowerCase()}. Sample booking ID <b translate="no">MP-26-27-0140</b>.</p>
        <div className="three">
          <div className="card2"><h3>What happens next</h3><p>1. We confirm your slot with a partner.<br />2. You get their details on WhatsApp.<br />3. Give your one-time code at the door.<br />4. Approve the itemised quote.</p></div>
          <div className="card2"><h3>Your one-time code</h3><div className="code">••••</div><p><ShieldCheck size={14} aria-hidden /> Share it only at the door.</p></div>
          <div className="card2"><h3>Track your booking</h3><p>A private link is sent on WhatsApp and email.</p><button className="btn p s"><MessageCircle size={16} aria-hidden />Open tracking page</button></div>
        </div>
        <button className="btn" onClick={onClose}>Back to {city}</button>
      </motion.div>
    </div></div>
  );
}
