import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { RecoveryForm } from "@/app/i/new/RecoveryForm";
import { CALIBRATING_LINES, OptionChip } from "@/components/workbench/mac-blocks";
import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import { Btn, Window } from "@/components/workbench/Workbench";
import { signalService, type PrepareAnswer, type RecoveryField } from "@/services/signals";
import { APIError } from "@/lib/api";

const OPENING_PROMPT = "what are you looking for right now?";
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

type Stage = "opening" | "recovery" | "summary" | "retry";
type Turn = { id: string; prompt: string; answer: string };

/** Prepare the draft, asking follow-ups until it's ready, then create it. */
export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [stage, setStage] = useState<Stage>("opening");
  const [payload, setPayload] = useState("");
  const [recoveryFields, setRecoveryFields] = useState<RecoveryField[]>([]);
  const [preparationReceipt, setPreparationReceipt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [creating, setCreating] = useState(false);

  const runPrepare = async (text: string, answers: PrepareAnswer[] = []) => {
    setThinking(true);
    try {
      const result = await signalService.prepare(text, answers);
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

  const submitOpening = (text: string) => {
    const answer = text.trim();
    if (!answer) return;
    setTurns([{ id: "intent", prompt: OPENING_PROMPT, answer }]);
    setPayload(answer);
    void runPrepare(answer);
  };

  const create = async (description = payload, receipt = preparationReceipt) => {
    if (creating || !description.trim() || description.length > 65_536 || !receipt) return;
    setCreating(true);
    try {
      const created = await signalService.create(description, receipt);
      navigate(`/i/${created.intentId}`);
    } catch (error) {
      setPreparationReceipt("");
      setFeedback(`that didn't go through. ${createFailureReason(error)}`);
      setStage("summary");
      setCreating(false);
    }
  };

  if (!isAuthenticated) return <Navigate to="/" replace />;

  const stepIdx = stage === "opening" ? 1 : 2;

  return (
    <div className="workbench mac-desktop" style={{ position: "relative", height: "100vh" }}>
      {creating || (thinking && recoveryUsed) ? (
        <Calibrating />
      ) : (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: "56px 40px", overflow: "auto" }}>
          <div style={{
            width: 980, maxWidth: "100%",
            display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 18,
            height: "min(720px, calc(100vh - 128px))",
          }}>
            <Window title="calibrating" onClose={() => navigate("/")}>
              <div style={{ padding: "18px 28px 12px", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                  <button type="button" onClick={() => navigate("/")} style={{ fontFamily: "var(--mac-mono)", fontSize: 13, color: "#000", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}>← back</button>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 24 }}>
                  <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88", letterSpacing: "0.05em", flex: "0 0 auto" }}>step {stepIdx} of 2</span>
                  <div style={{ flex: 1, display: "flex", gap: 3 }}>
                    {[0, 1].map((i) => (
                      <div key={i} style={{
                        flex: 1, height: 8, border: "1px solid #000",
                        background: i < stepIdx - 1 ? "#000" : i === stepIdx - 1 ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)" : "#fff",
                      }} />
                    ))}
                  </div>
                </div>
                <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 20, marginRight: -28, paddingRight: 28, paddingBottom: 18 }}>
                  {turns.map((turn) => (
                    <PastTurn key={turn.id} prompt={turn.prompt} answer={turn.answer} />
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
                      <AgentLine>Here&apos;s your signal.</AgentLine>
                      <SignalSummary
                        description={payload}
                        note={preparationReceipt ? "" : feedback}
                        canCreate={Boolean(preparationReceipt)}
                        onChange={setPayload}
                        onCreate={() => void create()}
                        onRecheck={() => void runPrepare(payload)}
                      />
                    </div>
                  ) : stage === "recovery" ? (
                    <RecoveryForm fields={recoveryFields} feedback={feedback} onSubmit={(answers) => runPrepare(payload, answers)} />
                  ) : (
                    <Opening onSubmit={submitOpening} />
                  )}
                </div>
              </div>
            </Window>
            <Window title="warming up">
              <FieldPreview turns={turns} stepIdx={stepIdx} />
            </Window>
          </div>
        </div>
      )}
    </div>
  );
}

function Opening({ onSubmit }: {
  onSubmit: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  return (
    <div className="fade-up" style={{ display: "grid", gap: 10 }}>
      <AgentLine>{OPENING_PROMPT}</AgentLine>
      <div style={{ marginLeft: 42, display: "grid", gap: 10 }}>
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
          {OPENING_OPTIONS.map((option) => (
            <OptionChip key={option} label={option} onClick={() => onSubmit(option)} />
          ))}
        </div>
      </div>
    </div>
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

function PastTurn({ prompt, answer }: {
  prompt: string;
  answer: string;
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <AgentLine muted>{prompt}</AgentLine>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ maxWidth: "92%", padding: "11px 14px", background: "#2a2a2a", color: "#fff", borderRadius: "4px 4px 2px 4px", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.5, wordBreak: "break-word" }}>{answer}</div>
      </div>
    </div>
  );
}

function SignalSummary({ description, note, canCreate, onChange, onCreate, onRecheck }: {
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
          aria-label="Signal description"
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
          <Btn primary disabled={!description.trim() || description.length > 65_536} onClick={onCreate}>create this signal</Btn>
        ) : (
          <Btn primary disabled={!description.trim()} onClick={onRecheck}>check signal</Btn>
        )}
      </div>
    </div>
  );
}

function FieldPreview({ turns, stepIdx }: { turns: Turn[]; stepIdx: number }) {
  const lines = [
    "getting a read on what you need…",
    turns[0] ? `you're after: "${truncate(turns[0].answer, 40)}"` : null,
    stepIdx >= 2 ? "sharpening the edges…" : null,
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
    <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
      <Window title="calibrating" style={{ width: 420, height: "auto" }}>
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

export const Component = NewSignalPage;

/** A server reason worth showing ("Signal limit reached."), or "try again." for transport noise. */
function createFailureReason(error: unknown): string {
  const raw = error instanceof APIError && error.status > 0 && error.status < 500 ? error.message.trim() : "";
  if (!raw || /^HTTP \d/.test(raw)) return "try again.";
  return /[.!?]$/.test(raw) ? raw : `${raw}.`;
}
