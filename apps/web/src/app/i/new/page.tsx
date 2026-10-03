import { useState } from "react";
import { Navigate, useNavigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { RecoveryForm } from "@/app/i/new/RecoveryForm";
import { signalService, type PrepareAnswer, type RecoveryField } from "@/services/signals";
import { CALIBRATING_LINES } from "@/components/workbench/mac-blocks";
import { Btn, Window } from "@/components/workbench/Workbench";

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

/** Prepare the draft, asking follow-ups until it's ready, then create it. */
export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const [stage, setStage] = useState<Stage>("opening");
  const [payload, setPayload] = useState("");
  const [recoveryFields, setRecoveryFields] = useState<RecoveryField[]>([]);
  const [preparationReceipt, setPreparationReceipt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const runPrepare = async (text: string, answers: PrepareAnswer[] = []) => {
    setBusy(true);
    try {
      const result = await signalService.prepare(text, answers);
      setPayload(result.payload);
      // No approval step: a ready draft is created as it stands. Anything else
      // goes back to the questions, since create needs the ready receipt.
      if (result.status === "ready") {
        setPreparationReceipt(result.preparationReceipt);
        void create(result.payload, result.preparationReceipt);
        return;
      }
      setPreparationReceipt("");
      setFeedback(result.feedback);
      setRecoveryFields(result.recovery);
      setStage(result.recovery.length ? "recovery" : "summary");
    } catch {
      setStage("retry");
    } finally {
      setBusy(false);
    }
  };

  const submitOpening = async (text: string) => {
    setPayload(text);
    await runPrepare(text);
  };

  const submitRecovery = async (answers: PrepareAnswer[]) => {
    await runPrepare(payload, answers);
  };

  const recheck = async () => {
    await runPrepare(payload);
  };

  const create = async (description = payload, receipt = preparationReceipt) => {
    if (creating || !description.trim() || description.length > 65_536 || !receipt) return;
    setCreating(true);
    try {
      const created = await signalService.create(description, receipt);
      navigate(`/i/${created.intentId}`);
    } catch (error) {
      setPreparationReceipt("");
      setFeedback(`that didn't go through — ${error instanceof Error ? error.message : "try again."}`);
      setStage("summary");
      setCreating(false);
    }
  };

  if (!isAuthenticated) return <Navigate to="/" replace />;

  const progressStep = stage === "summary" ? 2 : 1;

  return (
    <div className="workbench mac-desktop" style={{ height: "100vh" }}>
      <div style={{
        height: "100%",
        display: "grid",
        placeItems: "center",
        padding: "56px 40px",
      }}>
        <div style={{
          width: 980,
          maxWidth: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)",
          gap: 18,
          height: "min(720px, calc(100vh - 128px))",
        }}>
          <Window title="calibrating" onClose={() => navigate("/")}>
            <div style={{ padding: "18px 28px 12px", display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <button type="button" onClick={() => navigate("/")} style={{ fontFamily: "var(--mac-mono)", fontSize: 13, background: "transparent", border: "none", padding: 0, marginBottom: 16 }}>← back</button>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 24 }}>
                <span style={{ fontFamily: "var(--mac-mono)", fontSize: 11, color: "#8f8f88" }}>step {progressStep} of 2</span>
                <div style={{ flex: 1, display: "flex", gap: 3 }}>
                  {[0, 1].map((i) => (
                    <div key={i} style={{
                      flex: 1,
                      height: 8,
                      border: "1px solid #000",
                      background: i < progressStep - 1 ? "#000" : i === progressStep - 1 ? "repeating-linear-gradient(45deg, #000 0, #000 2px, #fff 2px, #fff 4px)" : "#fff",
                    }} />
                  ))}
                </div>
              </div>
              <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {busy || creating ? (
                  <div role="status" style={{ textAlign: "center" }}>
                    {CALIBRATING_LINES.map((line, i) => (
                      <div key={line} style={{
                        fontFamily: "var(--mac-sans)", fontSize: 15, padding: "4px 0",
                        color: i === CALIBRATING_LINES.length - 1 ? "#000" : "var(--ink-2)",
                        fontWeight: i === CALIBRATING_LINES.length - 1 ? 700 : 400,
                      }}>
                        <span style={{ marginRight: 8, fontFamily: "var(--mac-mono)" }}>›</span>{line}
                      </div>
                    ))}
                  </div>
                ) : stage === "summary" ? (
                  <SignalSummary
                    description={payload}
                    feedback={preparationReceipt ? "" : feedback}
                    canCreate={Boolean(preparationReceipt)}
                    busy={creating}
                    onChange={setPayload}
                    onCreate={() => void create()}
                    onRecheck={() => void recheck()}
                  />
                ) : stage === "retry" ? (
                  <div>
                    <p style={{ fontFamily: "var(--mac-sans)", fontSize: 14 }}>couldn&apos;t reach your agent.</p>
                    <div style={{ marginTop: 12 }}>
                      <Btn primary onClick={() => void runPrepare(payload)}>try again</Btn>
                    </div>
                  </div>
                ) : stage === "recovery" ? (
                  <RecoveryForm fields={recoveryFields} feedback={feedback} busy={busy} onSubmit={submitRecovery} />
                ) : (
                  <OpeningQuestion onSubmit={submitOpening} />
                )}
              </div>
            </div>
          </Window>
          <Window title="warming up">
            <div style={{ padding: 28 }}>
              <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>index</p>
              <div style={{ marginTop: 16, border: "1px solid #000", height: 10, overflow: "hidden" }}>
                <div style={{
                  height: "100%",
                  backgroundImage: "repeating-linear-gradient(-45deg, #000 0, #000 6px, #fff 6px, #fff 12px)",
                  animation: busy || creating ? "mac-stripes 0.8s linear infinite" : undefined,
                  backgroundSize: "24px 24px",
                  width: busy || creating ? "100%" : "30%",
                }} />
              </div>
            </div>
          </Window>
        </div>
      </div>
    </div>
  );
}

