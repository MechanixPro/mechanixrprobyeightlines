import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { STATES } from '../data.js';

export default function CityPicker({ open, current, onClose, onPick }) {
  const [q, setQ] = useState('');
  const input = useRef(null);
  useEffect(() => {
    if (!open) return;
    setQ(''); input.current?.focus();
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', key); document.body.style.overflow = ''; };
  }, [open]);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return STATES.map((s) => ({ ...s, cities: s.cities.filter(([c]) => !t || c.toLowerCase().includes(t) || s.name.toLowerCase().includes(t)) })).filter((s) => s.cities.length);
  }, [q]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div role="dialog" aria-modal="true" aria-label="Choose your city" className="picker"
            initial={{ opacity: 0, y: 24, x: '-50%', scale: .98 }} animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }} exit={{ opacity: 0, y: 16, x: '-50%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
            <div className="pk-head">
              <div style={{ flex: 1 }}><h2 style={{ fontSize: 30 }}>Choose your city</h2><p style={{ margin: '4px 0 0', color: 'var(--muted)' }}>A green dot means we are live there. Other cities open a waitlist.</p></div>
              <button className="btn s" onClick={onClose} aria-label="Close">Close</button>
            </div>
            <div className="pk-head">
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a state or city…" name="city-search" autoComplete="off" spellCheck={false} aria-label="Search a state or city"
                style={{ flex: 1, border: '1px solid #CBD5E1', borderRadius: 12, padding: '12px 14px', font: 'inherit' }} />
              <button className="btn o" onClick={() => onPick('Bengaluru')}>Use my location</button>
            </div>
            <motion.div className="states" layout>
              <AnimatePresence mode="popLayout">
                {list.map((s, i) => (
                  <motion.div key={s.name} layout className="st" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: .96 }} transition={{ delay: i * .025 }}>
                    <h4>{s.name}</h4>
                    {s.cities.map(([c, live]) => (
                      <motion.button key={c} className={`cty${live ? ' live' : ''}${c === current ? ' cur' : ''}`} onClick={() => onPick(c)} whileTap={{ scale: .95 }}>
                        <i />{c}{!live && <small>soon</small>}
                      </motion.button>
                    ))}
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
            {!list.length && <p style={{ color: 'var(--muted)' }}>No match. We add new cities in waves; tell us yours on the waitlist.</p>}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
