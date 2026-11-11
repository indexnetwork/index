import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import "@/styles/intents-home.css";
import "@/styles/plain.css";
import PageHead from "@/components/intents-home/PageHead";
import { AgentSays, Recovery, YouSaid } from "@/components/intents-home/NewIntentSteps";
import { OpenAgentLines } from "@/components/intents-home/openAgentLines";
import { useAuthContext } from "@/contexts/AuthContext";
import { CALIBRATING_LINES } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { Window } from "@/components/workbench/Workbench";
import { createFailureReason, intentService, type IntentSuggestion, type PrepareAnswer, type RecoveryField } from "@/services/intent-prepare";
import { useCompact } from "@/hooks/useCompact";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { awaitsFirstIntent, onboardingService } from "@/services/onboarding";

const OPENING_PROMPT = "what are you looking for right now?";
const PICKS_PROMPT = "here's what i found about you, so this is where i'd start. pick as many as you like, and i'll take them to other agents on index and bring the opportunities back to you.";
const MORE_PROMPT = "i'm on it. anything else you're looking for?";
const OPENING_PLACEHOLDER = "type what you're thinking about or tinkering on…";
const OPENING_OPTIONS = [
  "traveling soon, want to meet cool people in ai",
  "building something, want honest feedback on it",
  "just launched, want cool people to try it",
  "new in town, want to find my people",
  "raising soon, want to meet investors who get it",
  "hiring soon, want to meet great people early",
  "have an idea, want someone to build it with",
];

type Stage = "picks" | "opening" | "recovery" | "summary" | "retry";
type Turn = { id: string; prompt: string; answer: string; at: string };

