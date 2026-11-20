import { motion } from 'motion/react';

const STEPS = [
  ['Choose and book', 'Pick your vehicle and service. Pay a small fee that comes off your bill.'],
  ['We confirm your slot', 'A partner garage or mechanic is assigned and you get their details.'],
  ['Approve the quote', 'Itemised on WhatsApp. Extra work starts only after your yes.'],
  ['Pay, invoice, warranty', 'GST invoice, and a 30-day redo promise on the work.'],
];
// The numbers are a real sequence: the rail draws left to right once, and each step lands as the rail reaches it.
export default function Steps() {
  return (
    <section className="blk" id="how">
      <div className="wrap">
        <div className="sh"><div><h2>How it works</h2><p>Four steps. You can follow every one on your private tracking page.</p></div></div>
        <ol className="steps2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {STEPS.map(([t, d], i) => (
            <li className="col" key={t}>
              {i < STEPS.length - 1 && <motion.i className="seg" aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true, margin: '-40px' }} transition={{ delay: i * .32 + .25, duration: .32, ease: 'easeInOut' }} />}
              <motion.div className="n" initial={{ scale: .5, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * .32, type: 'spring', stiffness: 420, damping: 18 }}>{i + 1}</motion.div>
              <motion.div className="cardx" initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ delay: i * .32 + .1, duration: .45 }}>
                <b>{t}</b><span className="d">{d}</span>
              </motion.div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
