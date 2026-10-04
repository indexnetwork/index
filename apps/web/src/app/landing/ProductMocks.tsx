import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import UserAvatar from "@/components/UserAvatar";
import "./product-mocks.css";

/* The Mac app and the Hermes plugin, rebuilt as live markup instead of screenshots so the
   text stays real (selectable, copyable, crisp at any density). Each view is laid out at
   one fixed design size and scaled to whatever width its card gives it, so both always
   come out the same height. */

const W = 1040;
const H = 640;

function Scaled({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.34);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / W);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className="pm-frame" style={{ height: H * scale }} role="img" aria-label={label}>
      <div className="pm-stage" style={{ width: W, height: H, transform: `scale(${scale})` }}>
        {children}
      </div>
    </div>
  );
}

/* ---------- small line icons ---------- */

const icon = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "square" as const };

function Diamond() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" {...icon}>
      <path d="M6 3h12l4 6-10 12L2 9z" />
      <path d="M2 9h20M9 3l3 18 3-18" />
    </svg>
  );
}

function Chat() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...icon}>
      <path d="M3 4h18v12H9l-6 5z" />
    </svg>
  );
}

function List() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="5" width="3" height="3" />
      <rect x="8" y="5" width="14" height="3" />
      <rect x="2" y="15" width="3" height="3" />
      <rect x="8" y="15" width="14" height="3" />
    </svg>
  );
}

function Bot() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...icon}>
      <rect x="4" y="8" width="16" height="12" />
      <path d="M12 3v5M1 13h3M20 13h3" />
      <rect x="8.5" y="12" width="2" height="2" fill="currentColor" />
      <rect x="13.5" y="12" width="2" height="2" fill="currentColor" />
      <path d="M9 17h6" />
    </svg>
  );
}

function Pause() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...icon} strokeWidth={1.8}>
      <rect x="5" y="4" width="5" height="16" />
      <rect x="14" y="4" width="5" height="16" />
    </svg>
  );
}

function Trash() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" {...icon} strokeWidth={1.8} strokeLinecap="round">
      <path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v7M14 10v7" />
    </svg>
  );
}

function Eye() {
  return (
    <svg width="30" height="14" viewBox="0 0 30 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 7c4-5 22-5 26 0-4 5-22 5-26 0z" />
      <circle cx="15" cy="7" r="3" fill="currentColor" />
    </svg>
  );
}

/* ---------- Mac app: home ---------- */

const MAC_SIGNALS: Array<{ title: string; count?: number }> = [
  { title: "i am building a software/saas application and..." },
  { title: "traveling soon to sf and looking to meet cool...", count: 6 },
  { title: "i just launched a new consumer app and..." },
  { title: "i just launched a new developer tool..." },
  { title: "traveling to sf soon and looking to grab...", count: 8 },
];

export function MacMock() {
  return (
    <Scaled label="The Index Mac app: your live signals, each one negotiated by your agent">
      <div className="pm-mac">
        <div className="pm-mac-bar">
          <span className="pm-mac-close"><span /></span>
          <span className="pm-mac-grip" />
          <span className="pm-mac-name">index</span>
          <span className="pm-mac-stripes" />
        </div>
        <div className="pm-mac-body">
          <div className="pm-mac-left">
            <div className="pm-mac-hero">
              <h4 className="pm-mac-h">find your others</h4>
              <p className="pm-mac-p">
                start a signal by talking to your agent. it negotiates it with the other agents and
                makes an intro when both sides are interested.
              </p>
              <span className="pm-mac-invite"><Diamond />invite friends</span>
            </div>
            <div className="pm-mac-nav">
              <div className="pm-mac-nav-row"><Chat /><span>conversations</span></div>
              <div className="pm-mac-nav-row"><List /><span>networks</span><b>2</b></div>
              <div className="pm-mac-nav-row"><Bot /><span>agents</span><b>1</b></div>
              <div className="pm-mac-me">
                <UserAvatar id="seren" name="Seren Sandikci" size={40} />
                <span>Seren Sandikci</span>
                <i>▲</i>
              </div>
            </div>
          </div>
          <div className="pm-mac-right">
            <div className="pm-mac-label">YOUR SIGNALS<span /></div>
            <div className="pm-mac-list">
              {MAC_SIGNALS.map((s) => (
                <div key={s.title} className="pm-mac-signal">
                  <div>
                    <div className="pm-mac-signal-t">{s.title}</div>
                    <div className="pm-mac-live"><span />live</div>
                  </div>
                  {s.count ? <b className="pm-mac-count">{s.count}</b> : null}
                </div>
              ))}
              <span className="pm-mac-scroll" />
            </div>
            <div className="pm-mac-new"><span>+</span>new signal</div>
          </div>
        </div>
      </div>
    </Scaled>
  );
}

