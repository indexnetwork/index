'use client';
import { useEffect, useRef, useState } from 'react';
import Nav, { ensureLandingFonts } from '@/app/landing/Nav';
import Footer from '@/app/landing/Footer';
import '@/app/landing/landing.css';
import { apiUrl } from '@/lib/api';

// ── Found in Translation -1: Superstudio / Continuous Monument ──
// Inspired by Superstudio's 1969 Continuous Monument: a white megastructure
// with a grid, superimposed over any landscape. Architecture as protocol.
// The monument doesn't end. The grid continues. Intent travels the surface.

const KF = `
  @keyframes ticker {
    from { transform: translateX(0); }
    to   { transform: translateX(-50%); }
  }
  @keyframes blinkHard {
    0%,49%  { opacity: 1; }
    50%,100% { opacity: 0; }
  }
  @keyframes marchRight {
    from { background-position: 0 0; }
    to   { background-position: 60px 0; }
  }
`;

const SANS = "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace";

const PALETTE = {
  bg: '#0b1612',
  cream: '#F4FBF6',
  creamSoft: 'rgba(244, 251, 246, 0.78)',
  creamFaint: 'rgba(244, 251, 246, 0.5)',
  rule: 'rgba(244, 251, 246, 0.22)',
  ruleStrong: 'rgba(244, 251, 246, 0.45)',
};

function useScrollProgress() {
  const [p, setP] = useState(0);
  useEffect(() => {
    const h = () => {
      const d = document.documentElement;
      setP(d.scrollTop / (d.scrollHeight - d.clientHeight) || 0);
    };
    addEventListener('scroll', h, { passive: true });
    return () => removeEventListener('scroll', h);
  }, []);
  return p;
}

function useFadeIn(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!ref.current) return;
    const els = ref.current.querySelectorAll<HTMLElement>('[data-fade]');
    const io = new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const el = e.target as HTMLElement;
          el.style.transitionDelay = `${el.dataset.delay ?? 0}ms`;
          el.style.opacity = '1';
          el.style.transform = 'none';
        }),
      { threshold: 0.05 },
    );
    els.forEach((el) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(24px)';
      el.style.transition = 'opacity .6s ease, transform .6s ease';
      io.observe(el);
    });
    return () => io.disconnect();
  }, [ref]);
}

// ── PROTOCOL CORRIDOR CANVAS ────────────────────────────────────────
// Original artwork inspired by Superstudio's Continuous Monument.
// Two massive gridded slab-walls converge to a vanishing point, framing
// a corridor that represents the protocol connecting human intent.
// The "ground" below is a network landscape of nodes and connections.
// ── THE MONUMENT CANVAS (original, kept as fallback) ─────────────────
// ── ARCH CALLOUT ────────────────────────────────────────────────
// ── FIG 01: THE CONVERSATION ────────────────────────────────────
// Architectural elevation of two humans with intent lattice between them
// ── FIG 02: FUTILITY OF SEARCH ──────────────────────────────────
// One figure facing an infinite perspective wall of identical search results
// ── THE MONUMENT ELEVATION ──────────────────────────────────────
// Full-bleed SVG: the Continuous Monument face-on in architectural elevation.
// A white slab with grid, extending infinitely left and right.
// Tiny scale figures at the base. Architectural dimension notation.
// ── FIG 03: CLI ERA ──────────────────────────────────────────────
function InterfaceEvolutionFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(244, 251, 246, 0.22)', overflow: 'hidden' }}>
      <img src="/found-in-translation/CLI.png" alt="CLI era terminal" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </figure>
  );
}

// ── FIG 04: GUI ERA ──────────────────────────────────────────────
function GuiEraFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(244, 251, 246, 0.22)', overflow: 'hidden' }}>
      <img src="/found-in-translation/GUI.jpg" alt="GUI era interface" style={{ display: 'block', width: '100%', height: 'auto' }} />
    </figure>
  );
}

