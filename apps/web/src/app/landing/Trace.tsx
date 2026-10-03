import { useEffect, useState } from "react";

/** Each phase of the trace has its own colour (see `.home-trace-p-*` in home.css). */
type Phase = "query" | "intent" | "reach" | "negotiate" | "present";
/** How progress moves within a step: steady, front-loaded, back-loaded, or stalling midway. */
type Pace = "steady" | "fast" | "slow" | "stall";

type Row = {
  ind: 0 | 1 | 2;
  t: string;
  label: (k: number) => string;
  phase: Phase;
  /** How long the step runs, in 100ms ticks. */
  dur: number;
  pace: Pace;
};

const n = (v: number) => Math.round(v).toLocaleString("en-US");

const ROWS: Row[] = [
  { ind: 0, t: "0.41s", label: () => "Analyzing query", phase: "query", dur: 4, pace: "fast" },
  { ind: 0, t: "", label: () => "Decided to find opportunities", phase: "query", dur: 2, pace: "steady" },
  { ind: 0, t: "ongoing", label: (k) => `Find opportunities: ${n(3 * k)} high-signal matches`, phase: "query", dur: 5, pace: "slow" },
  { ind: 1, t: "0.6s", label: () => "Intent discovery", phase: "intent", dur: 4, pace: "fast" },
  { ind: 2, t: "", label: (k) => `Clarifying questions: ${n(2 * k)} answered · 1 skipped`, phase: "intent", dur: 9, pace: "stall" },
  { ind: 2, t: "92ms", label: () => "Resolving intent: signal locked", phase: "intent", dur: 3, pace: "fast" },
  { ind: 1, t: "2.1s", label: () => "Counterparty discovery", phase: "reach", dur: 4, pace: "steady" },
  { ind: 2, t: "110ms", label: () => "Mapping reach: 5 networks in scope", phase: "reach", dur: 3, pace: "fast" },
  { ind: 2, t: "980ms", label: (k) => `Scanning counterparties: ${n(1000 * k)} people`, phase: "reach", dur: 14, pace: "slow" },
  { ind: 2, t: "60ms", label: (k) => `Shortlisting: ${n(100 * k)} counterparties advanced`, phase: "reach", dur: 5, pace: "steady" },
  { ind: 1, t: "1.1s", label: () => "Opportunity discovery: negotiating 12 in parallel", phase: "negotiate", dur: 16, pace: "stall" },
  { ind: 2, t: "", label: (k) => `… ${n(3 * k)} accepted by both agents`, phase: "negotiate", dur: 7, pace: "slow" },
  { ind: 0, t: "", label: () => "Present opportunities: 3 ready", phase: "present", dur: 3, pace: "fast" },
];

/** When each step starts, and the loop: the run, then a hold on the finished trace. */
const STARTS = ROWS.reduce<number[]>((acc, r, i) => [...acc, i === 0 ? 0 : acc[i - 1] + ROWS[i - 1].dur], []);
const RUN = STARTS[ROWS.length - 1] + ROWS[ROWS.length - 1].dur;
const LOOP = RUN + 30;

const shape = (pace: Pace, u: number) => {
  if (pace === "fast") return 1 - (1 - u) * (1 - u);
  if (pace === "slow") return u * u;
  if (pace === "stall") return u < 0.35 ? (u / 0.35) * 0.45 : u < 0.65 ? 0.45 + ((u - 0.35) / 0.3) * 0.07 : 0.52 + ((u - 0.65) / 0.35) * 0.48;
  return u;
};

/** Tree prefix per indent level, drawn in text so the columns stay aligned. */
const INDENT = ["", "└─ ", "   └─ "];

/** Fixed-width text table: column widths in characters. */
const W_EVENT = 60;
const BAR = 30;
const W_TIME = 9;
const col = (s: string, w: number) => s.padEnd(w);

/** Only the running step gets a full bar; finished ones keep a faint line, upcoming ones nothing. */
const bar = (done: boolean, cur: boolean, k: number) => {
  if (done) return "[" + "=".repeat(BAR) + "]";
  if (!cur) return " ".repeat(BAR + 2);
  const filled = Math.min(BAR - 1, Math.floor(k * BAR));
  return "[" + "#".repeat(filled) + ">" + "-".repeat(BAR - filled - 1) + "]";
};

const HEAD = col("EVENT", W_EVENT) + col("PROGRESS", BAR + 4) + col("TIME", W_TIME) + "STATE";
const RULE = "-".repeat(HEAD.length + 4);

/** A live, looping agent trace for "I am going to SF, who should I meet". */
export default function Trace() {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % LOOP), 100);
    return () => clearInterval(id);
  }, []);

  const found = STARTS.findIndex((s, i) => tick >= s && tick < s + ROWS[i].dur);
  const step = found === -1 ? ROWS.length : found;
  const events = Math.min(ROWS.length, step + 1);
  const seconds = Math.floor(Math.min(tick, RUN) / 10);

  return (
    <div className="home-trace">
      <div className="home-trace-head">
        <span className="home-trace-title">&ldquo;I am going to SF, who should I meet&rdquo;</span>
      </div>
      <div className="home-trace-scroll">
        <pre className="home-trace-pre" aria-hidden="true">
          <span className="home-trace-dim">{HEAD}</span>
          {"\n"}
          <span className="home-trace-rule">{RULE}</span>
          {"\n"}
          {ROWS.map((r, i) => {
            const done = i < step;
            const cur = i === step;
            const k = done ? 1 : cur ? shape(r.pace, (tick - STARTS[i]) / r.dur) : 0;
            const showCursor = cur || (i === ROWS.length - 1 && done);
            const tree = INDENT[r.ind];
            const text = r.label(k);
            const used = tree.length + text.length;
            const phase = `home-trace-p-${r.phase}`;
            return (
              <span key={i} style={{ opacity: done || cur ? 1 : 0.3 }}>
                <span className={phase}>{tree}</span>
                <span className={phase}>{text}</span>
                {showCursor ? <span className="site-blink-fast home-trace-ink">▮</span> : " "}
                {" ".repeat(Math.max(1, W_EVENT - used - 1))}
                <span className={phase} style={{ opacity: done ? 0.35 : 1 }}>
                  {bar(done, cur, k)}
                </span>
                {"  "}
                <span className={phase}>{col(done ? r.t : "", W_TIME)}</span>
                <span className={phase}>{done ? "done" : cur ? "running" : "queued"}</span>
                {"\n"}
              </span>
            );
          })}
          <span className="home-trace-rule">{RULE}</span>
          {"\n"}
          <span className="home-trace-dim">
            TRACE · {events} EVENTS · 0:{String(seconds).padStart(2, "0")}
          </span>
        </pre>
      </div>
    </div>
  );
}
