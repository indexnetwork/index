import { useEffect, useRef, useState, type ReactNode } from "react";

/** Overview trace on the landing page. The query wrapper is gone; the run
 *  opens on the created intent. Tree branches and the live cursor are ascii. */

const INTENT =
  "Traveling soon to San Francisco and looking to meet AI startup founders and builders";

const QUESTIONS = [
  "Which dates are you in San Francisco?", "Founders, builders, or both?", "Any AI domains in focus?",
  "Open to intros or events?", "Prefer 1:1 or small groups?", "Raising, hiring, or building?",
  "How long are you in town?", "Any stage preference?", "Warm intros or cold ok?",
  "Research, product, or infra?", "Any companies to prioritize?", "Coffee, demo, or event?",
];

const NAMES = [
  "Sarah Chen", "Marcus Feldman", "Priya Nair", "David Okafor", "Lena Vogt",
  "Diego Alvarez", "Mei Lin", "Tomás Reyes", "Aisha Khan", "Jonas Berg",
  "Yuki Tanaka", "Noah Bello", "Ravi Menon", "Clara Fontaine", "Omar Haddad",
  "Ines Costa", "Kojo Mensah", "Sofia Ricci", "Ellis Ward", "Hana Park",
  "Leo Nakamura", "Amara Diallo", "Felix Braun", "Nadia Petrova", "Ben Cohen",
  "Grace Liu", "Samir Rao", "Elena Ivanova", "Marco Bianchi", "Zoe Adeyemi",
  "Theo Larsen", "Ana Ferreira", "Ivan Petrov", "Maya Goldberg", "Kenji Sato",
];

const MAX_Q = 5;
const MAX_NEG = 9;
const CONCURRENT = 4;
const PEOPLE = 12610;

const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const pick = <T,>(a: T[]) => a[rnd(0, a.length - 1)];
const fmt = (n: number) => n.toLocaleString("en-US");

type QState = "pending" | "answered" | "skipped";
type Question = { id: number; text: string; state: QState };
type Neg = { id: number; name: string; running: boolean; chain: string; ok: boolean; dur: string };

const outcome = () => {
  const steps = rnd(0, 2);
  let c = "propose";
  for (let i = 0; i < steps; i++) c += " → counter";
  const ok = Math.random() < 0.72;
  return { chain: `${c}${ok ? " → accept" : " → reject"}`, ok };
};

const GLYPH = ["|", "/", "-", "\\"];

function Tree() {
  return <span className="home-trace-tree">└─</span>;
}

function Bullet() {
  return <span className="home-trace-bullet">*</span>;
}

/** Fixed-width status: `[ | ]` while running, `[ ok ]` or `[ -- ]` when settled. */
function Slot({ glyph, state }: { glyph: string; state: "run" | "ok" | "skip" }) {
  const inner = (state === "run" ? ` ${glyph}` : state === "ok" ? " ok" : " --").padEnd(4, " ");
  return <span className={`home-trace-slot home-trace-slot--${state}`}>[{inner}]</span>;
}