/* ---------- Hermes plugin: a signal and its radar ---------- */

const RADAR: Array<{ name: string; line: string; awaiting?: boolean }> = [
  { name: "Chloe Garcia", line: "Meet during your upcoming trip to SF", awaiting: true },
  { name: "Lena Fischer", line: "Connect on agentic workflows and multi-agent orchestration", awaiting: true },
  { name: "Mateo Patel", line: "Negotiation in progress" },
  { name: "Aria Hansen", line: "Negotiation in progress" },
  { name: "James Johnson", line: "Negotiation in progress" },
];

export function HermesMock() {
  return (
    <Scaled label="Index inside Hermes: a signal, a question from the agent, and the radar of people surfaced">
      <div className="pm-her">
        <div className="pm-her-signal">
          <div className="pm-her-label">SIGNAL</div>
          <div className="pm-her-head">
            <h4 className="pm-her-h">
              Traveling soon to SF and looking to meet cool people in AI, specifically founders and
              operators, for casual networking.
            </h4>
            <div className="pm-her-tools">
              <span className="pm-her-pause"><Pause /></span>
              <span className="pm-her-trash"><Trash /></span>
            </div>
          </div>
          <div className="pm-her-status"><span className="pm-her-live"><i />live</span>agent is looking in the background</div>
          <div className="pm-her-rule" />
          <div className="pm-her-label">YOUR AGENT</div>
          <p className="pm-her-p">
            James Johnson and Olivia Johnson are interested in connecting but asked if a virtual call
            would work as a backup if an in-person meetup in San Francisco cannot be scheduled. I am
            checking your preference on virtual meetings.
          </p>
          <div className="pm-her-qhead"><span className="pm-her-qtag">QUESTION</span>YOUR AGENT</div>
          <div className="pm-her-q">Are you open to connecting via virtual calls if meeting in person in San Francisco isn&rsquo;t feasible?</div>
          <div className="pm-her-opts">
            <span>Yes, open to virtual if SF in-person does not work out</span>
            <span>No, in-person in SF only</span>
            <span className="pm-her-own">write your own</span>
          </div>
          <div className="pm-her-input">Message your personal agent...</div>
        </div>
        <div className="pm-her-radar">
          <div className="pm-her-label pm-her-radar-h">RADAR (9) <Eye /></div>
          <div className="pm-her-sub">People the network surfaced for this intent.</div>
          <div className="pm-her-stats">
            <span><b>5</b>AWAITING YOU</span>
            <span><b>4</b>NEGOTIATING</span>
            <span><b>0</b>ACCEPTED</span>
            <span><b>0</b>MISSED</span>
          </div>
          {RADAR.map((p) => (
            <div key={p.name} className="pm-her-card">
              <div className="pm-her-card-top">
                <UserAvatar id={p.name} name={p.name} size={32} />
                <span className="pm-her-name">{p.name}</span>
                {p.awaiting ? (
                  <span className="pm-her-acts"><span className="pm-her-accept">accept</span><span className="pm-her-pass">pass</span></span>
                ) : (
                  <span className="pm-her-neg"><i />negotiating ›</span>
                )}
              </div>
              <div className="pm-her-line">{p.line}</div>
            </div>
          ))}
        </div>
      </div>
    </Scaled>
  );
}
