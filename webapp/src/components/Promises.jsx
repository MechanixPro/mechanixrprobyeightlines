import { motion } from 'motion/react';
import { Camera, FileText, LockKeyhole, RotateCcw } from 'lucide-react';

const I = { quote: <FileText aria-hidden />, code: <LockKeyhole aria-hidden />, photo: <Camera aria-hidden />, redo: <RotateCcw aria-hidden /> };
const P = [
  ['quote', 'Quote first', 'An itemised price before any work starts.'],
  ['code', 'One-time code', 'Your vehicle moves only with your code.'],
  ['photo', 'Photos and old parts', 'See the work, and the old parts, before you pay.'],
  ['redo', '30-day redo promise', 'If the same work fails in 30 days, we redo it free.'],
];
export default function Promises() {
  return (
    <section className="blk tint" id="promises"><div className="wrap">
      <div className="sh"><div><h2>What we promise on every job</h2></div></div>
      <div className="prom">
        {P.map(([k, t, d], i) => (
          <motion.div key={k} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * .08 }}>
            {I[k]}<b>{t}</b><span>{d}</span>
          </motion.div>
        ))}
      </div>
    </div></section>
  );
}
