import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import Header from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import BookingBox from './components/BookingBox.jsx';
import Steps from './components/Steps.jsx';
import Services from './components/Services.jsx';
import Areas from './components/Areas.jsx';
import Faq from './components/Faq.jsx';
import Promises from './components/Promises.jsx';
import ComingSoon from './components/ComingSoon.jsx';
import CityPicker from './components/CityPicker.jsx';
import Footer from './components/Footer.jsx';
import BookingFlow from './components/BookingFlow.jsx';
import { ART, isLive } from './data.js';

export default function App() {
  const [city, setCity] = useState(() => new URLSearchParams(location.search).get('city') || 'Bengaluru');
  const [picker, setPicker] = useState(new URLSearchParams(location.search).get('picker') === '1');
  const [picked, setPicked] = useState(new URLSearchParams(location.search).get('pick') || null);
  const qs = new URLSearchParams(location.search);
  const [flow, setFlow] = useState(qs.get('step') !== null ? { step: Number(qs.get('step')) || 0, service: qs.get('svc') } : null);
  const live = isLive(city);
  useEffect(() => { document.title = live ? `Bike and car service in ${city} | Mechanix Pro` : `Coming soon to ${city} | Mechanix Pro`; window.scrollTo(0, 0); }, [city]);
  const choose = (c) => { setCity(c); setPicked(null); setPicker(false); };
  return (
    <MotionConfig reducedMotion="user">
      <Header city={city} onPick={() => setPicker(true)} onBook={() => live && setFlow({ step: 0, service: null })} />
      {flow && live ? (
        <main id="main"><BookingFlow city={city} startStep={flow.step} startService={flow.service} onClose={() => { setFlow(null); const u = new URL(location.href); u.searchParams.delete('step'); history.replaceState(null, '', u); }} /></main>
      ) : (
      <main id="main">
        <Hero city={city} onBook={() => setFlow({ step: 0, service: null })} />
        {live && <BookingBox onSee={() => document.getElementById('services')?.scrollIntoView({ behavior: 'smooth' })} />}
        <AnimatePresence mode="wait">
          <motion.div key={city} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {live ? (<><Steps /><Services city={city} picked={picked} setPicked={setPicked} onContinue={() => setFlow({ step: 2, service: picked })} /><Promises /><Areas city={city} /><Faq city={city} /></>) : <ComingSoon city={city} onOpenPicker={() => setPicker(true)} />}
          </motion.div>
        </AnimatePresence>
        <div className="skyline" aria-hidden style={{ backgroundImage: `url(${ART[city] || ART.Bengaluru})`, backgroundPosition: city === 'Delhi' ? 'center 47%' : 'center 26%' }} />
      </main>
      )}
      <Footer />
      <CityPicker open={picker} current={city} onClose={() => setPicker(false)} onPick={choose} />
    </MotionConfig>
  );
}
