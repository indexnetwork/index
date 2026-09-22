import { useState } from "react";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { RecoveryForm } from "@/app/i/new/RecoveryForm";
import { signalService, type PrepareAnswer, type RecoveryField } from "@/services/signals";

/** The opening question: whatever is answered here becomes the signal. */
const OPENING_PROMPT = "Who are you trying to reach, and why?";

/** Whole signals rather than categories — same material typing would provide. */
const OPENING_OPTIONS = [
  { label: "want to meet cool ai people in nyc", description: "" },
  { label: "have a new business idea, want honest feedback from others", description: "" },
  { label: "looking for a cool open-source project to contribute to", description: "" },
  { label: "want to find a co-founder who's actually shipped something", description: "" },
];

type Stage = "opening" | "recovery" | "summary" | "retry";

/** Prepare the complete draft before offering an editable final review. */
export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { error: showError } = useNotifications();

  const [stage, setStage] = useState<Stage>("opening");
  const [payload, setPayload] = useState("");
  const [recoveryFields, setRecoveryFields] = useState<RecoveryField[]>([]);
  const [recoveryUsed, setRecoveryUsed] = useState(false);
  const [preparationReceipt, setPreparationReceipt] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const runPrepare = async (text: string, answers: PrepareAnswer[] = []) => {
    setBusy(true);
    try {
      const result = await signalService.prepare(text, answers);
      setPayload(result.payload);
      if (result.status === "ready") {
        setPreparationReceipt(result.preparationReceipt);
        setFeedback("");
        setStage("summary");
        return;
      }
      setFeedback(result.feedback);
      if (!recoveryUsed) {
        setRecoveryFields(result.recovery);
        setRecoveryUsed(true);
        setStage("recovery");
        return;
      }
      setStage("summary");
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

  const create = async () => {
    if (creating || !payload.trim() || payload.length > 65_536 || !preparationReceipt) return;
    setCreating(true);
    try {
      const created = await signalService.create(payload, preparationReceipt);
      navigate(`/i/${created.intentId}`);
    } catch {
      showError("Couldn't create this signal. Try again.");
      setCreating(false);
    }
  };

  if (!isAuthenticated) return <Navigate to="/" replace />;

  const progressStep = stage === "summary" ? 2 : 1;

  return (
    <div className="min-h-screen bg-[#FDFDFD] px-5 py-6 sm:px-8 sm:py-10">
      <main className="mx-auto w-full max-w-2xl">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1 text-sm text-gray-500 transition hover:text-[#041729]"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <p className="mt-10 text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Start a new signal</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-[#041729] sm:text-4xl">Make what you’re looking for legible.</h1>

        <div className="mt-8 flex gap-1.5" aria-label="Signal progress">
          {Array.from({ length: 2 }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full ${
                index < progressStep ? "bg-[#041729]" : index === progressStep - 1 ? "bg-[#8BA8B8]" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {busy ? (
          <div role="status" className="mt-14 flex items-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Taking that in…
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
          <section aria-label="Preparation failed" className="mt-8">
            <h2 className="text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">
              Couldn’t reach your agent.
            </h2>
            <p className="mt-2 text-sm text-gray-500">Your answers are kept.</p>
            <button
              type="button"
              onClick={() => void runPrepare(payload)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a]"
            >
              Try again
            </button>
          </section>
        ) : stage === "recovery" ? (
          <RecoveryForm
            fields={recoveryFields}
            feedback={feedback}
            busy={busy}
            onSubmit={submitRecovery}
          />
        ) : (
          <OpeningQuestion onSubmit={submitOpening} />
        )}
      </main>
    </div>
  );
}

/** Opening turn before the first prepare call. */
function OpeningQuestion({ onSubmit }: { onSubmit: (text: string) => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const text = [...selected, freeText.trim()].filter(Boolean).join(" — ");

  const toggleOption = (label: string) => {
    setSelected((current) => (current.includes(label) ? [] : [label]));
  };

  return (
    <section aria-label="Opening question" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">First</p>
      <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">{OPENING_PROMPT}</h2>
      <textarea
        value={freeText}
        onChange={(event) => setFreeText(event.target.value)}
        rows={4}
        maxLength={65_536}
        placeholder="Type what you’re looking for…"
        className="mt-6 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10"
      />
      <p className="mt-6 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Or pick one</p>
      <div className="mt-3 grid gap-3">
        {OPENING_OPTIONS.map((option) => {
          const checked = selected.includes(option.label);
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={checked}
              onClick={() => toggleOption(option.label)}
              className={`rounded-2xl border px-4 py-3 text-left transition ${
                checked
                  ? "border-[#041729] bg-[#041729] text-white"
                  : "border-gray-200 bg-white text-gray-800 hover:border-gray-400"
              }`}
            >
              <span className="block text-sm font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={text.length === 0}
        onClick={() => void onSubmit(text)}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" /> Continue
      </button>
    </section>
  );
}

/** Final description editor; preparation remains valid throughout revisions. */
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
    <section aria-label="Your signal" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Review</p>
      {feedback && <p className="mt-3 text-sm text-amber-800">{feedback}</p>}
      <textarea
        aria-label="Signal description"
        value={description}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        maxLength={65_536}
        rows={6}
        className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-base leading-relaxed text-[#041729] outline-none focus:border-[#041729] disabled:opacity-60"
      />
      <p className="mt-3 text-xs text-gray-500">Going out to · everywhere</p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {canCreate ? (
          <button
            type="button"
            disabled={busy || !description.trim() || description.length > 65_536}
            onClick={onCreate}
            className="inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Create signal
          </button>
        ) : (
          <button
            type="button"
            disabled={busy || !description.trim()}
            onClick={onRecheck}
            className="inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Check signal
          </button>
        )}
      </div>
    </section>
  );
}

export const Component = NewSignalPage;
