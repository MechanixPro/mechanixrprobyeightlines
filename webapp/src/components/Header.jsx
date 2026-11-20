import { ChevronDown, MapPin } from 'lucide-react';
import logo from '../assets/logo-mark.png';
import { stateOf } from '../data.js';

export default function Header({ city, onPick, onBook }) {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <div className="strip"><div className="wrap"><span>Open 24/7 on WhatsApp. Quote first, work only after you say yes.</span><span>Track booking · Help</span></div></div>
      <header className="top">
        <div className="wrap">
          <div className="brand" translate="no"><img src={logo} alt="" width="36" height="36" />MECHANIX PRO</div>
          <button className="loc" onClick={onPick} aria-haspopup="dialog" aria-label={`Location: ${city}. Change`}>
            <MapPin size={18} color="#F2801F" aria-hidden /><span>{city}<small>{stateOf(city)}</small></span><ChevronDown size={16} aria-hidden />
          </button>
          <div className="search" role="search">Search services, for example “brake”…</div>
          <nav className="links" aria-label="Main"><a href="#services">Bike</a><a href="#services">Car</a><a href="#areas">Areas</a><a href="#faq">Help</a></nav>
          <button className="btn g s">WhatsApp</button>
          <button className="btn o s" onClick={onBook}>Book</button>
          <button className="btn p s">Log in</button>
        </div>
      </header>
    </>
  );
}