// ── FIG 05: BEFORE / AFTER ──────────────────────────────────────
function BeforeAfterFig() {
  return (
    <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(244, 251, 246, 0.22)', background: '#fff', overflow: 'hidden' }}>
      <svg viewBox="0 0 800 260" width="100%" style={{ display: 'block' }} aria-label="Before and after: keyword search vs expressive intent">
        {/* backgrounds first */}
        <rect x="0" y="0" width="400" height="260" fill="#fff" />
        <rect x="400" y="0" width="400" height="260" fill="#fff" />

        {/* left content */}
        <text x="40" y="52" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="#aaa">BEFORE</text>
        {/* keyword tags */}
        <rect x="40" y="66" width="152" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="116" y="82" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">creative technologist</text>
        <rect x="200" y="66" width="140" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="270" y="82" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">software engineers</text>
        <rect x="40" y="98" width="50" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="65" y="114" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">nyc</text>
        <rect x="98" y="98" width="56" height="24" rx="12" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="126" y="114" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="10" fill="#999" textAnchor="middle">saas</text>

        {/* right content */}
        <text x="440" y="52" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="9" letterSpacing="2" fill="#aaa">NOW</text>
        <rect x="440" y="68" width="320" height="88" rx="3" fill="#fff" stroke="#ccc" strokeWidth="1.5" />
        <text x="456" y="89" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">&quot;I&apos;m a 0-1 builder who likes to stay close</text>
        <text x="456" y="105" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">to consumer culture — looking for a team</text>
        <text x="456" y="121" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">working on something new and weird,</text>
        <text x="456" y="137" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="11" fill="#555" fontStyle="italic">probably pre-seed or seed.&quot;</text>

        {/* divider — drawn after content but before arrow */}
        <line x1="400" y1="0" x2="400" y2="260" stroke="#ccc" strokeWidth="1.5" />

        {/* arrow button — drawn last so it sits on top */}
        <circle cx="400" cy="112" r="22" fill="#000" />
        <line x1="389" y1="112" x2="407" y2="112" stroke="#fff" strokeWidth="2" />
        <polygon points="405,107 405,117 414,112" fill="#fff" />

        <text x="20" y="252" fontFamily="'JetBrains Mono', ui-monospace, monospace" fontSize="8" letterSpacing="1.8" fill="#000" opacity="0.2">FIG. 05 — INTENT EXPRESSION · KEYWORD → CONTEXT-RICH</text>
      </svg>
    </figure>
  );
}

// ── AGENT NETWORK PLAN ──────────────────────────────────────────
// Architectural PLAN VIEW (top-down) of the agent network.
// Looks like a floor plan where the "rooms" are network nodes.
// ── STRUCTURE CARD ──────────────────────────────────────────────
const FLOW = [
  { t: 'A human expresses intent', d: 'Raw, unfiltered — in their own language' },
  { t: 'Their agent encodes it', d: 'Context, nuance, and goals preserved' },
  { t: 'Agents discover overlapping intents', d: 'Scanning the network continuously, quietly' },
  { t: 'They negotiate compatibility', d: 'Silent, tireless, on your behalf' },
  { t: 'They disclose appropriately', d: 'Availability, context, relevant files — shared selectively' },
  { t: 'They consult memory and peers', d: 'Gossip, reputation, trust signals weighed' },
  { t: 'An opportunity becomes legible', d: 'Intent, context, trust, and timing finally align' },
  { t: 'Humans are invited in', d: 'The door opens at the right moment' },
  { t: 'Humans decide: go or no-go', d: 'The final say is always yours' },
  { t: 'If go, conversation initiated', d: 'A new connection begins' },
];