/** Opening turn before the first prepare call. */
function OpeningQuestion({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [draft, setDraft] = useState("");
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <p style={{ fontFamily: "var(--mac-sans)", fontSize: 14 }}>{OPENING_PROMPT}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) void onSubmit(draft.trim());
        }}
        style={{ maxWidth: 620, border: "1px solid #000", background: "#fff", display: "flex", flexDirection: "column" }}
      >
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={3}
          maxLength={65_536}
          placeholder={OPENING_PLACEHOLDER}
          style={{ background: "transparent", border: "none", outline: "none", fontFamily: "var(--mac-sans)", fontSize: 14, lineHeight: 1.45, resize: "vertical", padding: "11px 14px 4px" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 8px 8px" }}>
          <Btn primary small type="submit" disabled={!draft.trim()}>send →</Btn>
        </div>
      </form>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {OPENING_OPTIONS.map((option) => (
          <button key={option} type="button" className="wb-btn small" onClick={() => void onSubmit(option)}>
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function SignalSummary({
  description,
  feedback,
  canCreate,
  busy,
  onChange,
  onCreate,
  onRecheck,
}: {
  description: string;
  feedback: string;
  canCreate: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  onCreate: () => void;
  onRecheck: () => void;
}) {
  return (
    <section aria-label="Your signal">
      <p style={{ fontFamily: "var(--mac-sans)", fontSize: 14 }}>Here&apos;s your signal.</p>
      {feedback && <p style={{ marginTop: 8, fontFamily: "var(--mac-sans)", fontSize: 13 }}>{feedback}</p>}
      <textarea
        aria-label="Signal description"
        value={description}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        maxLength={65_536}
        rows={6}
        style={{ marginTop: 12, width: "100%", border: "1px solid #000", padding: "10px 12px", fontFamily: "var(--mac-sans)", fontSize: 14 }}
      />
      <div style={{ marginTop: 12 }}>
        {canCreate ? (
          <Btn primary disabled={busy || !description.trim() || description.length > 65_536} onClick={onCreate}>
            {busy ? "sending…" : "create this signal"}
          </Btn>
        ) : (
          <Btn primary disabled={busy || !description.trim()} onClick={onRecheck}>check signal</Btn>
        )}
      </div>
    </section>
  );
}

export const Component = NewSignalPage;