export default function Trace() {
  const [sec, setSec] = useState(0);
  const [events, setEvents] = useState(0);
  const [people, setPeople] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answered, setAnswered] = useState(0);
  const [skipped, setSkipped] = useState(0);
  const [negs, setNegs] = useState<Neg[]>([]);
  const [more, setMore] = useState(0);
  const [ready, setReady] = useState(0);
  const [frame, setFrame] = useState(0);
  const pending = questions.filter((q) => q.state === "pending").length;
  const glyph = GLYPH[frame];
  const negsRef = useRef<Neg[]>([]);

  useEffect(() => {
    const clock = setInterval(() => setSec((t) => t + 1), 1000);
    const spin = setInterval(() => setFrame((f) => (f + 1) % GLYPH.length), 120);
    const scan = setInterval(() => setPeople((n) => Math.min(PEOPLE, n + rnd(400, 3200))), 320);
    return () => {
      clearInterval(clock);
      clearInterval(spin);
      clearInterval(scan);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const qSeen = new Set<string>();
    const names = new Set<string>();
    let inFlight = 0;
    let qSeq = 0;
    let nSeq = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };
    const bump = () => {
      if (alive) setEvents((n) => n + 1);
    };

    const trimQ = (rows: Question[]) => {
      const next = [...rows];
      while (next.length > MAX_Q) {
        let at = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].state !== "pending") { at = i; break; }
        }
        if (at === -1) break;
        qSeen.delete(next[at].text);
        next.splice(at, 1);
      }
      return next;
    };

    const spawnQ = () => {
      if (!alive) return;
      const free = QUESTIONS.filter((q) => !qSeen.has(q));
      if (!free.length) return;
      const text = pick(free);
      qSeen.add(text);
      const id = ++qSeq;
      setQuestions((prev) => trimQ([{ id, text, state: "pending" }, ...prev]));
      bump();
      later(() => {
        if (!alive) return;
        const ans = Math.random() < 0.7;
        if (ans) setAnswered((n) => n + 1);
        else setSkipped((n) => n + 1);
        setQuestions((prev) => trimQ(prev.map((r) => (
          r.id === id ? { ...r, state: ans ? "answered" : "skipped" } : r
        ))));
        bump();
      }, rnd(1300, 3200));
    };

    const noteOk = (ok: boolean) => {
      if (!ok) return;
      if (Math.random() < 0.4) setReady((n) => Math.min(n + 1, 12));
    };

    const spawnNeg = (completed = false) => {
      if (!alive) return;
      const free = NAMES.filter((n) => !names.has(n));
      if (!free.length) return;
      const name = pick(free);
      names.add(name);
      const id = ++nSeq;
      const done = completed ? outcome() : null;
      if (!completed) inFlight++;
      const row: Neg = done
        ? { id, name, running: false, chain: done.chain, ok: done.ok, dur: `${rnd(150, 720)}ms` }
        : { id, name, running: true, chain: "", ok: false, dur: "" };
      const next = [row, ...negsRef.current];
      let dropped = 0;
      while (next.length > MAX_NEG) {
        let at = -1;
        for (let i = next.length - 1; i >= 0; i--) {
          if (!next[i].running) { at = i; break; }
        }
        if (at === -1) break;
        names.delete(next[at].name);
        next.splice(at, 1);
        dropped++;
      }
      negsRef.current = next;
      setNegs(next);
      if (dropped) setMore((m) => m + dropped);
      bump();
      if (done) noteOk(done.ok);
      if (completed) return;
      later(() => {
        if (!alive) return;
        const result = outcome();
        inFlight--;
        const settled = negsRef.current.map((r) => (
          r.id === id ? { ...r, running: false, chain: result.chain, ok: result.ok, dur: `${rnd(150, 720)}ms` } : r
        ));
        negsRef.current = settled;
        setNegs(settled);
        bump();
        noteOk(result.ok);
      }, rnd(1400, 3800));
    };

    const negLoop = () => {
      if (!alive) return;
      if (inFlight < CONCURRENT) spawnNeg();
      later(negLoop, rnd(600, 1300));
    };

    for (let i = 0; i < MAX_Q; i++) spawnQ();
    for (let i = 0; i < MAX_NEG - CONCURRENT; i++) spawnNeg(true);
    for (let i = 0; i < CONCURRENT; i++) spawnNeg();
    later(negLoop, 1400);

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
      negsRef.current = [];
      setQuestions([]);
      setNegs([]);
      setEvents(0);
      setAnswered(0);
      setSkipped(0);
      setMore(0);
      setReady(0);
    };
  }, []);

  const accepted = Math.round(more * 0.24);
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  const scanning = people < PEOPLE;

  return (
    <div className="home-trace">
      <div className="flex justify-end mb-6">
        <div className="max-w-[34rem] px-4 py-2 rounded-full border border-[#E8E8E8] bg-white text-[15px] text-gray-800 leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {INTENT}
        </div>
      </div>

      <div className="home-trace-label">INDEX</div>

      <div className="home-trace-card">
        <div className="home-trace-bar">
          <span>+ trace</span>
          <span>{fmt(events)} events</span>
          <span className="home-trace-bar-end"><Slot glyph={glyph} state="run" /> {clock}</span>
        </div>
        <div className="home-trace-rule" aria-hidden="true" />

        <div className="home-trace-rows">
          <div className="home-trace-line home-trace-line--intent">
            <Bullet />
            <span className="home-trace-text">
              Create intent<span className="home-trace-dim">: {INTENT}</span>
            </span>
          </div>

          <Row tone="home-trace-line--discover">
            <Bullet />
            <span className="home-trace-text home-trace-strong">Intent discovery</span>
            <span className="home-trace-time">0.6s</span>
          </Row>
          <Child>
            <span className="home-trace-text">
              Clarifying questions
              <span className="home-trace-dim">
                : {answered} answered · {skipped} skipped · {pending} pending
              </span>
            </span>
          </Child>
          {questions.map((q) => (
            <div key={q.id} className="home-trace-swap home-trace-line home-trace-line--q">
              <Tree />
              <span className={`home-trace-text${q.state === "skipped" ? " home-trace-skip" : ""}`}>
                &ldquo;{q.text}&rdquo;
              </span>
              <Slot glyph={glyph} state={q.state === "pending" ? "run" : q.state === "answered" ? "ok" : "skip"} />
            </div>
          ))}
          <Child>
            <span className="home-trace-text">
              Resolving intent
              <span className="home-trace-dim">: meet AI founders and builders in San Francisco</span>
            </span>
            <span className="home-trace-time">92ms</span>
          </Child>

          <Row tone="home-trace-line--reach">
            <Bullet />
            <span className="home-trace-text home-trace-strong">Counterparty discovery</span>
            <Slot glyph={glyph} state="run" />
          </Row>
          <Child>
            <span className="home-trace-text">
              Mapping reach<span className="home-trace-dim">: 12 networks in scope</span>
            </span>
            <span className="home-trace-time">110ms</span>
          </Child>
          <Child>
            <span className="home-trace-text">
              Scanning counterparties<span className="home-trace-dim">: {fmt(people)} people</span>
            </span>
            {scanning ? <Slot glyph={glyph} state="run" /> : <span className="home-trace-time">980ms</span>}
          </Child>
          <Child>
            <span className="home-trace-text">
              Shortlisting<span className="home-trace-dim">: 100 counterparties with potentially mutual intent</span>
            </span>
            <span className="home-trace-time">60ms</span>
          </Child>

          <Row tone="home-trace-line--deal">
            <Bullet />
            <span className="home-trace-text home-trace-strong">
              Opportunity discovery
              <span className="home-trace-dim home-trace-deal">: negotiating in parallel</span>
            </span>
            <Slot glyph={glyph} state="run" />
          </Row>
          {negs.map((row) => (
            <div key={row.id} className="home-trace-swap home-trace-line home-trace-line--child">
              <Tree />
              <span className={`home-trace-text${row.running ? " home-trace-dim" : ""}`}>
                Negotiating with {row.name}
                {!row.running && (
                  <>
                    <span className="home-trace-dim">: {row.chain}</span>
                    {row.ok && <span className="home-trace-ok"> ok</span>}
                  </>
                )}
              </span>
              {row.running ? <Slot glyph={glyph} state="run" /> : <span className="home-trace-time">{row.dur}</span>}
            </div>
          ))}
          <Child>
            <span className="home-trace-text home-trace-dim">
              ... {fmt(more)} more connected<span>: {fmt(accepted)} accepted</span>
            </span>
            <Slot glyph={glyph} state="run" />
          </Child>

          <Row tone="home-trace-line--ready">
            <Bullet />
            <span className="home-trace-text home-trace-strong">Present opportunities</span>
            <span className="home-trace-ok">{ready} ready</span>
          </Row>
        </div>
        <div className="home-trace-rule" aria-hidden="true" />
      </div>
    </div>
  );
}

function Row({ tone, children }: { tone: string; children: ReactNode }) {
  return <div className={`home-trace-line ${tone}`}>{children}</div>;
}

function Child({ children }: { children: ReactNode }) {
  return (
    <div className="home-trace-line home-trace-line--child">
      <Tree />
      {children}
    </div>
  );
}