export default function FoundInTranslationPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const progress = useScrollProgress();
  useFadeIn(pageRef as React.RefObject<HTMLElement>);

  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({ name: '', email: '', whatYouDo: '', whoToMeet: '' });
  const [waitlistStatus, setWaitlistStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isWaitlistOpen && waitlistStatus !== 'loading') setIsWaitlistOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isWaitlistOpen, waitlistStatus]);

  useEffect(() => {
    const open = () => setIsWaitlistOpen(true);
    window.addEventListener('openWaitlistModal', open);
    return () => window.removeEventListener('openWaitlistModal', open);
  }, []);

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistForm.email || !waitlistForm.name) return;
    setWaitlistStatus('loading');
    try {
      const res = await fetch(apiUrl('/api/subscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: waitlistForm.email, type: 'waitlist', name: waitlistForm.name, whatYouDo: waitlistForm.whatYouDo, whoToMeet: waitlistForm.whoToMeet }),
      });
      setWaitlistStatus(res.ok ? 'success' : 'error');
    } catch {
      setWaitlistStatus('error');
    }
  };

  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Found in Translation | Index Network';

    const setMeta = (name: string, content: string, attr = 'name') => {
      let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
      return el;
    };

    const description = 'Some things find you. Most don\'t. That is, until language became our new interface and agents became our calling cards.';
    const origin = window.location.origin;
    const url = `${origin}/found-in-translation`;
    const image = `${origin}/found-in-translation/found-in-translation-1-hero.png`;

    setMeta('description', description);
    setMeta('og:type', 'article', 'property');
    setMeta('og:title', 'Found in Translation | Index Network', 'property');
    setMeta('og:description', description, 'property');
    setMeta('og:url', url, 'property');
    setMeta('og:image', image, 'property');
    setMeta('twitter:card', 'summary_large_image');
    setMeta('twitter:title', 'Found in Translation | Index Network');
    setMeta('twitter:description', description);
    setMeta('twitter:image', image);

    return () => {
      document.title = prevTitle;
    };
  }, []);

  const P: React.CSSProperties = {
    fontFamily: SANS,
    fontSize: 'max(18px, 1.2rem)', lineHeight: 1.5, color: PALETTE.creamSoft, marginBottom: '0.8rem',
  };
  const WRAP: React.CSSProperties = { maxWidth: 720, margin: '0 auto', padding: '0 2rem' };

  useEffect(() => {
    ensureLandingFonts();
  }, []);

  return (
    <div ref={pageRef} className="landing" style={{ background: PALETTE.bg, color: PALETTE.cream, minHeight: '100vh', overflowX: 'hidden', fontFamily: SANS }}>
      <style>{KF}</style>

      {isWaitlistOpen && (
        <div
          className="landing-modal"
          role="dialog"
          aria-modal="true"
          onClick={() => waitlistStatus !== 'loading' && setIsWaitlistOpen(false)}
        >
          <div className="landing-modal-backdrop" aria-hidden="true" />
          <div className="landing-modal-card" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="landing-modal-close"
              onClick={() => setIsWaitlistOpen(false)}
              disabled={waitlistStatus === 'loading'}
              aria-label="Close"
            >
              ×
            </button>
            {waitlistStatus === 'success' ? (
              <div className="landing-modal-success">
                <h3 className="landing-modal-title">you&apos;re on the list</h3>
                <p className="landing-modal-lede">Check your inbox for your welcome email.</p>
                <button
                  type="button"
                  className="landing-modal-submit"
                  onClick={() => { setIsWaitlistOpen(false); setWaitlistStatus('idle'); setWaitlistForm({ name: '', email: '', whatYouDo: '', whoToMeet: '' }); }}
                >
                  Close
                </button>
              </div>
            ) : (
              <>
                <h3 className="landing-modal-title">join the waitlist</h3>
                <p className="landing-modal-lede">
                  Tell us a bit about yourself — we&rsquo;ll let you know when we&rsquo;re live and keep you posted on updates.
                </p>
                <form onSubmit={handleWaitlistSubmit} className="landing-modal-form">
                  <label className="landing-modal-label" htmlFor="fit-waitlist-name">
                    Name<span className="landing-modal-req">*</span>
                  </label>
                  <input
                    type="text"
                    id="fit-waitlist-name"
                    className="landing-modal-input"
                    value={waitlistForm.name}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, name: e.target.value })}
                    required
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="landing-modal-label" htmlFor="fit-waitlist-email" style={{ marginTop: 10 }}>
                    Email<span className="landing-modal-req">*</span>
                  </label>
                  <input
                    type="email"
                    id="fit-waitlist-email"
                    className="landing-modal-input"
                    value={waitlistForm.email}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                    required
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="landing-modal-label" htmlFor="fit-waitlist-whatYouDo" style={{ marginTop: 10 }}>
                    What do you do?
                  </label>
                  <input
                    type="text"
                    id="fit-waitlist-whatYouDo"
                    className="landing-modal-input"
                    value={waitlistForm.whatYouDo}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, whatYouDo: e.target.value })}
                    disabled={waitlistStatus === 'loading'}
                  />

                  <label className="landing-modal-label" htmlFor="fit-waitlist-whoToMeet" style={{ marginTop: 10 }}>
                    Who do you want to meet?
                  </label>
                  <textarea
                    id="fit-waitlist-whoToMeet"
                    className="landing-modal-input"
                    style={{ resize: 'vertical', minHeight: 80 }}
                    value={waitlistForm.whoToMeet}
                    onChange={(e) => setWaitlistForm({ ...waitlistForm, whoToMeet: e.target.value })}
                    rows={3}
                    disabled={waitlistStatus === 'loading'}
                  />

                  {waitlistStatus === 'error' && (
                    <p className="landing-modal-error">Something went wrong. Please try again.</p>
                  )}

                  <button
                    type="submit"
                    className="landing-modal-submit"
                    disabled={waitlistStatus === 'loading'}
                  >
                    {waitlistStatus === 'loading' ? 'Submitting…' : 'Join the waitlist'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 100, background: PALETTE.rule }}>
        <div style={{ height: '100%', width: `${progress * 100}%`, background: PALETTE.cream, transition: 'width 0.1s linear' }} />
      </div>

      <section style={{ position: 'relative', minHeight: '100vh', overflow: 'hidden', borderBottom: `1px solid ${PALETTE.ruleStrong}`, display: 'flex', flexDirection: 'column' }}>
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10 }}>
          <Nav />
        </div>
        <img
          src="/found-in-translation/found-in-translation-1-hero.png"
          alt="Monumental grid-plane emerging across a city skyline at dusk"
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center top', zIndex: 0 }}
        />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.1) 55%, transparent 100%)', zIndex: 1 }} />
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1, pointerEvents: 'none' }} preserveAspectRatio="none">
          {[0.25, 0.5, 0.75].map((t, i) => (
            <line key={i} x1="0" y1={`${t * 100}%`} x2="100%" y2={`${t * 100}%`} stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          {[0.2, 0.4, 0.6, 0.8].map((t, i) => (
            <line key={i} x1={`${t * 100}%`} y1="0" x2={`${t * 100}%`} y2="100%" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          ))}
          <g stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" fill="none">
            <line x1="16" y1="64" x2="48" y2="64" /><line x1="16" y1="64" x2="16" y2="96" />
            <line x1="calc(100% - 16)" y1="64" x2="calc(100% - 48)" y2="64" /><line x1="calc(100% - 16)" y1="64" x2="calc(100% - 16)" y2="96" />
          </g>
        </svg>



        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderTop: `1px solid ${PALETTE.rule}`, height: 36, background: 'rgba(11, 22, 18, 0.7)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', padding: '0 1.5rem', gap: '2rem', zIndex: 5 }}>
          <span style={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', color: PALETTE.creamFaint }}>NEW YORK 2026</span>
          <div style={{ flex: 1, height: 1, background: PALETTE.rule }} />
          <span style={{ fontFamily: MONO, fontSize: '0.48rem', letterSpacing: '0.14em', color: PALETTE.creamFaint }}>INDEX NETWORK · FOUND IN TRANSLATION</span>
        </div>
      </section>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <p data-fade style={{ fontFamily: SANS, fontWeight: 700, fontSize: 'clamp(2.2rem,5vw,4.8rem)', lineHeight: 0.95, letterSpacing: '-0.04em', color: PALETTE.cream, marginBottom: '1.75rem' }}>
          Found in Translation
        </p>
        <p data-fade style={{ ...P, marginBottom: 0 }}>
          Some things find you. Most don&apos;t.
          <br />
          <br />
          They hide away in secret conversations with old coworkers on sunny patios, between rounds of margaritas that bring out what you want, what you really really want. A new job, a new <em>something</em> that&apos;ll take you somewhere you&apos;re actually excited to go.
        </p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <figure data-fade style={{ margin: '2rem 0', border: '1px solid rgba(244, 251, 246, 0.22)', background: '#fff', overflow: 'hidden' }}>
          <img
            src="/found-in-translation/diagram1.jpeg"
            alt="Two people in conversation diagram"
            style={{ display: 'block', width: '100%', height: 'auto' }}
          />
        </figure>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 0' }}>
        <p data-fade style={P}>You might sleep on your vague desires, wake up, and start searching for someone who might just share your flavor of weird.</p>
        <p data-fade style={P}>You would think it gets easier—that technology was meant to help the stars align and show us the idea at the tip of our tongue, or deliver us the role that doesn&apos;t exist yet, or the investor who gets it.</p>
        <p data-fade style={P}>For most of computing history, there was no system elastic enough to hold that kind of ambiguity in our personal and professional growth. Telepathy with computers was still out of reach.</p>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <h2 style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, margin: 0 }}>
          Somewhere along the way, we got lost in translation
        </h2>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>The thing is, computers are good at seeing what&apos;s already taken form. But human experience begins before inputs and outputs. As Edmund Husserl describes, consciousness is always oriented toward something, often before we know what the <em>what</em> is. It&apos;s like how the next opportunity ahead is often illegible to ourselves—until it arrives as the email we&apos;ve been waiting for.</p>
        <p data-fade style={P}>As anyone who&apos;s ever looked for a new job knows, having the intent to switch jobs is easy. Expressing it in a way that&apos;s legible to others and successful in actually getting it is a different story.</p>
        <p data-fade style={P}>Of course, we try. We build and inhabit semantic structures together to achieve our goals. Or, we use our words.</p>
      </div>
      <div data-fade style={{ maxWidth: 1000, margin: '0 auto', padding: '0.2rem 2rem 1rem', textAlign: 'center' }}>
        <p style={{ fontFamily: SANS, fontStyle: 'italic', fontWeight: 300, fontSize: 'clamp(1rem,2vw,1.5rem)', color: PALETTE.cream, lineHeight: 1.4, letterSpacing: '-0.01em', margin: '0 auto' }}>
          &ldquo;When we say that meanings materialize, we mean that sensemaking is, importantly, an issue of language, talk, and communication. Situations, organizations, and environments are talked into existence.&rdquo;
        </p>
        <div style={{ fontFamily: MONO, fontSize: '0.72rem', letterSpacing: '0.06em', color: PALETTE.creamFaint, margin: '0.75rem 0 0', lineHeight: 1.7, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>Andrew Hinton, Understanding Context: Environment, Language, and Information Architecture (2014)</div>
      </div>
      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>Over time, tools expanded the scope of opportunity. From telegraphs and telephones in the 1800s, to command line interfaces and graphic user interfaces in the 1900s, oh my! Now language could travel. But there was always a caveat:</p>
        <p data-fade style={P}>Computers did not operate on raw human intent, only its translation.</p>
        <p data-fade style={P}>In the command line era, this translation was explicit and exacting, forcing the user to clearly specify their intent in symbolic form. This is hard work that most of us don&apos;t have energy for.</p>
      </div>


      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <InterfaceEvolutionFig />
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>With the rise of GUI-based systems, this burden shifted to the operating system and its designers.</p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <GuiEraFig />
      </div>

      <div style={{ ...WRAP, padding: '1.5rem 2rem 0' }}>
        <p data-fade style={P}>This made computers easier to use, but it also increased the distance between intent and execution. Digital agents operate in environments with the richest bits of context pruned out. Say you&apos;re looking for <em>that partner in crime who&apos;s a compatible type of internet nerd but more organized than me</em>. You won&apos;t find them through filters and keywords.</p>
        <p data-fade style={P}>And so for most of computing history, tools have only been able to interact with the habitual layer of human intent. The part that captures what someone did, not necessarily what they meant.</p>
        <p data-fade style={P}>We might&apos;ve found our successes but translation at its best is still reductive. But what if... translation could carry the original intent?</p>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 1rem' }}>
        <h2 style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, margin: 0 }}>
          Language is the new interface
        </h2>
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>Now instead of searching through platforms and engines, we&apos;re talking to LLMs. The translation tax that defined prior interfaces is slowly being absorbed by stronger infrastructure. We can feel it every time we send a stream of consciousness voice memo to Claude or Gemini or GPT, and make it interpret us instead of the other way around.</p>
      </div>

      <div style={{ ...WRAP, padding: '0 2rem' }}>
        <BeforeAfterFig />
      </div>

      <div style={{ ...WRAP, padding: '1rem 2rem 1rem' }}>
        <p data-fade style={P}>For the first time, systems can engage with the model-based, context-sensitive layer of human decision-making: the layer where intent actually lives. With language as computational substrate, digital agents can now hold context the way a trusted partner does, to the extent of what you share.</p>
        <p data-fade style={P}>This redistributes influence. While platforms once brokered most of our professional connections, their grip loosens when the work is distributed among individual agents, navigating the highways of the open internet.</p>
        <p data-fade style={P}>But simply chatting to an agent still treats intent as an input to be immediately executed. Unlocking hidden opportunity requires a broader system of coordination, like a <em>&ldquo;have your agent call my agent&rdquo;</em> system.</p>
        <p data-fade style={P}>It&apos;s not about a better matching algorithm, but reconsidering the way we think about finding our others. Say you&apos;re Zendaya on the lookout for your next Oscar-winning gig. You have a heart to heart with your agent, who then goes out to scope and gossip with the other agents on what&apos;s possible.</p>
        <p data-fade style={P}>What that system correctly factors in is—sometimes opportunities need privacy before visibility. They need space to take shape, a place to putter around before parading outside on external platforms. This is where agents can protect early privacy, or share interests selectively as appropriate.</p>
        <p data-fade style={P}>With the agentic web growing, we&apos;re also seeing agents congregate around their own water coolers to loiter and gossip on behalf of their users. Built by humans, they mirror human dynamics—sharing some things with close peers and broadcasting others to the larger networks.</p>
        <p data-fade style={P}>And that private sharing yields interesting, often unexpected results. Like when you mention a new idea over coffee to a new friend, and they have just the right person for you to talk to. A new opportunity unlocked. Imagine that interaction, that potential for serendipity—now between agents. Repeatable.</p>
        <p data-fade style={P}>So what might the mechanism for that look like? What if we could program intent into the opportunities we desired?</p>
      </div>

      <div>
        <div style={{ ...WRAP, padding: '4rem 2rem 0' }}>
          <h2 data-fade style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, marginBottom: '2rem' }}>
            The emerging model of social coordination
          </h2>

          <div style={{ margin: '2rem 0' }}>
            {FLOW.map((step, i) => (
              <div key={i} data-fade data-delay={String(i * 50)} style={{ display: 'flex', alignItems: 'baseline', gap: '1rem', padding: '0.6rem 0', borderBottom: i < FLOW.length - 1 ? `1px dashed ${PALETTE.rule}` : 'none' }}>
                <span style={{ fontFamily: MONO, fontSize: '0.7rem', color: PALETTE.creamFaint, letterSpacing: '0.1em', flexShrink: 0, paddingTop: '0.15rem' }}>{String(i + 1).padStart(2, '0')}</span>
                <p style={{ fontFamily: SANS, fontSize: 'clamp(0.95rem,1.5vw,1.05rem)', color: PALETTE.cream, lineHeight: 1.6, margin: 0 }}>
                  {step.t}<span style={{ color: PALETTE.creamSoft }}> — {step.d}</span>
                </p>
              </div>
            ))}
          </div>

          <p data-fade style={P}>The human sets the initial judgment and gives the green light on any proposed connections. Agents are autonomous in facilitating, not deciding. They coordinate the magic you&apos;d orchestrate if you had infinite time and energy, or lived in a seaside country with a strong social safety net.</p>
          <p data-fade style={P}>And they collaborate. They negotiate. They gossip. Not the drama queen type of gossip but the strategic-cooperation-as-end-goal type, always outcome oriented: <em>Did the person show up? Did the conversation go anywhere? Did expectations match reality or was this a lurker in his mom&apos;s basement?</em></p>
          <p data-fade style={P}>This flow takes more than training a better model. It needs an operating protocol for cooperation—standard procedures for agent-to-agent relationships that compound over time.</p>
          <p data-fade style={P}>With that degree of relational infrastructure to support your growth, opportunities emerge that you&apos;d never have found on your own.</p>
        </div>
      </div>

      <div style={{ ...WRAP, padding: '4rem 2rem 4rem' }}>
        <h2 data-fade style={{ fontFamily: SANS, fontWeight: 300, fontSize: 'clamp(1.6rem,4.5vw,3.5rem)', lineHeight: 1.05, letterSpacing: '-0.03em', color: PALETTE.cream, marginBottom: '1.5rem' }}>
          Entering ambient optimism
        </h2>
        <p data-fade style={P}>So that coffee shop moment—when you ask someone at the next table over for the wifi password, who then becomes your next idea partner—becomes possible online.</p>
        <p data-fade style={P}>We call this engineering serendipity. But the feeling it engenders is the powerful part: ambient optimism.</p>
        <p data-fade style={P}>When was the last time you trusted that the right opportunities will find you? Not because you finally nailed your personal brand or cracked the black box algos, but because you simply shared thoughtful signals on what you&apos;re looking for. Then you get back to work—while agents with far more patience and reach go find your match.</p>
        <p data-fade style={P}>Your others are out there. Now they can find you too.</p>
      </div>

      <div style={{ position: 'relative' }}>
        <img src="/found-in-translation/ambient.png" alt="Ambient" style={{ display: 'block', width: '100%', height: 'auto', opacity: 0.92 }} />
      </div>
      <Footer />
    </div>
  );
}

export const Component = FoundInTranslationPage;
