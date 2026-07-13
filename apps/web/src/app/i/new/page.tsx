import { useState, useRef, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, ChevronLeft, CornerDownLeft, Loader2 } from "lucide-react";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useIntents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { log } from "@/lib/logger";

const logger = log.ui.from("NewSignal");

/**
 * Steps of the signal-creation flow. Step 1 is required (the core sentence) and
 * shows example prompts; the follow-ups refine the signal and are optional
 * (skippable). All answers are combined into one signal description on the last
 * step, then created via POST /intents.
 */
interface Step {
  key: string;
  question: string;
  placeholder: string;
  examples?: string[];
  required?: boolean;
  /** Prefix used when folding this answer into the combined description. */
  label?: string;
}

/**
 * Motion timing for the "next question is generating" hand-off. THINK_MS is a
 * placeholder for real generation latency — once the follow-ups are generated
 * from prior answers, drive the thinking phase off the actual request instead
 * of this fixed delay. REVEAL_GAP is the beat between the question settling in
 * and the options cascading; STAGGER is the per-option cascade offset.
 */
const THINK_MS = 900;
const REVEAL_GAP_MS = 220;
const STAGGER_MS = 55;
const PICK_CONFIRM_MS = 240;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const STEPS: Step[] = [
  {
    key: "who",
    question: "who are you trying to meet right now?",
    placeholder: "meet cool AI people in NYC · get feedback on a new idea…",
    required: true,
    examples: [
      "want to meet cool ai people in nyc",
      "have a new business idea, want honest feedback from others",
      "looking for a cool open-source project to contribute to",
      "want to find a co-founder who's actually shipped something",
    ],
  },
  {
    key: "match",
    question: "what would make someone a great match?",
    placeholder: "they've shipped a product · they're in climate · they can intro me to investors…",
    label: "A great match",
    examples: [
      "they've actually shipped a product",
      "they're deep in the same space as me",
      "they can make warm intros",
      "they think differently than i do",
    ],
  },
  {
    key: "context",
    question: "anything specific — timing, location, or the kind of person?",
    placeholder: "based in NYC · moving in the next month · technical co-founder…",
    label: "Specifics",
    examples: [
      "based in nyc or willing to travel",
      "looking to start in the next month",
      "technical, can build things",
      "no constraints — surprise me",
    ],
  },
];

/**
 * New Signal creation flow. A short multi-step questionnaire: the first step
 * captures who the user wants to meet; the follow-ups refine it. On the last
 * step the combined answers become a signal (POST /intents) and the user lands
 * on the signal detail page.
 */
