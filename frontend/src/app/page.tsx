import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import ClientLayout from "@/components/ClientLayout";
import { useAuthContext } from "@/contexts/AuthContext";
import ChatContent from "@/components/ChatContent";
import Footer from "@/components/Footer";
import { apiUrl } from "@/lib/api";

// --- Negotiation feed pool (cycles infinitely) ---
const NEG_FEED_POOL = [
  {
    initial: 'M', name: "Marco V.'s agent",
    turns: [
      { action: 'propose', score: 85, text: "Founder has real consumer instincts, building with AI as the mechanic. Pre-seed check territory." },
      { action: 'counter', score: 76, text: "Retention signals look real. One thing to resolve — is the AI the core loop, or a feature bolted on for the pitch?" },
      { action: 'accept', score: 91, text: "Deck confirms it. AI is the core loop, not the marketing layer. Strong alignment — ready to move forward." },
    ],
    finalStatus: 'accepted',
  },
  {
    initial: 'A', name: "Alex R.'s agent",
    turns: [
      { action: 'propose', score: 79, text: "Strong founder signal. Consumer AI with real retention data is rare at this stage — the thesis maps." },
      { action: 'reject', score: 41, text: "Retention numbers lack context. I don't see evidence the AI is the core loop vs. a feature layer bolted on for the pitch." },
    ],
    finalStatus: 'rejected',
  },
  {
    initial: 'P', name: "Priya R.'s agent",
    turns: [
      { action: 'propose', score: 83, text: "Strong intent overlap on distribution. Priya's network maps directly to the consumer acquisition channels this founder needs." },
      { action: 'accept', score: 88, text: "Thesis checks out. Consumer distribution expertise plus pre-seed check size — right stage, right profile." },
    ],
    finalStatus: 'accepted',
  },
  {
    initial: 'S', name: "Sarah K.'s agent",
    turns: [
      { action: 'propose', score: 82, text: "Consumer AI with real retention on one side, an investor who's backed consumer through the messy middle on the other." },
      { action: 'counter', score: 71, text: "Compelling signals. One open question: is AI the core mechanic, or a feature bolted on for the pitch?" },
      { action: 'accept', score: 89, text: "Deck confirms it — AI is the core loop, not the marketing layer. Objection fully addressed. Strong fit." },
    ],
    finalStatus: 'accepted',
  },
  {
    initial: 'J', name: "James W.'s agent",
    turns: [
      { action: 'propose', score: 77, text: "Pattern match on the consumer habit space, but the fund stage feels like a stretch — James writes Series A checks." },
      { action: 'counter', score: 64, text: "Stage mismatch is a real concern. Is there a path to a bridge check, or is this premature for the fund thesis?" },
      { action: 'reject', score: 38, text: "Stage gap is too wide. Pre-seed round, Series A fund minimum. Not the right fit right now." },
    ],
    finalStatus: 'rejected',
  },
  {
    initial: 'L', name: "Lena M.'s agent",
    turns: [
      { action: 'propose', score: 86, text: "Consumer habit formation with AI at the core — exactly where Lena has conviction. The product loop maps to her prior bets." },
      { action: 'accept', score: 90, text: "Strong fit across stage, thesis, and founder profile. This is exactly the kind of pre-seed bet she's been looking for." },
    ],
    finalStatus: 'accepted',
  },
  {
    initial: 'D', name: "Dev P.'s agent",
    turns: [
      { action: 'propose', score: 74, text: "Some overlap on consumer thesis, but Dev's fund is currently focused on infrastructure plays, not consumer apps." },
      { action: 'reject', score: 39, text: "Portfolio concentration risk. Too many consumer bets already — this doesn't fit the current allocation strategy." },
    ],
    finalStatus: 'rejected',
  },
  {
    initial: 'T', name: "Tariq N.'s agent",
    turns: [
      { action: 'propose', score: 81, text: "Consumer AI with a behavioral loop at the core. Tariq's written publicly about habit formation as a durable moat — this is his thesis." },
      { action: 'counter', score: 73, text: "Agreed on thesis fit. I want to understand the monetization model before I move — subscription, ads, or marketplace?" },
      { action: 'accept', score: 87, text: "Subscription model with strong retention makes sense at this stage. Monetization thesis is sound. Ready to proceed." },
    ],
    finalStatus: 'accepted',
  },
];

const NEG_ACTION_STYLE: Record<string, { bg: string; text: string }> = {
  propose: { bg: 'bg-blue-50', text: 'text-blue-600' },
  counter: { bg: 'bg-amber-50', text: 'text-amber-600' },
  accept: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  reject: { bg: 'bg-red-50', text: 'text-red-500' },
};

interface NegFeedItem {
  id: number;
  initial: string;
  name: string;
  finalStatus: 'accepted' | 'rejected';
  phase: 'typing' | 'resolved' | 'exiting';
  completedTurns: Array<{ action: string; score: number; text: string }>;
  activeAction: string | null;
  activeScore: number;
  shownWords: number;
  fullText: string;
}