/** Prepare the draft, asking follow-ups until it's ready, then create it. */
export default function NewIntentPage() {
  const navigate = useNavigate();
  const compact = useCompact();
  useVisualViewport();
  const { isAuthenticated, user, refetchUser } = useAuthContext();
  // Read once: creating the picks finishes onboarding, but the flow keeps its three steps.
  const [onboarding] = useState(() => awaitsFirstIntent(user));
  const { suggestions, examples } = useSuggestions(onboarding);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [chosenStage, setStage] = useState<Stage>(onboarding ? "picks" : "opening");
  // Nothing to suggest: onboarding goes straight to writing one.
  const stage: Stage = chosenStage === "picks" && suggestions !== "loading" && !suggestions.length ? "opening" : chosenStage;
  const [createdIds, setCreatedIds] = useState<string[]>([]);
  const [picksNote, setPicksNote] = useState("");
  const [payload, setPayload] = useState("");
  const [recoveryFields, setRecoveryFields] = useState<RecoveryField[]>([]);
  const [preparationReceipt, setPreparationReceipt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [creating, setCreating] = useState(false);

  const runPrepare = async (text: string, answers: PrepareAnswer[] = [], turn = 1) => {
    setThinking(true);
    try {
      const result = await intentService.prepare(text, answers, turn);
      setPayload(result.payload);
      if (result.status === "ready") {
        setPreparationReceipt(result.preparationReceipt);
        setThinking(false);
        void create(result.payload, result.preparationReceipt);
        return;
      }
      setPreparationReceipt("");
      setFeedback(result.feedback);
      setRecoveryFields(result.recovery);
      setRecoveryUsed(true);
      setStage(result.recovery.length ? "recovery" : "summary");
      setThinking(false);
    } catch {
      setStage("retry");
      setThinking(false);
    }
  };

  /** Each pick is created as it stands; the server admits it or says why not. */
  const createPicks = async (picked: IntentSuggestion[]) => {
    setCreating(true);
    const results = await Promise.allSettled(picked.map((s) => intentService.create(s.text)));
    const ids = results.flatMap((r) => (r.status === "fulfilled" ? [r.value.intentId] : []));
    const saved = picked.filter((_, i) => results[i].status === "fulfilled");
    // The first intent after the profile review finishes onboarding, as on the Mac.
    if (ids[0]) void onboardingService.complete(ids[0]).then(() => refetchUser()).catch(() => {});
    const failed = picked.length - ids.length;
    setPicksNote(failed ? `couldn't save ${failed === 1 ? "one of those" : `${failed} of those`}. write it below if you still want it.` : "");
    setCreatedIds(ids);
    if (saved.length) setTurns([{ id: "picks", prompt: PICKS_PROMPT, answer: saved.map((s) => `· ${s.text}`).join("\n"), at: new Date().toISOString() }]);
    setStage("opening");
    setCreating(false);
  };

  const openingPrompt = createdIds.length ? MORE_PROMPT : OPENING_PROMPT;

  const submitOpening = (text: string) => {
    const answer = text.trim();
    if (!answer) return;
    setTurns((current) => [...current.filter((t) => t.id !== "intent"), { id: "intent", prompt: openingPrompt, answer, at: new Date().toISOString() }]);
    setPayload(answer);
    void runPrepare(answer);
  };

  const create = async (description = payload, receipt = preparationReceipt) => {
    if (creating || !description.trim() || description.length > 65_536 || !receipt) return;
    setCreating(true);
    try {
      const created = await intentService.create(description, receipt);
      // The first intent after the profile review finishes onboarding, as on the Mac.
      if (awaitsFirstIntent(user)) {
        void onboardingService.complete(created.intentId).then(() => refetchUser()).catch(() => {});
      }
      // Onboarding ends on the home page, where the new intents' updates come in.
      navigate(onboarding ? "/" : `/i/${created.intentId}`);
    } catch (error) {
      setPreparationReceipt("");
      setFeedback(`that didn't go through. ${createFailureReason(error)}`);
      setStage("summary");
      setCreating(false);
    }
  };

  if (!isAuthenticated) return <Navigate to="/" replace />;

  const steps = onboarding ? ["picks", "opening"] : ["opening"];
  const stepIdx = steps.includes(stage) ? steps.indexOf(stage) + 1 : steps.length + 1;
  const stepCount = steps.length + 1;
  const settingUp = creating || (thinking && recoveryUsed);

  if (settingUp) return <div className="pl-new"><Calibrating /></div>;

  return (
    // Drawn like the intent page: the flow as a chat in the page column, and what the agent
    // is picking up in production's warming up panel on the right.
    <div className="pl-new">
      <div className="ih-view pl pl-new-page">
        <div className="pl-col">
          <PageHead
            back={{ label: "intents", onClick: () => navigate("/intents") }}
            title="new intent"
            status={<span className="pl-new-steps">step {stepIdx} of {stepCount}
              <span className="pl-new-bar" aria-hidden>
                {Array.from({ length: stepCount }, (_, i) => <span key={i} className={i < stepIdx - 1 ? "done" : i === stepIdx - 1 ? "now" : undefined} />)}
              </span>
            </span>}
          >
            <button type="button" onClick={() => navigate("/")}>close</button>
          </PageHead>
          <OpenAgentLines.Provider value>
          <div className="pl-page pl-new-chat">
            {turns.map((turn) => (
              <div key={turn.id} className="pl-ni-turn">
                <AgentSays>{turn.prompt}</AgentSays>
                <YouSaid>{turn.answer}</YouSaid>
              </div>
            ))}
            {thinking ? (
              <AgentSays><span className="pl-dim">reading that<span className="pl-blink">_</span></span></AgentSays>
            ) : stage === "retry" ? (
              <AgentSays>
                couldn&apos;t reach your agent.
                <div className="pl-ni-actions"><button type="button" className="go" onClick={() => void runPrepare(payload)}>try again</button></div>
              </AgentSays>
            ) : stage === "summary" ? (
              <AgentSays>
                {preparationReceipt ? "here's your intent. change anything you like, then create it." : feedback || "here's your intent."}
                <textarea
                  className="pl-ni-text"
                  aria-label="Intent description"
                  value={payload}
                  rows={5}
                  maxLength={65_536}
                  onChange={(event) => setPayload(event.target.value)}
                />
                <div className="pl-ni-actions">
                  {preparationReceipt ? (
                    <button type="button" className="go" disabled={!payload.trim() || payload.length > 65_536} onClick={() => void create()}>create this intent</button>
                  ) : (
                    <button type="button" className="go" disabled={!payload.trim()} onClick={() => void runPrepare(payload)}>check intent</button>
                  )}
                </div>
              </AgentSays>
            ) : stage === "recovery" ? (
              <Recovery fields={recoveryFields} feedback={feedback} onSubmit={(answers) => void runPrepare(payload, answers, 2)} />
            ) : stage === "picks" ? (
              <Picks suggestions={suggestions} onCreate={(picked) => void createPicks(picked)} onSkip={() => setStage("opening")} />
            ) : (
              <Opening
                prompt={openingPrompt}
                note={picksNote}
                examples={examples.length ? examples : OPENING_OPTIONS}
                onSubmit={submitOpening}
                onDone={createdIds.length ? () => navigate("/") : undefined}
              />
            )}
          </div>
          </OpenAgentLines.Provider>
        </div>
      </div>
      {/* The live preview is a side panel, as on production; a phone has no side. */}
      {!compact && (
        <Window title="warming up" style={{ flex: "none", width: "clamp(420px, 34vw, 600px)", borderTop: "none", borderRight: "none", borderBottom: "none", borderLeft: "1px solid #e6e6e6" }}>
          <FieldPreview turns={turns} refining={stepIdx === stepCount} />
        </Window>
      )}
    </div>
  );
}

function Opening({ prompt, note, examples, onSubmit, onDone }: {
  prompt: string;
  note: string;
  examples: string[];
  onSubmit: (text: string) => void;
  /** After the picks: leave without writing another. */
  onDone?: () => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    // The first question, open on the page: who's asking, the question in bold, a box to
    // write in with send inside it, then the starters stacked as plain boxes.
    <div className="pl-open">
      <MyAgentAvatar size={36} />
      <div className="pl-open-body">
        <div className="pl-open-who">your agent</div>
        <div className="pl-open-q">{prompt}</div>
        {note && <div className="pl-dim pl-small pl-new-note">{note}</div>}
        <form className="pl-open-box" onSubmit={(event) => { event.preventDefault(); onSubmit(draft); }}>
          <textarea
            autoFocus
            value={draft}
            maxLength={65_536}
            rows={3}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSubmit(draft);
              }
            }}
            placeholder={OPENING_PLACEHOLDER}
            aria-label="What you're looking for"
          />
          <button type="submit" className="go" disabled={!draft.trim()}>send →</button>
        </form>
        <div className="pl-open-options">
          {examples.map((option) => (
            <button key={option} type="button" onClick={() => onSubmit(option)}>{option}</button>
          ))}
        </div>
        {onDone && <div className="pl-open-done"><button type="button" onClick={onDone}>that&apos;s all for now</button></div>}
      </div>
    </div>
  );
}

