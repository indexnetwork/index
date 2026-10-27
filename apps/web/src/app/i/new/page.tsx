import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { RecoveryForm } from "@/app/i/new/RecoveryForm";
import { CALIBRATING_LINES, OptionChip } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { Btn, Window } from "@/components/workbench/Workbench";
import { intentService, type IntentSuggestion, type PrepareAnswer, type RecoveryField } from "@/services/intent-prepare";
import { APIError } from "@/lib/api";
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

  return (
    <div className="workbench mac-desktop wb-viewport">
      {creating || (thinking && recoveryUsed) ? (
        <Calibrating />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: compact ? "stretch" : "center", padding: compact ? 0 : "56px 40px", overflow: "auto" }}>
          <div style={compact ? { display: "flex", flexDirection: "column", minHeight: 0 } : {
            width: 980, maxWidth: "100%",
            display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 18,
            height: "min(720px, calc(100dvh - 128px))",
          }}>
            <Window title="calibrating" onClose={() => navigate("/")} style={compact ? { flex: 1, border: "none", boxShadow: "none" } : undefined}>
              <div style={{ padding: compact ? "14px 16px 10px" : "18px 28px 12px", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <button type="button" onClick={() => navigate("/")} style={{ fontFamily: "var(--mac-mono)", fontSize: 13, color: "#000", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>← back</button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 24 }}>
                  <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", letterSpacing: "0.05em", flex: "0 0 auto" }}>step {stepIdx} of {stepCount}</span>
                  <div style={{ flex: 1, display: "flex", gap: 3 }}>
                    {Array.from({ length: stepCount }, (_, i) => (
                      <div key={i} style={{
                        flex: 1, height: 8, border: "1px solid #000",
                        background: i < stepIdx - 1 ? "#000" : i === stepIdx - 1 ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)" : "#fff",
                      }} />
                    ))}
                  </div>
                </div>
                <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, marginRight: compact ? -16 : -28, paddingRight: compact ? 16 : 28, paddingBottom: 18 }}>
                  {turns.map((turn) => (
                    <PastTurn key={turn.id} prompt={turn.prompt} answer={turn.answer} at={turn.at} />
                  ))}
                  {thinking ? (
                    <div className="fade-up"><AgentLine><WorkingDots /></AgentLine></div>
                  ) : stage === "retry" ? (
                    <div className="fade-up" style={{ display: "grid", gap: 12 }}>
                      <AgentLine>couldn&apos;t reach your agent.</AgentLine>
                      <div style={{ marginLeft: 36 }}><Btn primary onClick={() => void runPrepare(payload)}>try again</Btn></div>
                    </div>
                  ) : stage === "summary" ? (
                    <div className="fade-up" style={{ display: "grid", gap: 12 }}>
                      <AgentLine>Here&apos;s your intent.</AgentLine>
                      <IntentSummary
                        description={payload}
                        note={preparationReceipt ? "" : feedback}
                        canCreate={Boolean(preparationReceipt)}
                        onChange={setPayload}
                        onCreate={() => void create()}
                        onRecheck={() => void runPrepare(payload)}
                      />
                    </div>
                  ) : stage === "recovery" ? (
                    <RecoveryForm fields={recoveryFields} feedback={feedback} onSubmit={(answers) => runPrepare(payload, answers, 2)} />
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
              </div>
            </Window>
            {/* The live preview is a side panel; a phone has no side. */}
            {!compact && (
              <Window title="warming up">
                <FieldPreview turns={turns} refining={stepIdx === stepCount} />
              </Window>
            )}
          </div>
        </div>
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
    <div className="fade-up" style={{ display: "grid", gap: 10 }}>
      <AgentLine>{prompt}</AgentLine>
      <div style={{ marginLeft: 42, display: "grid", gap: 10 }}>
        {note && <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12.5, fontStyle: "italic", color: "var(--ink-2)" }}>{note}</div>}
        <form onSubmit={(e) => { e.preventDefault(); onSubmit(draft); }} style={{ maxWidth: 620, border: "1px solid #000", background: "#fff", display: "flex", flexDirection: "column" }}>
          <textarea
            autoFocus
            value={draft}
            maxLength={65_536}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={OPENING_PLACEHOLDER}
            style={{ background: "transparent", border: "none", outline: "none", color: "#111", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.45, resize: "vertical", padding: "11px 14px 4px" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px 8px" }}>
            <Btn primary small type="submit" disabled={!draft.trim()}>send →</Btn>
          </div>
        </form>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {examples.map((option) => (
            <OptionChip key={option} label={option} onClick={() => onSubmit(option)} />
          ))}
        </div>
        {onDone && <div style={{ marginTop: 6 }}><Btn onClick={onDone}>that&apos;s all for now →</Btn></div>}
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
    return (
      <div className="fade-up">
        <AgentLine muted>reading what i found about you… <WorkingDots /></AgentLine>
      </div>
    );
  }
  const toggle = (i: number) => setPicked((current) => current.includes(i) ? current.filter((x) => x !== i) : [...current, i]);
  return (
    <div className="fade-up" style={{ display: "grid", gap: 10 }}>
      <AgentLine>{PICKS_PROMPT}</AgentLine>
      <div style={{ marginLeft: 42, display: "grid", gap: 8, justifyItems: "start" }}>
        {suggestions.map((s, i) => (
          <SuggestionChip key={s.text} suggestion={s} selected={picked.includes(i)} onClick={() => toggle(i)} />
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <Btn primary disabled={!picked.length} onClick={() => onCreate(picked.sort().map((i) => suggestions[i]))}>
            {picked.length > 1 ? `create these ${picked.length}` : "create this"} →
          </Btn>
          <button type="button" onClick={onSkip} style={{ fontFamily: "var(--mac-mono)", fontSize: 11, padding: 0, border: "none", background: "transparent", color: "var(--ink-3)", textDecoration: "underline", cursor: "pointer" }}>
            none of these, i&apos;ll write my own
          </button>
        </div>
      </div>
    </div>
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

function SuggestionChip({ suggestion, selected, onClick }: {
  suggestion: IntentSuggestion;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={selected}
      style={{
        display: "inline-flex", alignItems: "baseline", gap: 10, minHeight: 36, maxWidth: 620,
        padding: "8px 14px", cursor: "pointer", textAlign: "left",
        background: selected ? "#111" : "#fff", color: selected ? "#fff" : "#111", border: "1px solid #000",
      }}>
      <span style={{ flex: "0 0 auto", fontFamily: "var(--mac-mono)", fontSize: 12 }}>{selected ? "[x]" : "[ ]"}</span>
      <span style={{ fontFamily: "var(--mac-sans)", fontSize: 13.5 }}>{suggestion.text}</span>
    </button>
  );
}

function AgentLine({ children, muted = false }: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
      <MyAgentAvatar size={30} style={{ marginTop: 2 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ marginBottom: 6, color: "#8f8f88", fontFamily: "var(--mac-mono)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>your agent</div>
        <div style={{ maxWidth: "92%", fontFamily: "var(--mac-sans)", fontSize: 14, fontWeight: muted ? 400 : 700, lineHeight: 1.55, color: muted ? "#2a2a2a" : "#111" }}>{children}</div>
      </div>
    </div>
  );
}

function WorkingDots() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 8, height: 8, background: "#000", animation: "mac-blink 1.05s steps(2) infinite", animationDelay: `${i * 0.35}s` }} />
      ))}
    </span>
  );
}