function NewSignalPage() {
  const navigate = useNavigate();
  const intentsService = useIntents();
  const { error } = useNotifications();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => STEPS.map(() => ""));
  const [submitting, setSubmitting] = useState(false);
  // "thinking" shows the pulsing dots while the next question is (mock) generated;
  // revealNonce is bumped on each hand-off to re-key the question/options so their
  // entrance animation replays. pickedIndex confirms the chosen option mid-hand-off.
  const [thinking, setThinking] = useState(false);
  const [revealNonce, setRevealNonce] = useState(0);
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const value = answers[step];
  const trimmed = value.trim();
  const busy = submitting || thinking || pickedIndex !== null;
  const canAdvance = (!current.required || trimmed.length > 0) && !busy;

  const setAnswerAt = (index: number, v: string) => {
    setAnswers((prev) => prev.map((a, i) => (i === index ? v : a)));
  };
  const setValue = (v: string) => setAnswerAt(step, v);

  const buildDescription = (ans: string[]) =>
    STEPS.map((s, i) => {
      const a = ans[i].trim();
      if (!a) return "";
      return s.label ? `${s.label}: ${a}` : a;
    })
      .filter(Boolean)
      .join("\n");

  const submit = async (ans: string[]) => {
    setSubmitting(true);
    try {
      const { intentId } = await intentsService.createIntent(buildDescription(ans));
      navigate(`/i/${intentId}`);
    } catch (err) {
      logger.error("Failed to create signal", { error: err });
      error("Couldn't create your signal. Please try again.");
      setSubmitting(false);
    }
  };

  // Advance to the next step (or create on the last), using an explicit answers
  // array so callers can advance immediately after setting a value without
  // waiting for state to flush. Between steps we play the hand-off: the answer
  // folds into the transcript, the next question "generates" (thinking dots),
  // then the question settles in and its options cascade.
  //
  // fromExample confirms the clicked option (navy ring, siblings recede) before
  // folding it up; typed/next/skip advances pass null and skip that beat.
  const advance = async (ans: string[], fromExample: number | null = null) => {
    if (isLast) {
      void submit(ans);
      return;
    }
    if (fromExample !== null) {
      setPickedIndex(fromExample);
      await sleep(PICK_CONFIRM_MS);
    }
    setAnswers(ans);
    setThinking(true);
    setPickedIndex(null);
    setStep((s) => s + 1);
    await sleep(THINK_MS);
    setThinking(false);
    setRevealNonce((n) => n + 1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleNext = () => {
    if (!canAdvance) return;
    void advance(answers);
  };

  const handleBack = () => {
    if (busy) return;
    if (step === 0) {
      navigate(-1);
      return;
    }
    setStep((s) => s - 1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  // Jump back to an earlier step to re-answer it (later answers are preserved).
  const goToStep = (i: number) => {
    if (busy) return;
    setStep(i);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    }
  };

  // Clicking an example selects it AND advances — no separate button click.
  const pickExample = (prompt: string, index: number) => {
    if (busy) return;
    const next = answers.map((a, i) => (i === step ? prompt : a));
    setAnswers(next);
    void advance(next, index);
  };

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-24 flex-1">
        <ContentContainer>
          {/* Back */}
          <div className="mb-6">
            <button
              type="button"
              onClick={handleBack}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              back
            </button>
          </div>

          {/* Conversation transcript: answered questions stay visible */}
          <div className="space-y-6">
            {STEPS.slice(0, step).map((s, i) => (
              <button
                key={s.key}
                type="button"
                onClick={() => goToStep(i)}
                disabled={busy}
                className="group block w-full text-left"
              >
                <h2 className="text-base font-bold text-black font-ibm-plex-mono">
                  {s.question}
                </h2>
                <p className="mt-1.5 flex items-center gap-2 text-sm">
                  {answers[i].trim() ? (
                    <span className="text-gray-700">{answers[i]}</span>
                  ) : (
                    <span className="italic text-gray-400">skipped</span>
                  )}
                  <span className="text-xs text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity">
                    edit
                  </span>
                </p>
              </button>
            ))}

            {/* Current question. While the next question "generates" we show the
                thinking dots where it will land; then it streams in and options
                cascade. */}
            <div>
              {thinking ? (
                <h1 className="mb-6 flex h-[22px] items-center">
                  <span className="inline-flex items-center gap-1.5" aria-label="generating the next question">
                    <span className="signal-think-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <span className="signal-think-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
                    <span className="signal-think-dot h-1.5 w-1.5 rounded-full bg-gray-400" />
                  </span>
                </h1>
              ) : (
                <h1
                  key={`q-${step}-${revealNonce}`}
                  className="signal-rise mb-6 text-base font-bold text-black font-ibm-plex-mono"
                >
                  {current.question}
                </h1>
              )}

              {/* Options for this step — hidden during the thinking phase, then
                  cascade in one at a time. */}
              {!thinking && current.examples && current.examples.length > 0 && (
                <div className="space-y-2 mb-6">
                  {current.examples.map((prompt, i) => (
                    <button
                      key={`${step}-${prompt}-${revealNonce}`}
                      type="button"
                      onClick={() => pickExample(prompt, i)}
                      disabled={busy}
                      style={{ animationDelay: `${REVEAL_GAP_MS + i * STAGGER_MS}ms` }}
                      className={`signal-rise w-full text-left px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all ${
                        pickedIndex === i
                          ? "signal-opt-picked"
                          : pickedIndex !== null
                            ? "signal-opt-dim"
                            : ""
                      }`}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}

              {/* Input row (kept mounted through the thinking phase to preserve
                  focus/ref, but hidden so only the dots show). */}
              <div className={`${thinking ? "hidden" : "flex"} items-end gap-2`}>
                <div className="flex flex-1 items-center gap-2 border-b border-gray-300 pb-1.5 focus-within:border-[#041729] transition-colors">
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    autoFocus
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={busy}
                    placeholder={current.placeholder}
                    className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
                  />
                </div>
                <Button type="button" size="sm" onClick={handleNext} disabled={!canAdvance} className="shrink-0 gap-1.5">
                  {submitting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : isLast ? (
                    <>
                      send
                      <CornerDownLeft className="h-3.5 w-3.5" />
                    </>
                  ) : (
                    <>
                      next
                      <ChevronRight className="h-3.5 w-3.5" />
                    </>
                  )}
                </Button>
              </div>

              {/* Skip (optional steps) */}
              {!thinking && !current.required && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={busy}
                  className="mt-4 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {isLast ? "skip and create" : "skip this"}
                </button>
              )}
            </div>
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export default NewSignalPage;
export const Component = NewSignalPage;
