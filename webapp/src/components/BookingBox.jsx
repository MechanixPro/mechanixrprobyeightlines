import { useState } from 'react';
import { motion } from 'motion/react';

const MODELS = { Bike: ['Honda Activa 6G', 'TVS Jupiter', 'Bajaj Pulsar 150', 'Royal Enfield Classic 350'], Car: ['Maruti Swift', 'Hyundai i20', 'Honda City'] };
export default function BookingBox({ onSee }) {
  const [kind, setKind] = useState('Bike');
  return (
    <motion.form className="book" onSubmit={(e) => { e.preventDefault(); onSee(); }}
      initial={{ opacity: 0, y: 36 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 220, damping: 24, delay: .55 }}>
      <div className="seg" role="tablist" aria-label="Vehicle type">
        {['Bike', 'Car'].map((k) => (
          <button type="button" key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {kind === k && <motion.span layoutId="seg" className="ind" style={{ inset: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 36 }} />}
            <span style={{ position: 'relative', zIndex: 1 }}>{k}</span>
          </button>
        ))}
      </div>
      <div className="field"><label htmlFor="mdl">Brand and model</label>
        <select id="mdl" key={kind}>{MODELS[kind].map((m) => <option key={m}>{m}</option>)}</select></div>
      <div className="field"><label htmlFor="when">Day and time</label>
        <select id="when"><option>Sat 21 Nov, morning</option><option>Sat 21 Nov, afternoon</option><option>Sun 22 Nov, morning</option></select></div>
      <motion.button className="btn o lg" type="submit" whileHover={{ y: -2 }} whileTap={{ scale: .97 }}>See prices</motion.button>
    </motion.form>
  );
}
