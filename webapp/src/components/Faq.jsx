import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FAQ } from '../data.js';

export default function Faq({ city }) {
  const [open, setOpen] = useState(0);
  return (
    <section className="blk" id="faq">
      <div className="wrap faqgrid">
        <div>
          <h2 style={{ fontSize: 'clamp(30px,3.4vw,42px)', fontWeight: 800 }}>Questions in {city}</h2>
          <p style={{ color: 'var(--muted)', margin: '10px 0 0', maxWidth: '34ch' }}>Not here? Message us. We are open 24/7 on WhatsApp.</p>
          <div className="help"><b style={{ color: 'var(--navy)' }}>Talk to the team</b><button className="btn g">Chat on WhatsApp</button><button className="btn">Call us</button></div>
        </div>
        <div>
          {FAQ.map(([q, a], i) => (
            <div className="faq" key={q}>
              <button aria-expanded={open === i} aria-controls={`f${i}`} onClick={() => setOpen(open === i ? -1 : i)}>
                {q}<motion.span aria-hidden animate={{ rotate: open === i ? 45 : 0 }} style={{ fontSize: 24, lineHeight: 1 }}>+</motion.span>
              </button>
              <AnimatePresence initial={false}>
                {open === i && <motion.div id={`f${i}`} initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: .25 }} style={{ overflow: 'hidden' }}><p>{a}</p></motion.div>}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
