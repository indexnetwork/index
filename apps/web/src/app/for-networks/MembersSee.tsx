/**
 * "What your members see": Mira and Daniel find a climbing partner, in three steps,
 * drawn in the app's own look (tokens from styles/split.css, as on the deck slides).
 */

/** Square bauhaus faces, the same shapes UserAvatar draws in the app. */
function Face({ who, size }: { who: "mira" | "daniel"; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true" className="fx-face">
      {who === "mira" ? (
        <>
          <rect width="80" height="80" fill="#146A7C" />
          <rect x="-6" y="46" width="100" height="10" fill="#92A1C6" transform="rotate(-18 40 40)" />
          <circle cx="30" cy="30" r="16" fill="#F0AB3D" />
          <line x1="0" y1="62" x2="80" y2="50" stroke="#C271B4" strokeWidth="2" />
        </>
      ) : (
        <>
          <rect width="80" height="80" fill="#C271B4" />
          <rect x="18" y="18" width="80" height="80" fill="#92A1C6" transform="rotate(22 40 40)" />
          <circle cx="50" cy="34" r="16" fill="#146A7C" />
          <line x1="0" y1="24" x2="80" y2="40" stroke="#F0AB3D" strokeWidth="2" />
        </>
      )}
    </svg>
  );
}

function Lock() {
  return (
    <svg width="10" height="12" viewBox="0 0 12 14" aria-hidden="true" className="fx-lock">
      <rect x="1" y="6" width="10" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 6V4a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function Step({ n, title, note }: { n: string; title: string; note: string }) {
  return (
    <h3 className="fx-step">
      <span className="fx-step-n">{n}</span>
      <span className="fx-step-t">{title}</span>
      <span className="fx-step-note">{note}</span>
    </h3>
  );
}

const INTENTS = [
  { who: "mira", name: "Mira", text: "Just moved to Berlin. Looking for someone to go climbing with on weekday evenings." },
  { who: "daniel", name: "Daniel", text: "My climbing partner moved away. Need someone for Tuesday and Thursday evenings." },
] as const;

const LOG = [
  { from: "mira's agent", them: false, text: "Mira just moved to Berlin and wants a regular climbing partner." },
  { from: "daniel's agent", them: true, text: "He climbs Tuesdays and Thursdays after work. What level is she?" },
  { from: "mira's agent", them: false, text: "Same as him, intermediate. She lives ten minutes from his gym." },
];

export default function MembersSee() {
  return (
    <div className="fx">
      <Step n="01" title="discover" note="Each tells their own agent, in their own words." />
      <div className="fx-row fx-row--2">
        {INTENTS.map((i) => (
          <div className="fx-win fx-intent" key={i.name}>
            <div className="fx-intent-who">
              <Face who={i.who} size={26} />
              <b>{i.name}</b>
              <span className="fx-private"><Lock />private</span>
            </div>
            <p className="fx-intent-t">{i.text}</p>
          </div>
        ))}
      </div>

      <Step n="02" title="negotiate" note="Their agents check the fit and share only what helps." />
      <div className="fx-win fx-talk">
        <div className="fx-log">
          {LOG.map((l) => (
            <div className="fx-log-line" key={l.text}>
              <span className={l.them ? "fx-log-from fx-them" : "fx-log-from"}>{l.from}</span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
        <div className="fx-hint"><Lock />her address stays with her agent</div>
      </div>

      <Step n="03" title="connect" note="Only when both say yes do they hear about it, and start talking." />
      <div className="fx-row fx-row--connect">
        <div className="fx-win">
          <div className="fx-lh">agents agreed. your call · 1</div>
          <div className="fx-card">
            <Face who="mira" size={42} />
            <div className="fx-card-body">
              <b className="fx-card-name">Mira</b>
              <p className="fx-blurb">
                New in Berlin and looking for a climbing partner. Same level as you, free the same
                evenings, ten minutes from your gym.
              </p>
              <div className="fx-actions" aria-hidden="true">
                <span className="fx-btn fx-btn--go">accept</span>
                <span className="fx-btn">pass</span>
              </div>
            </div>
          </div>
        </div>
        <div className="fx-win fx-chat">
          <div className="fx-chat-h">both said yes · chat with mira</div>
          <div className="fx-well">
            <div className="fx-msg">Hey! Tuesday at 7 at the gym?</div>
            <div className="fx-msg fx-msg--me">Perfect. I&rsquo;ll bring a spare chalk bag.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
