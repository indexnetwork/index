import { useEffect, useState } from "react";

/** Overview trace, opened on the landing page: same card, with the wrapper
 *  steps removed and ascii used for the tree and the live marker. */

const INTENT =
  "Traveling soon to San Francisco and looking to meet AI startup founders and builders";

const QUESTIONS = [
  "Which dates are you in San Francisco?",
  "Founders, builders, or both?",
  "Any AI domains in focus?",
  "Open to intros or events?",
  "Prefer 1:1 or small groups?",
  "Raising, hiring, or building?",
  "How long are you in town?",
  "Any stage preference?",
  "Warm intros or cold ok?",
  "Research, product, or infra?",
  "Any companies to prioritize?",
  "Coffee, demo, or event?",
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

const MAX_Q = 4;
const MAX_NEG = 9;
const CONCURRENT = 4;
const PEOPLE = 12610;

const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));
const pick = <T,>(a: T[]) => a[rnd(0, a.length - 1)];
const fmt = (n: number) => n.toLocaleString("en-US");

type QState = "pending" | "answered" | "skipped";
type Question = { id: number; text: string; state: QState };
type Neg = {
  id: number;
  name: string;
  running: boolean;
  chain: string;
  ok: boolean;
  dur: string;
};

const chain = () => {
  const k = rnd(0, 2);
  let c = "propose";
  for (let i = 0; i < k; i++) c += " → counter";
  const ok = Math.random() < 0.72;
  return { chain: c + (ok ? " → accept" : " → reject"), ok };
};

function Tree() {
  return <span className="text-gray-300 flex-shrink-0 select-none">└─</span>;
}

function Mark({ live }: { live?: boolean }) {
  if (live) return <span className="site-blink-fast text-gray-400 flex-shrink-0">▮</span>;
  return <span className="text-gray-300 flex-shrink-0 select-none">*</span>;
}

