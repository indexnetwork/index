import { useEffect, useState } from "react";

/** Ticks per revealed row, and the loop length (100ms ticks). */
const STEP = 6;
const LOOP = 130;

type Row = { ind: 0 | 1 | 2; t: string; label: (k: number) => string; accent?: boolean };

const n = (v: number) => Math.round(v).toLocaleString("en-US");

const ROWS: Row[] = [
  { ind: 0, t: "0.41s", label: () => "Analyzing query" },
  { ind: 0, t: "", label: () => "Decided to find opportunities" },
  { ind: 0, t: "ongoing", label: (k) => `Find opportunities: ${n(3 * k)} high-signal matches` },
  { ind: 1, t: "0.6s", label: () => "Intent discovery" },
  { ind: 2, t: "", label: (k) => `Clarifying questions: ${n(2 * k)} answered · 1 skipped` },
  { ind: 2, t: "92ms", label: () => "Resolving intent: signal locked" },
  { ind: 1, t: "2.1s", label: () => "Counterparty discovery" },
  { ind: 2, t: "110ms", label: () => "Mapping reach: 128 networks in scope" },
  { ind: 2, t: "980ms", label: (k) => `Scanning counterparties: ${n(1204 * k)} profiles` },
  { ind: 2, t: "240ms", label: (k) => `Inferring lenses: ${n(18 * k)} relevance lenses` },
  { ind: 2, t: "640ms", label: (k) => `Evaluating overlap: ${n(1204 * k)} counterparties scored` },
  { ind: 2, t: "8ms", label: () => "Ranking counterparties" },
  { ind: 2, t: "60ms", label: (k) => `Shortlisting: ${n(47 * k)} counterparties advanced` },
  { ind: 1, t: "1.1s", label: () => "Opportunity discovery: negotiating 47 in parallel" },
  { ind: 2, t: "", label: (k) => `… ${n(3 * k)} accepted by both agents` },
  { ind: 0, t: "", label: () => "Present opportunities: 3 ready", accent: true },
];

const PAD = ["0px", "22px", "44px"];

/** A live, looping agent trace for "I am going to SF, who should I meet". */
export default function Trace() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % LOOP), 100);
    return () => clearInterval(id);
  }, []);

  const step = Math.floor(tick / STEP);
  const f = Math.min(1, (tick % STEP) / (STEP - 2));
  const events = Math.min(ROWS.length, step + 1);
  const seconds = Math.floor(Math.min(tick, 96) / 10);

  return (
    <div className="home-trace">
      <div className="home-trace-head">
        <span className="home-trace-title">&ldquo;I am going to SF, who should I meet&rdquo;</span>
        <span className="home-trace-clock">
          TRACE · {events} EVENTS · 0:{String(seconds).padStart(2, "0")}
        </span>
      </div>
      <div className="home-trace-log" aria-hidden="true">
        {ROWS.map((r, i) => {
          const done = i < step;
          const cur = i === step;
          const k = done ? 1 : cur ? f : 0;
          const showCursor = cur || (i === ROWS.length - 1 && done);
          return (
            <div key={i} className="home-trace-row" style={{ opacity: done || cur ? 1 : 0.2 }}>
              <span
                style={{
                  paddingLeft: PAD[r.ind],
                  color: r.accent && (done || cur) ? "var(--blue)" : "var(--ink)",
                }}
              >
                {r.ind ? "└─ " : ""}
                {r.label(k)}
                {showCursor && <span className="site-blink-fast">▮</span>}
              </span>
              <span className="home-trace-time">{done ? r.t : ""}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
