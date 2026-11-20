import { motion, useScroll, useTransform } from 'motion/react';
import { ART, stateOf, isLive } from '../data.js';

const words = (t) => t.split(' ');
export default function Hero({ city, onBook, children }) {
  const live = isLive(city);
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, [0, 500], [0, 60]);
  const art = ART[city];
  const headline = live ? `Bike and car service at your door in ${city}.` : `We are coming to ${city} soon.`;
  return (
    <section className="hero">
      {art
        ? <motion.div className="hero-art" key={city} style={{ backgroundImage: `url(${art})`, y }} initial={{ opacity: 0, x: 50 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: .9, ease: [.2, .8, .2, 1] }} />
        : <div className="art-missing" aria-hidden>{city}</div>}
      <div className="wrap">
        <div className="hero-copy">
          <motion.span className={`pill${live ? '' : ' soon'}`} key={city + 'p'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .1 }}><i />{live ? `Live in ${city}, ${stateOf(city)}` : `${city}, ${stateOf(city)}: coming soon`}</motion.span>
          <h1 aria-label={headline} key={city + 'h'}>
            {words(headline).map((w, i) => (
              <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom', marginRight: '.24em' }}>
                <motion.span style={{ display: 'inline-block' }} initial={{ y: '105%' }} animate={{ y: 0 }} transition={{ delay: .15 + i * .055, duration: .6, ease: [.2, .8, .2, 1] }}>{w}</motion.span>
              </span>
            ))}
          </h1>
          <motion.p className="lead" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .55 }}>
            {live ? 'You see the full price first. Nothing starts until you say yes.' : 'Tell us where you are and what you ride. We will message you on WhatsApp the day we start.'}
          </motion.p>
          {live && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .65 }} style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="btn o lg" onClick={onBook}>Book a service</button><a className="btn lg" href="#services">See the rate card</a>
            </motion.div>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