function PastTurn({ prompt, answer, at }: {
  prompt: string;
  answer: string;
  at: string;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <AgentLine muted>{prompt}</AgentLine>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div title={new Date(at).toLocaleString()} style={{ maxWidth: "92%", padding: "11px 14px", background: "#2a2a2a", color: "#fff", borderRadius: "4px 4px 2px 4px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word", whiteSpace: "pre-line" }}>{answer}</div>
      </div>
    </div>
  );
}

function IntentSummary({ description, note, canCreate, onChange, onCreate, onRecheck }: {
  description: string;
  note: string;
  canCreate: boolean;
  onChange: (value: string) => void;
  onCreate: () => void;
  onRecheck: () => void;
}) {
  return (
    <div style={{ marginLeft: 36, maxWidth: 560, display: "grid", gap: 14 }}>
      <div style={{ borderLeft: "2px solid #000", paddingLeft: 14, display: "grid", gap: 8 }}>
        <textarea
          aria-label="Intent description"
          value={description}
          onChange={(event) => onChange(event.target.value)}
          maxLength={65_536}
          rows={6}
          style={{ width: "100%", boxSizing: "border-box", padding: 10, border: "1px solid #000", fontFamily: "var(--mac-sans)", fontSize: 16, fontWeight: 500, lineHeight: 1.4, color: "#000", background: "#fff", resize: "vertical" }}
        />
        {note && <div style={{ fontFamily: "var(--mac-sans)", fontSize: 12.5, fontStyle: "italic", lineHeight: 1.5, color: "var(--ink-2)" }}>{note}</div>}
      </div>
      <div>
        {canCreate ? (
          <Btn primary disabled={!description.trim() || description.length > 65_536} onClick={onCreate}>create this intent</Btn>
        ) : (
          <Btn primary disabled={!description.trim()} onClick={onRecheck}>check intent</Btn>
        )}
      </div>
    </div>
  );
}