function LandingPage() {
  // Waitlist modal state
  const [isWaitlistOpen, setIsWaitlistOpen] = useState(false);
  const [waitlistForm, setWaitlistForm] = useState({
    name: "",
    email: "",
    whatYouDo: "",
    whoToMeet: "",
  });
  const [waitlistStatus, setWaitlistStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  
  // Retro modal state (easter egg)
  const [isRetroModalOpen, setIsRetroModalOpen] = useState(false);

  // Negotiation feed state
  const negSectionRef = useRef<HTMLDivElement>(null);
  const feedAnimStarted = useRef(false);
  const feedControlRef = useRef<{ stop: () => void; resume: () => void }>({ stop: () => {}, resume: () => {} });
  const resolvedItemsRef = useRef<NegFeedItem[]>([]);
  const [feedItems, setFeedItems] = useState<NegFeedItem[]>([]);
  const [negSpawned, setNegSpawned] = useState(0);
  const [negAccepted, setNegAccepted] = useState(0);
  const [feedStopped, setFeedStopped] = useState(false);
  const [expandedFeedId, setExpandedFeedId] = useState<number | null>(null);

  // Close modals on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (isWaitlistOpen && waitlistStatus !== "loading") {
          setIsWaitlistOpen(false);
        }
        if (isRetroModalOpen) {
          setIsRetroModalOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [isWaitlistOpen, waitlistStatus, isRetroModalOpen]);

  // Listen for custom event from header button
  useEffect(() => {
    const handleOpenWaitlistModal = () => {
      setIsWaitlistOpen(true);
    };
    window.addEventListener('openWaitlistModal', handleOpenWaitlistModal);
    return () => window.removeEventListener('openWaitlistModal', handleOpenWaitlistModal);
  }, []);

  // Negotiation feed animation
  useEffect(() => {
    // 50 negotiations over 10s = one every 200ms
    // Each item lifetime: ~600ms (fits 3 visible at once)
    const TOTAL = 20;
    const SPAWN_INTERVAL_MS = 320;
    const TURN_DISPLAY_MS = 220;
    const TURN_PAUSE_MS = 90;
    const RESOLVE_LINGER_MS = 200;
    const EXIT_MS = 350;

    const itemTimers = new Map<number, ReturnType<typeof setTimeout>[]>();
    const globalTimers: ReturnType<typeof setTimeout>[] = [];
    let nextId = 0;
    let poolIdx = 0;

    const clearAll = () => {
      itemTimers.forEach(list => list.forEach(clearTimeout));
      itemTimers.clear();
      globalTimers.forEach(clearTimeout);
      globalTimers.length = 0;
    };

    const animateItem = (id: number, template: typeof NEG_FEED_POOL[number]) => {
      const timers: ReturnType<typeof setTimeout>[] = [];
      itemTimers.set(id, timers);
      const localTurns: Array<{ action: string; score: number; text: string }> = [];

      const startTurn = (ti: number, delay: number) => {
        const t = setTimeout(() => {
          const turn = template.turns[ti];
          const isLast = ti === template.turns.length - 1;
          const completedTurn = { action: turn.action, score: turn.score, text: turn.text };

          setFeedItems(prev => prev.map(item => item.id !== id ? item : {
            ...item, activeAction: turn.action, activeScore: turn.score,
            shownWords: 1, fullText: turn.text,
          }));

          const doneT = setTimeout(() => {
            localTurns.push(completedTurn);
            if (isLast) {
              setFeedItems(prev => prev.map(item => item.id !== id ? item : {
                ...item, phase: 'resolved',
                completedTurns: [...localTurns],
                activeAction: null, shownWords: 0, fullText: '',
              }));
              if (template.finalStatus === 'accepted') setNegAccepted(c => c + 1);

              // Snapshot for the stopped history view
              resolvedItemsRef.current.push({
                id, initial: template.initial, name: template.name,
                finalStatus: template.finalStatus as 'accepted' | 'rejected',
                phase: 'resolved', completedTurns: [...localTurns],
                activeAction: null, activeScore: 0, shownWords: 0, fullText: '',
              });

              const exitT = setTimeout(() => {
                setFeedItems(prev => prev.map(item => item.id !== id ? item : { ...item, phase: 'exiting' }));
                const removeT = setTimeout(() => {
                  setFeedItems(prev => prev.filter(item => item.id !== id));
                  itemTimers.delete(id);
                }, EXIT_MS);
                timers.push(removeT);
              }, RESOLVE_LINGER_MS);
              timers.push(exitT);
            } else {
              setFeedItems(prev => prev.map(item => item.id !== id ? item : {
                ...item, completedTurns: [...localTurns],
                activeAction: null, shownWords: 0, fullText: '',
              }));
              startTurn(ti + 1, TURN_PAUSE_MS);
            }
          }, TURN_DISPLAY_MS);
          timers.push(doneT);
        }, delay);
        timers.push(t);
      };

      startTurn(0, 0);
    };

    const spawnItem = () => {
      const template = NEG_FEED_POOL[poolIdx % NEG_FEED_POOL.length];
      poolIdx++;
      const id = nextId++;
      setNegSpawned(c => c + 1);
      setFeedItems(prev => [...prev, {
        id, initial: template.initial, name: template.name,
        finalStatus: template.finalStatus as 'accepted' | 'rejected',
        phase: 'typing', completedTurns: [],
        activeAction: null, activeScore: 0, shownWords: 0, fullText: '',
      }]);
      animateItem(id, template);
    };

    const seedFeed = () => {
      for (let i = 0; i < TOTAL; i++) {
        const t = setTimeout(spawnItem, i * SPAWN_INTERVAL_MS);
        globalTimers.push(t);
      }
      const restartT = setTimeout(seedFeed, TOTAL * SPAWN_INTERVAL_MS + 2000);
      globalTimers.push(restartT);
    };

    // Expose stop/resume to component
    feedControlRef.current = {
      stop: clearAll,
      resume: () => {
        clearAll();
        nextId = 0;
        poolIdx = 0;
        seedFeed();
      },
    };

    const el = negSectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !feedAnimStarted.current) {
          feedAnimStarted.current = true;
          seedFeed();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);

    return () => {
      observer.disconnect();
      clearAll();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFeedStop = () => {
    feedControlRef.current.stop();
    setFeedStopped(true);
    setExpandedFeedId(null);
    // Show full history of completed negotiations + any still in-progress
    setFeedItems(prev => {
      const resolvedIds = new Set(resolvedItemsRef.current.map(i => i.id));
      const inProgress = prev
        .filter(item => item.phase !== 'exiting' && !resolvedIds.has(item.id))
        .map(item => {
          if (item.phase === 'typing' && item.activeAction) {
            return {
              ...item, phase: 'resolved' as const,
              completedTurns: [...item.completedTurns, { action: item.activeAction, score: item.activeScore, text: item.fullText }],
              activeAction: null, shownWords: 0, fullText: '',
            };
          }
          return { ...item, phase: 'resolved' as const };
        });
      return [...resolvedItemsRef.current, ...inProgress];
    });
  };

  const handleFeedResume = () => {
    setFeedStopped(false);
    setFeedItems([]);
    setNegSpawned(0);
    setNegAccepted(0);
    setExpandedFeedId(null);
    feedAnimStarted.current = false;
    resolvedItemsRef.current = [];
    feedControlRef.current.resume();
  };

  const handleWaitlistSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!waitlistForm.email || !waitlistForm.name) return;
    
    setWaitlistStatus("loading");
    try {
      const res = await fetch(apiUrl("/api/subscribe"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: waitlistForm.email,
          type: "waitlist",
          name: waitlistForm.name,
          whatYouDo: waitlistForm.whatYouDo,
          whoToMeet: waitlistForm.whoToMeet,
        }),
      });
      if (res.ok) {
        setWaitlistStatus("success");
      } else {
        setWaitlistStatus("error");
      }
    } catch {
      setWaitlistStatus("error");
    }
  };

  return (
    <ClientLayout hideFeedback>
      <style jsx global>{`
        .landing-page {
          font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif;
        }

        .landing-page p.text-lg {
          font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 15px;
        }

        @keyframes pulse-shadow {
          0% { box-shadow: 0 0 0 0 rgba(80, 80, 80, 0.5); }
          70% { box-shadow: 0 0 0 8px rgba(80, 80, 80, 0); }
          100% { box-shadow: 0 0 0 0 rgba(80, 80, 80, 0); }
        }
        .pulse-btn {
          animation: pulse-shadow 1.2s infinite;
        }

        /* Button Style */
        .btn-modern {
          background-color: #041729 !important;
          color: white !important;
          border: none !important;
          border-radius: 2px !important;
          padding: 12px 20px !important;
          font-weight: 600 !important;
          font-size: 14px !important;
          font-family: 'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif !important;
          display: inline-flex !important;
          align-items: center !important;
          gap: 8px !important;
          transition: all 0.2s ease !important;
          text-decoration: none !important;
          cursor: pointer !important;
        }

        .btn-modern:hover {
          background-color: #0a2d4a !important;
          transform: translateY(-1px);
        }

        .btn-modern::after {
          content: '';
          width: 16px;
          height: 16px;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='white' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M13 7l5 5m0 0l-5 5m5-5H6'/%3E%3C/svg%3E");
          background-size: contain;
          background-repeat: no-repeat;
          background-position: center;
          display: inline-block;
          flex-shrink: 0;
        }

        /* Retro Modal Styles */
        .retro-modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0, 0, 0, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 10000;
        }

        .retro-modal {
          background: #C0C0C0;
          border: 2px outset #C0C0C0;
          box-shadow: 2px 2px 4px rgba(0, 0, 0, 0.5);
          min-width: 320px;
          max-width: 500px;
        }

        .retro-title-bar {
          background: #0000FF;
          color: white;
          padding: 20px 16px;
          font-weight: bold;
          font-size: 16px;
          border-bottom: 1px solid #000;
          display: flex;
          align-items: center;
          height: 20px;
          box-shadow: inset -1px -1px 0 #000080, inset 1px 1px 0 #8080FF;
          font-family: 'IBM Plex Mono', monospace;
        }

        .retro-title-text {
          text-shadow: 1px 1px 0 rgba(0, 0, 0, 0.3);
          letter-spacing: 0.5px;
        }

        .retro-content {
          background: #C0C0C0;
          padding: 20px 12px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          line-height: 1.2;
          font-family: 'IBM Plex Mono', monospace;
        }

        .retro-icon {
          width: 32px;
          height: 32px;
          background: #FFFF00;
          border: 2px solid #000;
          border-radius: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: bold;
          font-size: 24px;
          color: #000;
          box-shadow: inset -2px -2px 0 #808000, inset 2px 2px 0 #FFFF80;
          align-self: flex-start;
          margin-left: 8px;
          font-family: 'IBM Plex Mono', monospace;
        }

        .retro-message {
          font-size: 18px;
          color: #000;
          text-align: left;
          line-height: 1.2;
          width: 100%;
          padding: 0 8px;
          font-family: 'IBM Plex Mono', monospace;
        }

        .retro-button {
          background: #C0C0C0;
          border: 2px outset #C0C0C0;
          padding: 8px 16px;
          font-size: 16px;
          margin-top: 12px;
          margin-bottom: 6px;
          font-weight: bold;
          color: #000;
          cursor: pointer;
          box-shadow: inset -1px -1px 0 #808080, inset 1px 1px 0 #FFFFFF;
          outline: 2px dotted #000;
          outline-offset: 2px;
          font-family: 'IBM Plex Mono', monospace;
        }

        .retro-button:hover {
          background: #D4D4D4;
        }

        .retro-button:active {
          border: 2px inset #C0C0C0;
          box-shadow: inset 1px 1px 0 #808080, inset -1px -1px 0 #FFFFFF;
        }

      `}</style>

      <div className="landing-page flex flex-col min-h-[calc(100vh-76px)]">
        {/* Waitlist Modal */}
        {isWaitlistOpen && (
          <div 
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby="waitlist-modal-title"
            onClick={() => waitlistStatus !== "loading" && setIsWaitlistOpen(false)}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />
            
            {/* Modal */}
            <div 
              className="relative bg-white w-full max-w-md p-8 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setIsWaitlistOpen(false)}
                className="absolute top-4 right-4 text-gray-400 hover:text-black transition-colors"
                disabled={waitlistStatus === "loading"}
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {waitlistStatus === "success" ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 bg-[#4091BB] rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 id="waitlist-modal-title" className="text-2xl font-garamond text-black mb-2">You&apos;re on the list!</h3>
                  <p className="text-gray-600 text-[15px]">Check your inbox for your welcome email.</p>
                  <button
                    onClick={() => {
                      setIsWaitlistOpen(false);
                      setWaitlistStatus("idle");
                      setWaitlistForm({ name: "", email: "", whatYouDo: "", whoToMeet: "" });
                    }}
                    className="mt-6 text-[#4091BB] hover:underline text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <h3 id="waitlist-modal-title" className="text-2xl font-garamond text-black mb-2">Join the waitlist</h3>
                  <p className="text-gray-600 text-[15px] mb-6">
                    Tell us a bit about yourself! We&apos;ll let you know when we&apos;re live and keep you posted on updates.
                  </p>

                  <form onSubmit={handleWaitlistSubmit} className="space-y-4">
                    <div>
                      <label htmlFor="waitlist-name" className="block text-sm font-medium text-black mb-1.5">
                        Name <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        id="waitlist-name"
                        value={waitlistForm.name}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, name: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
                        required
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-email" className="block text-sm font-medium text-black mb-1.5">
                        Email <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="email"
                        id="waitlist-email"
                        value={waitlistForm.email}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, email: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
                        required
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-whatYouDo" className="block text-sm font-medium text-black mb-1.5">
                        What do you do?
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">Just to understand you a bit better.</p>
                      <input
                        type="text"
                        id="waitlist-whatYouDo"
                        value={waitlistForm.whatYouDo}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, whatYouDo: e.target.value })}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm"
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    <div>
                      <label htmlFor="waitlist-whoToMeet" className="block text-sm font-medium text-black mb-1.5">
                        Who do you want to meet?
                      </label>
                      <p className="text-xs text-gray-500 mb-1.5">
                        E.g., &quot;Founders building in climate tech,&quot; &quot;Someone who&apos;s scaled a consumer AI product&quot;
                      </p>
                      <textarea
                        id="waitlist-whoToMeet"
                        value={waitlistForm.whoToMeet}
                        onChange={(e) => setWaitlistForm({ ...waitlistForm, whoToMeet: e.target.value })}
                        rows={3}
                        className="w-full border border-gray-300 px-3 py-2.5 text-[15px] text-black focus:outline-none focus:border-[#4091BB] transition-colors rounded-sm resize-none"
                        disabled={waitlistStatus === "loading"}
                      />
                    </div>

                    {waitlistStatus === "error" && (
                      <p className="text-red-500 text-sm">Something went wrong. Please try again.</p>
                    )}

                    <button
                      type="submit"
                      disabled={waitlistStatus === "loading"}
                      className="w-full bg-[#041729] text-white py-3 text-sm font-semibold uppercase tracking-wider hover:bg-[#0a2d4a] transition-colors disabled:opacity-50 rounded-sm"
                    >
                      {waitlistStatus === "loading" ? "Submitting..." : "Join the waitlist"}
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        )}

        {/* Hero Section */}
        <section
          className="hero-section relative px-6 lg:px-12 pt-8 lg:pt-4 pb-8 lg:pb-0 min-h-[auto] lg:min-h-[90vh] overflow-hidden w-full"
        >
          <div className="max-w-[960px] mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-24 items-center">
            {/* Main content */}
            <div className="hero-content relative z-10 text-center lg:text-left max-w-full lg:max-w-[520px] mx-auto lg:mx-0 order-1">
              <h1
                className="text-[40px] md:text-[52px] lg:text-[60px] leading-none text-black mb-4 lg:mb-6 font-garamond mx-auto lg:mx-0"
                style={{ fontWeight: 200, letterSpacing: "0.25px", width: "fit-content" }}
              >
                Meet your next <br />idea partner
              </h1>

              <p
                className="text-[17px] leading-relaxed text-black/80 mb-8 lg:mb-10 max-w-[480px] mx-auto lg:mx-0 font-normal"
                style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
              >
                You know that moment when the right person unlocks your next move? Index makes that magic repeatable, and helps your others find you.
              </p>

              <div
                className="btn-container flex gap-0 mb-6 max-w-[450px] bg-[#F4F7F6] mx-auto lg:mx-0"
                style={{ width: "fit-content" }}
              >
                <button
                  onClick={() => setIsWaitlistOpen(true)}
                  className="btn-modern whitespace-nowrap uppercase tracking-wider no-underline"
                  style={{ boxShadow: "none" }}
                >
                  Join the waitlist
                </button>
              </div>
            </div>

            {/* Illustration */}
            <div className="hero-illustration relative z-10 flex items-center justify-center w-full h-full min-h-[300px] lg:min-h-[700px] order-2">
                <img
                  src="/collab.png"
                  alt="Collaboration illustration"
                  width={600}
                  height={600}
                  loading="lazy"
                  className="w-full max-w-[360px] lg:max-w-full h-auto object-contain lg:scale-115"
                />
            </div>
          </div>
        </section>

        {/* How It Works Section */}
        <section className="demo-section py-16 lg:py-28 px-6 lg:px-12 bg-[#F4F7F6]">
          <div className="max-w-[960px] mx-auto">
            <div className="mb-12 lg:mb-16">
              <h2
                className="text-[32px] md:text-[40px] font-garamond font-normal text-black leading-tight mb-3"
              >
                Ambient discovery that works for you
              </h2>
              <p
                className="text-[16px] text-black/50 leading-relaxed max-w-[460px]"
                style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
              >
                Share your intent once. Your agent runs bilateral negotiations across the network while you sleep.
              </p>
            </div>

            {/* Flow — timeline */}
            <div>

              {/* 1. Intent */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-3.5 h-3.5 rounded-full bg-[#4091BB] border-2 border-[#F4F7F6] mt-0.5 shrink-0" />
                  <div className="w-px flex-1 bg-[#E0E0E0] mt-1" />
                </div>
                <div className="flex-1 pb-10">
                  <p className="text-[10px] font-mono text-[#AAA] uppercase tracking-[0.12em] mb-3">You shared an intent</p>
                  <div className="bg-white border border-[#E8E8E8] rounded-lg px-4 py-4">
                    <div className="flex items-center gap-2 mb-2.5">
                      <img src="/you.png" alt="You" className="w-6 h-6 rounded-full object-cover shrink-0" />
                      <span className="text-[13px] font-semibold text-black">You</span>
                    </div>
                    <p
                      className="text-[14px] text-[#444] leading-relaxed"
                      style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
                    >
                      raising pre-seed for a consumer app, habit-formation space. want investors who&apos;ve backed consumer before — not just ai people who got excited recently. someone who cares about retention.
                    </p>
                    <div className="inline-flex items-center gap-1.5 mt-3 bg-[#F5F5F5] border border-[#EBEBEB] rounded px-2 py-1">
                      <svg className="w-3 h-3 text-[#BBB]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                      </svg>
                      <span className="text-[11px] text-[#AAA] font-mono">deck.pdf</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. In the background */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#CCC] border-2 border-[#F4F7F6] mt-1 shrink-0" />
                  <div className="w-px flex-1 bg-[#E0E0E0] mt-1" />
                </div>
                <div className="flex-1 pb-10">
                  <p className="text-[10px] font-mono text-[#AAA] uppercase tracking-[0.12em] mb-2">In the background</p>
                  <p
                    className="text-[14px] text-[#999] italic leading-relaxed"
                    style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
                  >
                    Your agent evaluates 1,847 intents across the network and opens bilateral negotiations with the most relevant ones.
                  </p>
                </div>
              </div>

              {/* 3. Negotiations */}
              <div className="flex gap-5" ref={negSectionRef}>
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-2 h-2 rounded-full bg-[#CCC] border-2 border-[#F4F7F6] mt-1 shrink-0" />
                  <div className="w-px flex-1 bg-[#E0E0E0] mt-1" />
                </div>
                <div className="flex-1 pb-10">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-[10px] font-mono text-[#AAA] uppercase tracking-[0.12em]">
                      {negSpawned > 0 ? (
                        <>
                          <span className="text-[#555]">{negSpawned}</span>
                          {' '}bilateral negotiations
                          {negAccepted > 0 && <> · <span className="text-emerald-600">{negAccepted} accepted</span></>}
                        </>
                      ) : (
                        <>Bilateral negotiations</>
                      )}
                    </p>
                    {!feedStopped && feedItems.some(item => item.phase === 'typing') && (
                      <span className="flex items-center gap-1.5">
                        <span className="flex items-center gap-1 text-[9px] font-mono text-[#4091BB]">
                          <span className="w-1 h-1 rounded-full bg-[#4091BB] animate-pulse" />
                          live
                        </span>
                        <button onClick={handleFeedStop} title="Stop" className="w-4 h-4 flex items-center justify-center text-[#CCC] hover:text-[#888] transition-colors">
                          <svg viewBox="0 0 10 10" fill="currentColor" className="w-2.5 h-2.5">
                            <rect x="1" y="1" width="8" height="8" rx="1" />
                          </svg>
                        </button>
                      </span>
                    )}
                    {feedStopped && (
                      <button onClick={handleFeedResume} className="flex items-center gap-1 text-[9px] font-mono text-[#AAA] hover:text-[#555] transition-colors">
                        <svg viewBox="0 0 10 10" fill="currentColor" className="w-2.5 h-2.5">
                          <path d="M2 1.5l7 3.5-7 3.5V1.5z" />
                        </svg>
                        resume
                      </button>
                    )}
                  </div>

                  {/* Feed — live mode */}
                  {!feedStopped && (
                    <div className="border border-[#EBEBEB] rounded-lg overflow-hidden" style={{ height: '320px' }}>
                      {feedItems.map((item) => {
                        const wordsList = item.fullText ? item.fullText.split(' ') : [];
                        const atLastWord = item.shownWords >= wordsList.length && wordsList.length > 0;
                        return (
                          <div
                            key={item.id}
                            className={`px-4 py-3 border-b border-[#EBEBEB] last:border-b-0 transition-all duration-[280ms] ${
                              item.phase === 'exiting' && item.finalStatus === 'accepted' ? 'opacity-0 scale-95 blur-sm'
                              : item.phase === 'exiting' ? 'opacity-0'
                              : 'opacity-100 scale-100 blur-none'
                            } ${item.phase === 'resolved' && item.finalStatus === 'accepted' ? 'bg-emerald-50/20' : ''
                            } ${item.phase === 'resolved' && item.finalStatus === 'rejected' ? 'opacity-30' : ''}`}
                          >
                            <div className="flex items-start gap-2.5">
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold shrink-0 mt-0.5 transition-colors duration-500 ${
                                item.phase === 'resolved' && item.finalStatus === 'accepted' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                                : item.phase === 'resolved' && item.finalStatus === 'rejected' ? 'bg-gray-100 border border-gray-200 text-gray-400'
                                : 'bg-[#EDF4F8] border border-[#C5DCE9] text-[#4091BB]'
                              }`}>{item.initial}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5">
                                  <span className="text-[12px] font-mono font-medium text-[#222]">{item.name}</span>
                                  {item.phase === 'resolved' && item.finalStatus === 'accepted' && <span className="text-[9px] font-mono text-emerald-600 ml-auto shrink-0">✓ accepted</span>}
                                  {item.phase === 'resolved' && item.finalStatus === 'rejected' && <span className="text-[9px] font-mono text-red-400 ml-auto shrink-0">✗ rejected</span>}
                                  {item.phase === 'typing' && item.activeAction && !atLastWord && <span className="w-1 h-1 rounded-full bg-[#4091BB] ml-auto shrink-0 animate-pulse" />}
                                </div>
                                <div className="flex items-center gap-1 flex-wrap mb-1.5">
                                  {item.completedTurns.map((t, i) => (
                                    <span key={i} className="flex items-center gap-1">
                                      {i > 0 && <span className="text-[#D8D8D8] text-[9px]">→</span>}
                                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm ${NEG_ACTION_STYLE[t.action]?.bg ?? 'bg-gray-50'} ${NEG_ACTION_STYLE[t.action]?.text ?? 'text-gray-500'}`}>{t.action}:{t.score}</span>
                                    </span>
                                  ))}
                                  {item.activeAction && (
                                    <span className="flex items-center gap-1">
                                      {item.completedTurns.length > 0 && <span className="text-[#D8D8D8] text-[9px]">→</span>}
                                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm ${NEG_ACTION_STYLE[item.activeAction]?.bg ?? 'bg-gray-50'} ${NEG_ACTION_STYLE[item.activeAction]?.text ?? 'text-gray-500'}`}>{item.activeAction}:{item.activeScore}</span>
                                    </span>
                                  )}
                                </div>
                                {(() => {
                                  const visibleText = item.fullText || item.completedTurns[item.completedTurns.length - 1]?.text;
                                  return visibleText ? (
                                    <p className="text-[11px] text-[#888] leading-relaxed" style={{ fontFamily: "'Public Sans', sans-serif" }}>{visibleText}</p>
                                  ) : null;
                                })()}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Feed — stopped/expanded mode */}
                  {feedStopped && (
                    <div className="border border-[#EBEBEB] rounded-lg overflow-hidden">
                      {feedItems.map((item) => {
                        const isExpanded = expandedFeedId === item.id;
                        return (
                          <div key={item.id} className={`border-b border-[#EBEBEB] last:border-b-0 ${item.finalStatus === 'rejected' ? 'opacity-40' : ''}`}>
                            <button
                              className="w-full px-4 py-3 flex items-center gap-2.5 text-left hover:bg-gray-50/60 transition-colors"
                              onClick={() => setExpandedFeedId(isExpanded ? null : item.id)}
                            >
                              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono font-bold shrink-0 ${
                                item.finalStatus === 'accepted' ? 'bg-emerald-50 border border-emerald-200 text-emerald-700' : 'bg-gray-100 border border-gray-200 text-gray-400'
                              }`}>{item.initial}</div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[12px] font-mono font-medium text-[#222]">{item.name}</span>
                                  {item.finalStatus === 'accepted'
                                    ? <span className="text-[9px] font-mono text-emerald-600 ml-auto shrink-0">✓ accepted</span>
                                    : <span className="text-[9px] font-mono text-red-400 ml-auto shrink-0">✗ rejected</span>}
                                </div>
                                <div className="flex items-center gap-1 flex-wrap">
                                  {item.completedTurns.map((t, i) => (
                                    <span key={i} className="flex items-center gap-1">
                                      {i > 0 && <span className="text-[#D8D8D8] text-[9px]">→</span>}
                                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm ${NEG_ACTION_STYLE[t.action]?.bg ?? 'bg-gray-50'} ${NEG_ACTION_STYLE[t.action]?.text ?? 'text-gray-500'}`}>{t.action}:{t.score}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <svg className={`w-3.5 h-3.5 text-[#CCC] shrink-0 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 12 12">
                                <path d="M2 4l4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            {isExpanded && (
                              <div className="px-4 pb-4 ml-[22px] pl-5 border-l-2 border-[#EBEBEB]">
                                {item.completedTurns.map((turn, i) => (
                                  <div key={i} className={`pt-3 ${i > 0 ? 'border-t border-[#F5F5F5]' : ''}`}>
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-sm ${NEG_ACTION_STYLE[turn.action]?.bg ?? 'bg-gray-50'} ${NEG_ACTION_STYLE[turn.action]?.text ?? 'text-gray-500'}`}>{turn.action}</span>
                                      <span className="text-[9px] font-mono text-[#CCC]">{turn.score}/100</span>
                                    </div>
                                    <p className="text-[11px] text-[#777] leading-relaxed" style={{ fontFamily: "'Public Sans', sans-serif" }}>{turn.text}</p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* 4. Opportunity */}
              <div className="flex gap-5">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-5 h-5 rounded-full bg-[#4091BB] flex items-center justify-center shrink-0">
                    <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1">
                  <p className="text-[10px] font-mono text-[#AAA] uppercase tracking-[0.12em] mb-3 mt-0.5">Waiting for action</p>
                  <div className="relative">
                    <div className="absolute inset-x-6 -bottom-4 h-full bg-[#F0F0F0] rounded-lg border border-[#E0E0E0]" />
                    <div className="absolute inset-x-3 -bottom-2 h-full bg-[#F7F7F7] rounded-lg border border-[#E5E5E5]" />
                    <div className="relative bg-white rounded-lg border border-[#E0E0E0] px-5 py-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-3 gap-3">
                        <div className="flex items-center gap-3">
                          <img
                            src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop&crop=face"
                            alt="Marco"
                            className="w-9 h-9 rounded-full object-cover shrink-0"
                          />
                          <div>
                            <div className="text-[14px] font-bold text-black font-mono">Marco</div>
                            <div className="text-[11px] text-[#BBB] font-mono">1 mutual intent · fit 91</div>
                          </div>
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <button
                            onClick={() => setIsRetroModalOpen(true)}
                            className="pulse-btn bg-[#041729] text-white px-3 py-1.5 rounded-sm text-[12px] font-medium hover:bg-[#0a2d4a] transition-colors"
                          >
                            Start a conversation
                          </button>
                          <div className="relative group/skip">
                            <button className="bg-[#F4F7F6] border border-[#E5E5E5] text-black px-3 py-1.5 rounded-sm text-[12px] font-medium hover:bg-[#EDEDED] transition-colors">
                              Skip
                            </button>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-[#041729] text-white text-[11px] rounded whitespace-nowrap opacity-0 group-hover/skip:opacity-100 transition-opacity duration-150 pointer-events-none">
                              It&apos;s the other button 👀
                              <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#041729]" />
                            </div>
                          </div>
                        </div>
                      </div>
                      <p
                        className="text-[14px] leading-relaxed text-[#555]"
                        style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
                      >
                        Marco&apos;s last two bets were consumer apps where the AI was the mechanic, not the marketing. He writes pre-seed checks specifically for founders who&apos;ve felt the habit loop break under pressure — and built through it. Your retention data is the argument. The deck just closes it.
                      </p>
                    </div>
                  </div>
                  <p className="text-[11px] font-mono text-[#BBB] mt-5">+4 more opportunities waiting</p>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Manifesto Promo Section */}
        <section
          className="relative overflow-hidden border-y border-[#E5E5E5] bg-[#041729]"
        >
          <div className="relative">
            <img
              src="/found-in-translation/found-in-translation-1-hero.png"
              alt="Found in Translation hero visual"
              className="block w-full h-auto"
            />
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.4)_35%,transparent_65%)]" />

            <svg
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {[0.25, 0.5, 0.75].map((t, i) => (
                <line
                  key={`h-${i}`}
                  x1="0"
                  y1={`${t * 100}%`}
                  x2="100%"
                  y2={`${t * 100}%`}
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                />
              ))}
              {[0.2, 0.4, 0.6, 0.8].map((t, i) => (
                <line
                  key={`v-${i}`}
                  x1={`${t * 100}%`}
                  y1="0"
                  x2={`${t * 100}%`}
                  y2="100%"
                  stroke="rgba(255,255,255,0.07)"
                  strokeWidth="1"
                />
              ))}
            </svg>

            <div className="absolute inset-0 z-10 flex items-end justify-end px-6 py-8 lg:px-12 lg:py-10">
              <div className="max-w-[340px] rounded-xl bg-white/5 p-6 text-left backdrop-blur-md lg:max-w-[380px] lg:p-8">
                <p className="mb-4 font-garamond text-[28px] leading-[1.1] text-white lg:text-[34px]">
                  Some things find you.<br />Most don&apos;t.
                </p>
                <a
                  href="/found-in-translation-6"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group inline-flex items-center gap-2 border-b border-white/40 pb-0.5 font-sans text-[15px] text-white/90 transition-colors hover:border-white hover:text-white"
                  style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  Why we built this
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/40 transition-colors group-hover:border-white">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                      <path d="M2 8L8 2M8 2H3M8 2V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                </a>
              </div>
            </div>
          </div>
        </section>

        {/* Community + Testimonial Section */}
        <section className="py-20 lg:py-28 px-6 lg:px-12 relative overflow-hidden bg-[#F4F7F6]">
          <div className="max-w-[960px] mx-auto relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20">
              {/* Left: Community CTA */}
              <div className="flex flex-col justify-center">
                <h2
                  className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-8 leading-tight"
                >
                  Build a community where the magic compounds
                </h2>

                <p
                  className="text-[17px] leading-relaxed text-black/80 mb-8 font-normal"
                  style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
                >
                  Are you a community or ecosystem leader? We&apos;re opening early access to leaders looking to engineer serendipity.
                </p>

                <div>
                  <a
                    href="https://calendly.com/d/2vj-8d8-skt/call-with-seren-and-seref"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-modern no-underline uppercase tracking-wider font-sans"
                  >
                    Get in touch
                  </a>
                </div>
              </div>

              {/* Right: Testimonial */}
              <div className="flex gap-5 items-start lg:border-l lg:border-[#E5E5E5] lg:pl-12">

                <img
                  src="/vivek.png"
                  alt="Vivek Singh"
                  className="w-[70px] h-[85px] md:w-[90px] md:h-[110px] object-cover flex-shrink-0"
                />
                <div>
                  <p
                    className="text-[17px] md:text-[19px] lg:text-[21px] leading-[1.4] text-black font-garamond mb-4"
                    style={{ fontWeight: 400 }}
                  >
                    &quot;The challenge with social discovery today is that you have to believe that the system is working in your favor — that you will be better for having experienced it.&quot;
                  </p>
                  <div className="text-[13px] font-semibold text-black">Vivek Singh</div>
                  <div className="text-[12px] text-[#666]">Director, Kernel</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Open Source Section */}
        <section
          className="w-full py-16 px-6 lg:px-12 relative overflow-hidden"
        >
          <div className="max-w-[960px] mx-auto text-center">
            <h2
              className="text-[32px] md:text-[36px] font-garamond font-normal text-black mb-8 leading-tight"
            >
              We&apos;re building in the open
            </h2>
            <p
              className="text-[17px] leading-relaxed text-black/80 mb-8 font-normal max-w-[700px] mx-auto"
              style={{ fontFamily: "'Public Sans', -apple-system, BlinkMacSystemFont, sans-serif" }}
            >
              Index is an open-source social protocol. No permission required.
            </p>
            <div className="flex items-center justify-center gap-6 flex-wrap">
              <a
                href="https://github.com/indexnetwork/index"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-3 bg-[#041729] hover:bg-[#0a2d4a] text-white px-4 py-2.5 rounded-sm transition-all duration-300"
              >
                <svg className="w-5 h-5" fill="#9CA3AF" viewBox="0 0 24 24">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                <span className="text-sm font-normal">@indexnetwork</span>
              </a>
              <a
                href="https://github.com/indexnetwork/index"
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#555] hover:text-black transition-colors font-sans text-[13px] uppercase tracking-wider"
              >
                Contribute →
              </a>
            </div>
          </div>
        </section>

        <Footer />

        {/* Retro Modal Easter Egg */}
        {isRetroModalOpen && (
          <div 
            className="retro-modal-overlay"
            onClick={() => setIsRetroModalOpen(false)}
          >
            <div 
              className="retro-modal"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="retro-title-bar">
                <span className="retro-title-text">Success</span>
              </div>
              <div className="retro-content">
                <div className="retro-icon">!</div>
                <div className="retro-message">
                  A few coffees and one offer later, you care about Mondays again.
                </div>
                <button 
                  onClick={() => setIsRetroModalOpen(false)}
                  className="retro-button"
                >
                  That was easy!
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ClientLayout>
  );
}

export default function RootPage() {
  const { isAuthenticated, isLoading } = useAuthContext();
  const [isRedirecting] = useState(false);

  // Handle OAuth callback redirect (e.g., after Composio Gmail auth)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const connectedAccountId = params.get("connected_account_id");

    if (status === "success" && connectedAccountId) {
      window.close();
    }
  }, []);

  // Show loading state while checking auth or redirecting after OAuth
  if (isLoading || isRedirecting) {
    return null;
  }

  // Show AI chat for authenticated users, landing page for unauthenticated
  if (isAuthenticated) {
    return (
      <ClientLayout>
        <ChatContent />
      </ClientLayout>
    );
  }

  return <LandingPage />;
}

export const Component = RootPage;