export default function Trace() {
  const [sec, setSec] = useState(0);
  const [events, setEvents] = useState(0);
  const [people, setPeople] = useState(0);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [negs, setNegs] = useState<Neg[]>([]);
  const [accepted, setAccepted] = useState(0);
  const [more, setMore] = useState(0);
  const [ready, setReady] = useState(0);

  useEffect(() => {
    const clock = setInterval(() => setSec((t) => t + 1), 1000);
    const scan = setInterval(() => {
      setPeople((n) => Math.min(PEOPLE, n + rnd(400, 3200)));
    }, 320);
    return () => {
      clearInterval(clock);
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
      const id = setTimeout(fn, ms);
      timers.push(id);
    };

    const bump = () => setEvents((n) => n + 1);

    const trimQ = (rows: Question[]) => {
      const next = [...rows];
      while (next.length > MAX_Q) {
        const idx = [...next].reverse().findIndex((r) => r.state !== "pending");
        if (idx === -1) break;
        const at = next.length - 1 - idx;
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
        setQuestions((prev) =>
          trimQ(prev.map((r) => (r.id === id ? { ...r, state: ans ? "answered" : "skipped" } : r))),
        );
        bump();
      }, rnd(1300, 3200));
    };

    const qLoop = () => {
      if (!alive) return;
      setQuestions((prev) => {
        if (prev.filter((r) => r.state === "pending").length < 2) later(spawnQ, 0);
        return prev;
      });
      later(qLoop, rnd(1500, 3000));
    };

    const trimNeg = (rows: Neg[], onDrop: () => void) => {
      const next = [...rows];
      while (next.length > MAX_NEG) {
        const idx = [...next].reverse().findIndex((r) => !r.running);
        if (idx === -1) break;
        const at = next.length - 1 - idx;
        names.delete(next[at].name);
        next.splice(at, 1);
        onDrop();
      }
      return next;
    };

    const spawnNeg = (completed = false) => {
      if (!alive) return;
      const free = NAMES.filter((n) => !names.has(n));
      if (!free.length) return;
      const name = pick(free);
      names.add(name);
      if (!completed) inFlight++;
      const id = ++nSeq;
      const settled = chain();
      const row: Neg = completed
        ? { id, name, running: false, ...settled, dur: `${rnd(150, 720)}ms` }
        : { id, name, running: true, chain: "", ok: false, dur: "" };
      setNegs((prev) => {
        let dropped = 0;
        const next = trimNeg([row, ...prev], () => {
          dropped++;
        });
        if (dropped) setMore((m) => m + dropped);
        return next;
      });
      bump();
      if (completed && settled.ok) {
        setAccepted((n) => n + 1);
        setReady((n) => (Math.random() < 0.4 ? Math.min(n + 1, 12) : n));
      }
      if (completed) return;
      later(() => {
        if (!alive) return;
        const result = chain();
        inFlight--;
        setNegs((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, running: false, ...result, dur: `${rnd(150, 720)}ms` } : r,
          ),
        );
        bump();
        if (result.ok) {
          setAccepted((n) => n + 1);
          setReady((n) => (Math.random() < 0.4 ? Math.min(n + 1, 12) : n));
        }
      }, rnd(1400, 3800));
    };

    const negLoop = () => {
      if (!alive) return;
      if (inFlight < CONCURRENT) spawnNeg();
      later(negLoop, rnd(600, 1300));
    };

    for (let i = 0; i < MAX_Q; i++) spawnQ();
    later(qLoop, 1800);
    for (let i = 0; i < MAX_NEG - CONCURRENT; i++) spawnNeg(true);
    for (let i = 0; i < CONCURRENT; i++) spawnNeg();
    later(negLoop, 1400);

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, []);

  const pending = questions.filter((q) => q.state === "pending").length;
  const answered = questions.filter((q) => q.state === "answered").length
    + questions.filter(() => false).length;
  // answered/skipped counts survive rows scrolling off, so track them apart from the visible list
  const [answeredN, skippedN] = useSettledCounts(questions);
  const clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

  return (
    <div className="home-trace">
      <div className="flex justify-end mb-6">
        <div className="max-w-[34rem] px-4 py-2 rounded-full border border-[#E8E8E8] bg-white text-[15px] text-gray-800 leading-snug shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          {INTENT}
        </div>
      </div>

      <div className="home-trace-label">INDEX</div>

      <div className="font-mono text-[11px] leading-tight border border-[#E8E8E8] rounded-sm overflow-hidden bg-white text-gray-700">
        <div className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-gray-700 border-b border-[#E8E8E8] bg-[#FAFAFA]">
          <span className="text-[10px] uppercase tracking-wider font-bold text-black font-sans">Trace</span>
          <span className="w-px h-2.5 bg-gray-300" />
          <span className="text-gray-500 tabular-nums">{fmt(events)} events</span>
          <span className="ml-auto flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-gray-400 tabular-nums">{clock}</span>
          </span>
        </div>

        <div className="divide-y divide-[#F4F4F4]">
          <div className="flex items-start gap-2 px-3.5 py-1.5 bg-[#F5F3FF] shadow-[inset_2px_0_0_#C4B5FD]">
            <span className="mt-px"><Mark /></span>
            <span className="text-gray-800">
              Create intent
              <span className="text-gray-400">: {INTENT}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1 bg-[#EFF6FF] shadow-[inset_2px_0_0_#93C5FD]">
            <Mark />
            <span className="flex-1 truncate text-blue-900 font-medium">Intent discovery</span>
            <span className="tabular-nums flex-shrink-0 text-blue-400">0.6s</span>
          </div>
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <span className="flex-1 truncate text-gray-600">
              Clarifying questions
              <span className="text-gray-400">
                : <span className="text-emerald-600">{answeredN}</span> answered ·{" "}
                <span className="text-gray-500">{skippedN}</span> skipped ·{" "}
                <span className="text-blue-500">{pending}</span> pending
              </span>
            </span>
          </div>
          {questions.map((q) => (
            <div key={q.id} className="home-trace-swap flex items-center gap-2 pl-12 pr-3.5 py-0.5">
              <Tree />
              <span className={`flex-1 truncate ${q.state === "skipped" ? "text-gray-400 line-through" : "text-gray-600"}`}>
                “{q.text}”
              </span>
              {q.state === "pending" && (
                <span className="flex-shrink-0 inline-flex items-center gap-1 text-blue-500">
                  <Mark live />pending
                </span>
              )}
              {q.state === "answered" && <span className="flex-shrink-0 text-emerald-600">answered ✓</span>}
              {q.state === "skipped" && <span className="flex-shrink-0 text-gray-400">skipped</span>}
            </div>
          ))}
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <span className="flex-1 truncate text-gray-600">
              Resolving intent
              <span className="text-gray-400">: meet AI founders and builders in San Francisco</span>
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-400">92ms</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1 bg-[#FFFBEB] shadow-[inset_2px_0_0_#FCD34D]">
            <Mark live />
            <span className="flex-1 truncate text-amber-900 font-medium">Counterparty discovery</span>
          </div>
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <span className="flex-1 truncate text-gray-600">
              Mapping reach<span className="text-gray-400">: 12 networks in scope</span>
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-400">110ms</span>
          </div>
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <Mark live />
            <span className="flex-1 truncate text-gray-600">
              Scanning counterparties
              <span className="text-gray-400">: {fmt(people)} people</span>
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-400">{people >= PEOPLE ? "" : ""}</span>
          </div>
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <span className="flex-1 truncate text-gray-600">
              Shortlisting<span className="text-gray-400">: 100 counterparties advanced</span>
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-400">60ms</span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1 bg-[#ECFDF5] shadow-[inset_2px_0_0_#6EE7B7]">
            <Mark live />
            <span className="flex-1 truncate text-emerald-900 font-medium">
              Opportunity discovery
              <span className="text-emerald-600 font-normal">: negotiating in parallel</span>
            </span>
          </div>
          {negs.map((row) => (
            <div key={row.id} className="home-trace-swap flex items-center gap-2 pl-8 pr-3.5 py-0.5">
              <Tree />
              {row.running ? <Mark live /> : <Mark />}
              <span className={`flex-1 truncate ${row.running ? "text-gray-400" : "text-gray-600"}`}>
                Negotiating with {row.name}
                {!row.running && (
                  <>
                    <span className="text-gray-400">: {row.chain}</span>
                    {row.ok && <span className="text-emerald-700"> ✓ opportunity</span>}
                  </>
                )}
              </span>
              {!row.running && (
                <span className="tabular-nums flex-shrink-0 text-gray-400">{row.dur}</span>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2 pl-8 pr-3.5 py-0.5">
            <Tree />
            <Mark live />
            <span className="flex-1 truncate text-gray-500">
              … {more} more connected
              <span className="text-gray-400">: {accepted} accepted</span>
            </span>
          </div>

          <div className="flex items-center gap-2 px-3.5 py-1.5 bg-[#ECFDF5] shadow-[inset_2px_0_0_#34D399]">
            <Mark />
            <span className="text-gray-800 font-medium">Present opportunities</span>
            <span className="tabular-nums flex-shrink-0 ml-auto text-emerald-600">{ready} ready</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Cumulative answered / skipped totals. Rows leave the list; the counts stay. */
function useSettledCounts(questions: Question[]) {
  const [seen, setSeen] = useState<Record<number, QState>>({});
  useEffect(() => {
    setSeen((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const q of questions) {
        if (q.state !== "pending" && next[q.id] !== q.state) {
          next[q.id] = q.state;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [questions]);
  const vals = Object.values(seen);
  return [vals.filter((s) => s === "answered").length, vals.filter((s) => s === "skipped").length] as const;
}

void answered;