function FieldPreview({ turns, refining }: { turns: Turn[]; refining: boolean }) {
  const latest = turns.at(-1);
  const lines = [
    "getting a read on what you need…",
    latest ? `you're after: "${truncate(latest.answer.replace(/^· /, ""), 40)}"` : null,
    refining ? "sharpening the edges…" : null,
  ].filter((line): line is string => Boolean(line));

  return (
    <div style={{ padding: "20px 26px 18px", display: "flex", flexDirection: "column", gap: 8, overflow: "hidden", flex: 1, minHeight: 0 }}>
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", fontFamily: "var(--mac-mono)", fontSize: 13, color: "#000", lineHeight: 1.7, display: "grid", gap: 6, alignContent: "start" }}>
        {lines.map((line, i) => (
          <div key={line} className="fade-up" style={{ animationDelay: `${i * 60}ms`, display: "flex", gap: 8, alignItems: "baseline" }}>
            <span style={{ color: "#FF8A00", fontWeight: 700 }}>·</span>
            <span style={{ fontWeight: i === lines.length - 1 ? 700 : 400 }}>{line}</span>
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
      <div style={{ position: "absolute", left: "50%", top: "50%", width: 10, height: 10, marginLeft: -5, marginTop: -5, background: "#000" }} />
      {[36, 56, 78].map((r, i) => (
        <div key={r} style={{
          position: "absolute", left: "50%", top: "50%",
          width: r * 2, height: r * 2, marginLeft: -r, marginTop: -r,
          border: "1px dashed #000", borderRadius: 999,
          animation: `mac-orbit ${22 + i * 8}s linear infinite`,
        }}>
          <div style={{ position: "absolute", left: "50%", top: 0, transform: "translateX(-50%)", width: 6, height: 6, background: "#000" }} />
        </div>
      ))}
    </div>
  );
}

function Calibrating() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr)", placeItems: "center" }}>
      <Window title="calibrating" style={{ width: 420, maxWidth: "calc(100% - 32px)", height: "auto" }}>
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

/** A server reason worth showing ("Intent limit reached."), or "try again." for transport noise. */
function createFailureReason(error: unknown): string {
  const raw = error instanceof APIError && error.status > 0 && error.status < 500 ? error.message.trim() : "";
  if (!raw || /^HTTP \d/.test(raw)) return "try again.";
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}
