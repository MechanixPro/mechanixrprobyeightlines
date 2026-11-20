import { useEffect, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from 'motion/react';
import { SERVICES, total, inr } from '../data.js';

function Money({ value }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => inr(Math.round(v * 100) / 100));
  useEffect(() => { const c = animate(mv, value, { duration: .5, ease: 'easeOut' }); return () => c.stop(); }, [value]);
  return <motion.span>{text}</motion.span>;
}
export default function Services({ city, picked, setPicked, onContinue }) {
  const sel = SERVICES.find((s) => s.id === picked);
  return (
    <section className="blk tint" id="services">
      <div className="wrap">
        <div className="sh"><div><h2>Popular services in {city}</h2><p>Bikes up to 149cc. Prices include GST in the total and are the same in every city.</p></div><a className="btn" href="#how">Full rate card</a></div>
        <div className="svcs" role="radiogroup" aria-label="Choose a service">
          {SERVICES.map((s) => {
            const on = picked === s.id;
            return (
              <motion.button key={s.id} role="radio" aria-checked={on} className={`svc${on ? ' on' : ''}`} onClick={() => setPicked(on ? null : s.id)}
                whileHover={{ y: -4 }} whileTap={{ scale: .985 }} transition={{ type: 'spring', stiffness: 400, damping: 26 }}>
                {on && <motion.span layoutId="ring" className="ring" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <h3>{s.name}{s.hot && <span className="tag">Most chosen</span>}</h3>
                <div className="pr">{inr(s.price)}<small> + GST</small></div>
                <div className="from">Total {inr(total(s.price))} with GST · {s.points} checkpoints</div>
                <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>
                <span className={`btn s ${on ? 'o' : 'p'}`} style={{ justifySelf: 'start', marginTop: 10 }}>{on ? '✓ Selected' : 'Select'}</span>
              </motion.button>
            );
          })}
        </div>
      </div>
      <AnimatePresence>
        {sel && (
          <motion.div className="sheet" role="region" aria-label="Your selection" initial={{ y: 120 }} animate={{ y: 0 }} exit={{ y: 120 }} transition={{ type: 'spring', stiffness: 360, damping: 32 }}>
            <div className="wrap">
              <div style={{ flex: 1 }}><b style={{ color: 'var(--navy)' }}>{sel.name}</b><div style={{ color: 'var(--muted)', fontSize: 14 }}>{inr(sel.price)} + GST {inr(Math.round(sel.price * .18 * 100) / 100)}. A small fee holds your slot and comes off the bill.</div></div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 30, fontWeight: 800, color: 'var(--navy)' }}><Money value={total(sel.price)} /></div>
              <button className="btn o lg" onClick={onContinue}>Continue to slot</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