/** Onboarding step one: the agent's drafts from the profile, any number picked. */
function Picks({ suggestions, onCreate, onSkip }: {
  suggestions: IntentSuggestion[] | "loading";
  onCreate: (picked: IntentSuggestion[]) => void;
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  if (suggestions === "loading") {
    return <AgentSays><span className="pl-dim">reading what i found about you<span className="pl-blink">_</span></span></AgentSays>;
  }
  const toggle = (i: number) => setPicked((current) => current.includes(i) ? current.filter((x) => x !== i) : [...current, i]);
  return (
    <AgentSays>
      {PICKS_PROMPT}
      <div className="pl-q-options">
        {suggestions.map((s, i) => (
          <label key={s.text}>
            <input type="checkbox" checked={picked.includes(i)} onChange={() => toggle(i)} /> {s.text}
          </label>
        ))}
      </div>
      <div className="pl-ni-actions pl-actions">
        <button type="button" className="go" disabled={!picked.length} onClick={() => onCreate(picked.sort().map((i) => suggestions[i]))}>
          {picked.length > 1 ? `create these ${picked.length}` : "create this"}
        </button>
        <button type="button" className="pl-skip" onClick={onSkip}>none of these, i&apos;ll write my own</button>
      </div>
    </AgentSays>
  );
}

/** Onboarding only: the agent's drafts and example starters from the profile. Empty when there are none. */
function useSuggestions(enabled: boolean): { suggestions: IntentSuggestion[] | "loading"; examples: string[] } {
  const [result, setResult] = useState<{ suggestions: IntentSuggestion[] | "loading"; examples: string[] }>(
    { suggestions: enabled ? "loading" : [], examples: [] },
  );
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    intentService.suggestions()
      .then((res) => ({ suggestions: res.suggestions, examples: res.examples ?? [] }))
      .catch(() => ({ suggestions: [], examples: [] }))
      .then((next) => { if (!cancelled) setResult(next); });
    return () => { cancelled = true; };
  }, [enabled]);
  return result;
}

