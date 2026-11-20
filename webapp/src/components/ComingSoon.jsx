import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STATES } from '../data.js';

export default function ComingSoon({ city, onOpenPicker }) {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const nearest = 'Bengaluru';
  return (
    <section className="blk">
      <div className="wrap wait">
        <div className="card">
          <AnimatePresence mode="wait">
            {!sent ? (
              <motion.form key="f" exit={{ opacity: 0, y: -10 }} onSubmit={(e) => { e.preventDefault(); setBusy(true); setTimeout(() => { setSent(true); setBusy(false); }, 900); }}>
                <h2 style={{ fontSize: 30, marginBottom: 14 }}>Join the waitlist</h2>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div className="field"><label htmlFor="n">Name</label><input id="n" name="name" autoComplete="name" required placeholder="Your name" /></div>
                  <div className="field"><label htmlFor="m">Mobile number</label><input id="m" name="mobile" type="tel" autoComplete="tel-national" inputMode="numeric" pattern="[6-9][0-9]{9}" required placeholder="10-digit mobile number" /></div>
                  <div className="field"><label htmlFor="v">Vehicle</label><select id="v" name="vehicle"><option>Bike or scooter</option><option>Car</option></select></div>
                  <div className="field"><label htmlFor="a">Area in {city}</label><input id="a" name="area" autoComplete="off" placeholder="Where do you ride?" /></div>
                </div>
                <motion.button className="btn o lg" disabled={busy} style={{ width: '100%', marginTop: 16 }} whileTap={{ scale: .98 }}>{busy ? <><span className="spin" aria-hidden />Joining…</> : 'Join the waitlist'}</motion.button>
                <p style={{ color: 'var(--muted)', fontSize: 14, margin: '10px 0 0' }}>We use your number only to tell you when Mechanix Pro starts in {city}.</p>
              </motion.form>
            ) : (
              <motion.div key="ok" className="ok" role="status" aria-live="polite" initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }}>
                <motion.svg width="76" height="76" viewBox="0 0 76 76" initial="h" animate="s">
                  <motion.circle cx="38" cy="38" r="34" fill="none" stroke="#15803D" strokeWidth="5" variants={{ h: { pathLength: 0 }, s: { pathLength: 1 } }} transition={{ duration: .5 }} />
                  <motion.path d="M22 40 L33 51 L55 27" fill="none" stroke="#15803D" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" variants={{ h: { pathLength: 0 }, s: { pathLength: 1 } }} transition={{ delay: .4, duration: .4 }} />
                </motion.svg>
                <h2 style={{ fontSize: 28, marginTop: 14 }}>You are on the list</h2>
                <p style={{ color: 'var(--muted)', margin: '8px 0 0' }}>We will message you on WhatsApp the day we start in {city}.</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
          <div className="card"><h3 style={{ fontSize: 22, marginBottom: 10 }}>What to expect</h3>
            {['Price first: an itemised quote before work starts.', 'One-time code: your vehicle moves only with your code.', '30-day redo promise: same work fails, we redo it free.'].map((t, i) => (
              <motion.div key={t} initial={{ opacity: 0, x: 14 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * .12 }} style={{ padding: '9px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>{t}</motion.div>
            ))}
          </div>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ flex: 1 }}><b style={{ color: 'var(--navy)' }}>Nearest live city: {nearest}</b><div style={{ color: 'var(--muted)', fontSize: 14 }}>Book today in Karnataka.</div></div>
            <button className="btn p s" onClick={onOpenPicker}>Open {nearest}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
