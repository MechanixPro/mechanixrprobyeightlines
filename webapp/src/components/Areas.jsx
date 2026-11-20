import { useState } from 'react';
import { motion } from 'motion/react';
import { AREAS } from '../data.js';

export default function Areas({ city }) {
  const [hot, setHot] = useState(null);
  const list = AREAS[city] || [];
  return (
    <section className="blk" id="areas">
      <div className="wrap areas">
        <div>
          <div className="sh" style={{ marginBottom: 16 }}><div><h2>Areas we serve in {city}</h2><p>Point at an area to find it on the map. The real list comes from the PIN code table.</p></div></div>
          <div className="chips">
            {list.map(([a], i) => (
              <motion.button key={a} className="chip" onMouseEnter={() => setHot(a)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(a)} onBlur={() => setHot(null)}
                initial={{ opacity: 0, scale: .9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: i * .04 }}
                style={hot === a ? { background: 'var(--ember)', borderColor: 'var(--ember)', color: '#1A0E03' } : undefined}>
                <i style={hot === a ? { background: '#1A0E03' } : undefined} />{a}
              </motion.button>
            ))}
          </div>
        </div>
        <div className="map" role="img" aria-label={`Map of areas in ${city}`}>
          <i className="road" style={{ left: '8%', right: '6%', top: '47%', height: 6, transform: 'rotate(-14deg)' }} />
          <i className="road" style={{ left: '30%', top: '6%', bottom: '10%', width: 6, transform: 'rotate(12deg)' }} />
          <i className="road" style={{ left: '8%', right: '30%', top: '72%', height: 6, transform: 'rotate(7deg)' }} />
          <div className="legend"><span><i />Area we serve</span><span><i className="o" />Selected</span></div>
          {list.map(([a, x, y], i) => (
            <motion.div key={a} className="pinw" style={{ left: `${x}%`, top: `${y}%` }}
              initial={{ y: -30, opacity: 0 }} whileInView={{ y: 0, opacity: 1 }} viewport={{ once: true }} transition={{ type: 'spring', stiffness: 380, damping: 15, delay: .1 + i * .07 }}>
              <motion.span className={`pin${hot === a ? ' hot' : ''}`} animate={hot === a ? { scale: 1.35 } : { scale: 1 }} />
              {hot !== a && <span className="lbl" style={{ top: 30, fontWeight: 600, background: 'rgba(255,255,255,.78)' }}>{a}</span>}
              {hot === a && <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} style={{ position: 'absolute', left: '50%', bottom: 34, transform: 'translateX(-50%)', background: 'var(--navy)', color: '#fff', borderRadius: 8, padding: '4px 10px', fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>{a}</motion.div>}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
