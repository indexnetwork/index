import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";

import { intentLabel } from "@/components/intents-home/stages";
import { useIntentsData } from "@/contexts/IntentsDataContext";
import { useNetworksState } from "@/contexts/NetworksContext";

/** A short name for a kind of person, and a fuller intent to start from. */
const STARTERS: [string, string][] = [
  ["a cofounder", "a technical cofounder who has shipped something real and wants to build from zero with me"],
  ["investors", "pre-seed investors who back what i'm building and write first checks"],
  ["design partners", "design partners who'd use what i'm building every week and tell me what's broken"],
  ["a first hire", "a founding engineer who wants to build the first version with me, remote is fine"],
  ["feedback swaps", "founders who want to swap honest product feedback, 30 minutes each way"],
];

/** The kinds of people the text asks for; more than one reads as two intents in one. */
const KINDS: [RegExp, string][] = [
  [/co-?founder/i, "a cofounder"],
  [/investor|angel|\bvcs?\b|\bfund/i, "investors"],
  [/design partner/i, "design partners"],
  [/\bhire|hiring|engineer|designer|developer|recruit/i, "a first hire"],
  [/feedback/i, "feedback swaps"],
  [/research|academic/i, "researchers"],
  [/advisor|mentor/i, "advisors"],
  [/customer|buyer|pilot/i, "early customers"],
];

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z]{5,}/g) ?? []);

/** What the agent reads in the draft, as it's typed: who, stage, where. */
function readDraft(text: string) {
  const t = text.trim();
  const kinds = KINDS.filter(([re]) => re.test(t)).map(([, kind]) => kind);
  const stage = t.match(/pre-?seed|\bseed\b|series [abc]/i)?.[0]?.toLowerCase();
  const place = t.match(/\b(?:in|based in|around|near)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/)?.[1] ?? (/\bremote\b/i.test(t) ? "remote" : undefined);
  return { t, kinds, stage, place };
}

/**
 * Writing a new intent on the right of the intents list: what you want in a
 * big box, starters to begin from, and your agent reading along (who it will
 * look for, at what stage, where) with a word when it reads as two kinds of
 * people or close to one you already have. "start looking" hands it to the
 * agent; what happens next (a follow-up question, the final check) shows here.
 */
export default function NewIntentPane({ busy, children, onSubmit, onClose }: {
  /** The agent is reading it or setting it up. */
  busy?: ReactNode;
  /** A step after the first (a follow-up, the final check, a retry). */
  children?: ReactNode;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { intents } = useIntentsData();
  const { networks } = useNetworksState();
  const [draft, setDraft] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const read = useMemo(() => readDraft(draft), [draft]);
  const ok = read.t.length >= 12;

  // Close to an intent you already have: three or more of the same longer words.
  const dup = useMemo(() => {
    if (read.t.length < 12) return null;
    const mine = words(read.t);
    const best = intents
      .map((intent) => {
        const text = intent.payload?.trim() || intent.summary?.trim() || intentLabel(intent);
        return { intent, text, n: [...words(text)].filter((w) => mine.has(w)).length };
      })
      .sort((a, b) => b.n - a.n)[0];
    return best && best.n >= 3 ? best : null;
  }, [read.t, intents]);

  const lookIn = networks.filter(Boolean).map((n) => n.title).filter(Boolean);
  const start = () => { if (ok && !busy && !children) onSubmit(read.t); };

  useEffect(() => { if (!busy && !children) box.current?.focus(); }, [busy, children]);

  // ⌘↵ starts it from anywhere in the pane; esc cancels when nothing is written.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); start(); }
      else if (event.key === "Escape" && !event.defaultPrevented && !draft.trim()) { event.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rows: [string, string | undefined][] = [
    ["looking for", read.kinds.length ? read.kinds.join(" + ") : "people who match what you wrote"],
    ["stage", read.stage],
    ["where", read.place],
    ["in", lookIn.length ? lookIn.join(", ") : "everyone on index"],
  ];

  return (
    <div className="sv-person">
      <header className="sv-ph">
        <div className="sv-pid sv-ihead">
          <div className="who">
            <div className="sv-pn">new intent</div>
            <div className="sv-pu">your agent looks in the background and brings people to you</div>
          </div>
        </div>
        <button type="button" className="sv-x" aria-label="cancel" onClick={onClose}>×</button>
      </header>
      <div className="sv-body sv-ni">
        {busy ? busy : children ? children : (
          <>
            <h4 className="sv-h4">who are you looking for?</h4>
            <textarea
              ref={box}
              className="sv-ni-text"
              aria-label="What you're looking for"
              value={draft}
              maxLength={65_536}
              rows={4}
              placeholder="e.g. a technical cofounder who has shipped agent infrastructure, open to building in Europe"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="sv-chips one sv-ni-starters">
              <span className="sv-ni-lab">start from</span>
              {STARTERS.map(([label, text]) => (
                <button key={label} type="button" className="sv-chip ghost" onClick={() => { setDraft(text); box.current?.focus(); }}>{label}</button>
              ))}
            </div>

            <h4 className="sv-h4">your agent will look for</h4>
            {!read.t ? (
              <p className="sv-ni-tip">start typing, or pick a starter. your agent reads along.</p>
            ) : (
              <>
                <div className="sv-ni-read">
                  {rows.filter(([, value]) => value).map(([key, value]) => (
                    <div key={key} className="sv-ni-row"><span>{key}</span><b>{value}</b></div>
                  ))}
                </div>
                {read.kinds.length > 1 && (
                  <div className="sv-ni-warn">
                    this reads like {read.kinds.length} kinds of people. one intent finds one kind best: your agent searches and asks differently for each.
                    <div className="sv-chips one">
                      {read.kinds.map((kind) => (
                        <button key={kind} type="button" className="sv-chip" onClick={() => setDraft(STARTERS.find(([label]) => label === kind)?.[1] ?? `${kind}: ${read.t}`)}>
                          keep only {kind}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {dup && (
                  <div className="sv-ni-warn">
                    close to an intent you already have:{" "}
                    <button type="button" className="sv-ni-dup" onClick={() => navigate(`/i/${dup.intent.id}`)}>{dup.text}</button>. add to that one instead?
                  </div>
                )}
                {read.t.length < 25 && <p className="sv-ni-tip">a bit more helps: who they are, what you&apos;d do together, and anything that rules people out.</p>}
              </>
            )}

            {lookIn.length > 0 && (
              <>
                <h4 className="sv-h4">look in</h4>
                <div className="sv-chips">
                  {lookIn.map((title) => <span key={title} className="sv-chip sv-ni-net">{title}</span>)}
                </div>
                <p className="sv-ni-tip">people in your networks can find this intent too, so their agents can come to yours.</p>
              </>
            )}
          </>
        )}
      </div>
      {!busy && !children && (
        <div className="sv-bar">
          <button type="button" className="sv-btn go" disabled={!ok} onClick={start}>start looking ▸</button>
          <button type="button" className="sv-btn" onClick={onClose}>cancel</button>
          <span className="hint">⌘↵ to start</span>
        </div>
      )}
    </div>
  );
}