function FieldPreview({ turns, refining }: { turns: Turn[]; refining: boolean }) {
  const latest = turns.at(-1);
  const lines = [
    "getting a read on what you need…",
    latest ? `you're after: "${truncate(latest.answer.replace(/^· /, ""), 40)}"` : null,
    refining ? "sharpening the edges…" : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", flex: 1, minHeight: 0, background: "var(--wb-hover)" }}>
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", fontFamily: "var(--wb-code)", fontSize: 12, color: "var(--ink-2)", lineHeight: 1.7, display: "grid", gap: 6, alignContent: "start" }}>
        {lines.map((line, i) => (
          <div key={line} className="fade-up" style={{ animationDelay: `${i * 60}ms`, display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ color: "var(--ink-3)" }}>·</span>
            <span style={{ color: i === lines.length - 1 ? "var(--ink)" : undefined }}>{line}</span>
          </div>
        ))}
        {turns.length > 0 && <FieldGlyph />}
      </div>
    </div>
  );
}

function truncate(value: string, n: number) {
  return value.length > n ? `${value.slice(0, n - 1)}…` : value;
}

function FieldGlyph() {
  return (
    <div style={{ position: "relative", height: 150, marginTop: 12 }}>
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 8, height: 8, marginLeft: -4, marginTop: -4, background: "var(--wb-live)" }} />
      {[36, 56, 78].map((r, i) => (
        <div key={r} style={{
          position: "absolute", left: "50%", top: "50%",
          width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r,
          border: "1px dashed #ccc", borderRadius: 999,
          animation: `mac-orbit ${22 + i * 8}s linear infinite`,
        }}>
          <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", width: 5, height: 5, borderRadius: "50%", background: "var(--ink-3)" }} />
        </div>
      ))}
    </div>
  );
}

function Calibrating() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
      <Window title="calibrating" style={{ width: 420, maxWidth: "calc(100% - 32px)", height: "auto", flex: "none", border: "1px solid var(--wb-hairline)", borderRadius: 3 }}>
        <div style={{ padding: "26px 28px 24px", textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", gap: 10, alignItems: "center", marginBottom: 18 }}>
            <span className="wb-live" style={{ width: 9, height: 9 }} />
            <span style={{ fontFamily: "var(--mac-mono)", letterSpacing: 3, fontSize: 13, textTransform: "uppercase" }}>index</span>
          </div>
          <div style={{ border: "1px solid #000", height: 10, overflow: "hidden", margin: "0 auto 18px", background: "#fff" }}>
            <div style={{ height: "100%", backgroundImage: "repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)", animation: "mac-stripes 0.8s linear infinite", backgroundSize: "24px 24px" }} />
          </div>
          {CALIBRATING_LINES.map((line, i) => (
            <div key={line} className="fade-up" style={{
              animationDelay: `${i * 350}ms`, fontFamily: "var(--mac-sans)", fontSize: 15,
              color: i === CALIBRATING_LINES.length - 1 ? "#000" : "var(--ink-2)",
              letterSpacing: 0.2, padding: "4px 0",
              fontWeight: i === CALIBRATING_LINES.length - 1 ? 700 : 400,
            }}>
              <span style={{ marginRight: 8, fontFamily: "var(--mac-mono)" }}>›</span>{line}
            </div>
          ))}
        </div>
      </Window>
    </div>
  );
}

export const Component = NewIntentPage;
