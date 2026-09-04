import { useState } from "react";
import { ChevronLeft, Loader2, Send } from "lucide-react";
import { Navigate, useNavigate } from "react-router";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { signalService, type ClarifyAnswer, type ClarifyQuestion } from "@/services/signals";

/** The opening question: whatever is answered here becomes the signal. */
const OPENING_PROMPT = "Who are you trying to reach, and why?";

/** How many clarifying questions follow the opening one. Caps the loop. */
const MAX_FOLLOW_UPS = 2;
/** The opening question plus the follow-ups. */
const STEP_COUNT = 1 + MAX_FOLLOW_UPS;

/**
 * New signal: the agent asks, you answer, it asks again. Each answer is folded
 * back into the payload by /intents/clarify; then you say where it goes and
 * confirm what was written.
 *
 * Clarifying is never a gate — when it fails the flow moves on with the payload
 * as it stands.
 */
export default function NewSignalPage() {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuthContext();
  const { error: showError } = useNotifications();

  const [stage, setStage] = useState<"ask" | "retry" | "summary">("ask");
  const [payload, setPayload] = useState("");
  const [question, setQuestion] = useState<ClarifyQuestion | null>(null);
  const [queue, setQueue] = useState<ClarifyQuestion[]>([]);
  const [pending, setPending] = useState<ClarifyAnswer[]>([]);
  const [asked, setAsked] = useState(0);
  const [beats, setBeats] = useState(0);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  // Next beat: another question while there is budget and something to ask, one
  // more clarification round to fold in what was just answered, else the gate.
  const advance = async (text: string, waiting: ClarifyQuestion[], answers: ClarifyAnswer[]) => {
    if (asked < MAX_FOLLOW_UPS && waiting.length > 0) {
      setQuestion(waiting[0]);
      setQueue(waiting.slice(1));
      setAsked(asked + 1);
      return;
    }
    if (asked >= MAX_FOLLOW_UPS && answers.length === 0) { setStage("summary"); return; }

    setBusy(true);
    try {
      const result = await signalService.clarify(text, answers);
      setPayload(result.payload);
      setPending([]);
      setStage("ask");
      if (asked < MAX_FOLLOW_UPS && result.questions.length > 0) {
        setQuestion(result.questions[0]);
        setQueue(result.questions.slice(1));
        setAsked(asked + 1);
        return;
      }
      setStage("summary");
    } catch {
      // The answers are kept, so retrying resumes this round rather than
      // restarting the conversation.
      setStage("retry");
    } finally {
      setBusy(false);
    }
  };

  const answer = async (text: string) => {
    setBeats((current) => current + 1);
    if (!question) { setPayload(text); await advance(text, [], []); return; }
    const answers = [...pending, { prompt: question.prompt, answer: text }];
    setPending(answers);
    setQuestion(null);
    await advance(payload, queue, answers);
  };

  const create = async () => {
    setCreating(true);
    try {
      const created = await signalService.create(payload.trim());
      navigate(`/i/${created.intentId}`);
    } catch {
      showError("Couldn't create this signal. Try again.");
      setCreating(false);
    }
  };

  if (!isAuthenticated) return <Navigate to="/" replace />;

  const answered = stage === "summary" ? STEP_COUNT : beats;

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
          {Array.from({ length: STEP_COUNT }).map((_, index) => (
            <span
              key={index}
              className={`h-1.5 flex-1 rounded-full ${
                index < answered ? "bg-[#041729]" : index === answered ? "bg-[#8BA8B8]" : "bg-gray-200"
              }`}
            />
          ))}
        </div>

        {busy ? (
          <div role="status" className="mt-14 flex items-center gap-3 text-sm text-gray-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Taking that in…
          </div>
        ) : stage === "summary" ? (
          <SignalSummary description={payload} busy={creating} onCreate={() => void create()} />
        ) : stage === "retry" ? (
          <section aria-label="Clarification failed" className="mt-8">
            <h2 className="text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">
              Couldn’t reach your agent.
            </h2>
            <p className="mt-2 text-sm text-gray-500">Your answers are kept.</p>
            <button
              type="button"
              onClick={() => void advance(payload, queue, pending)}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a]"
            >
              Try again
            </button>
          </section>
        ) : (
          <Question
            key={question ? question.prompt : "opening"}
            prompt={question ? question.prompt : OPENING_PROMPT}
            options={question ? question.options : []}
            multiSelect={question ? question.multiSelect : false}
            first={!question}
            onAnswer={answer}
          />
        )}
      </main>
    </div>
  );
}

/** One turn: the prompt, the offered answers, and your own words. */
function Question({
  prompt,
  options,
  multiSelect,
  first,
  onAnswer,
}: {
  prompt: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
  first: boolean;
  onAnswer: (text: string) => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [freeText, setFreeText] = useState("");
  const text = [...selected, freeText.trim()].filter(Boolean).join(" — ");

  const toggleOption = (label: string) => {
    setSelected((current) => {
      if (multiSelect) {
        return current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      }
      return current.includes(label) ? [] : [label];
    });
  };

  return (
    <section aria-label="Current question" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{first ? "First" : "Next"}</p>
      <h2 className="mt-3 text-2xl font-semibold leading-tight text-[#041729] sm:text-3xl">{prompt}</h2>
      {multiSelect && <p className="mt-2 text-sm text-gray-500">Choose all that apply.</p>}
      {options.length > 0 && (
        <div className="mt-6 grid gap-3">
          {options.map((option) => {
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
                {option.description && (
                  <span className={`mt-1 block text-xs ${checked ? "text-gray-200" : "text-gray-500"}`}>
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <textarea
        value={freeText}
        onChange={(event) => setFreeText(event.target.value)}
        rows={first ? 4 : 2}
        placeholder={first ? "A founder building in climate hardware, ideally in Berlin…" : "Or tell me in your own words"}
        className="mt-4 w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 outline-none transition placeholder:text-gray-400 focus:border-[#041729] focus:ring-2 focus:ring-[#041729]/10"
      />
      <button
        type="button"
        disabled={text.length === 0}
        onClick={() => void onAnswer(text)}
        className="mt-4 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" /> Continue
      </button>
    </section>
  );
}

/** The confirmation gate: the signal as written, and one button. */
function SignalSummary({
  description,
  busy,
  onCreate,
}: {
  description: string;
  busy: boolean;
  onCreate: () => void;
}) {
  return (
    <section aria-label="Your signal" className="mt-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Here’s your signal</p>
      <blockquote className="mt-4 border-l-2 border-[#041729] pl-4 text-base leading-relaxed text-[#041729]">
        {description}
      </blockquote>
      <p className="mt-3 text-xs text-gray-500">Going out to · everywhere</p>
      <button
        type="button"
        disabled={busy}
        onClick={onCreate}
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#041729] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[#0a2d4a] disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Create signal
      </button>
    </section>
  );
}

export const Component = NewSignalPage;
