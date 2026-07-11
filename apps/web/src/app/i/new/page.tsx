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
  const inputRef = useRef<HTMLInputElement>(null);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const value = answers[step];
  const trimmed = value.trim();
  const canAdvance = (!current.required || trimmed.length > 0) && !submitting;

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
  // waiting for state to flush.
  const advance = (ans: string[]) => {
    if (isLast) {
      void submit(ans);
      return;
    }
    setStep((s) => s + 1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleNext = () => {
    if (!canAdvance) return;
    advance(answers);
  };

  const handleBack = () => {
    if (step === 0) {
      navigate(-1);
      return;
    }
    setStep((s) => s - 1);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleNext();
    }
  };

  // Clicking an example selects it AND advances — no separate button click.
  const pickExample = (prompt: string) => {
    const next = answers.map((a, i) => (i === step ? prompt : a));
    setAnswers(next);
    advance(next);
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
              <div key={s.key}>
                <h2 className="text-base font-bold text-black font-ibm-plex-mono">
                  {s.question}
                </h2>
                {/* Previous answers stay editable */}
                <div className="mt-1.5 flex items-center gap-2 border-b border-transparent pb-1 hover:border-gray-200 focus-within:border-[#041729] transition-colors">
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                  <input
                    type="text"
                    value={answers[i]}
                    onChange={(e) => setAnswerAt(i, e.target.value)}
                    placeholder="skipped"
                    disabled={submitting}
                    className="flex-1 bg-transparent text-sm text-gray-700 placeholder:italic placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
                  />
                </div>
              </div>
            ))}

            {/* Current question */}
            <div>
              <h1 className="mb-6 text-base font-bold text-black font-ibm-plex-mono">
                {current.question}
              </h1>

              {/* Options for this step */}
              {current.examples && current.examples.length > 0 && (
                <>
                  <div className="space-y-2 mb-6">
                    {current.examples.map((prompt) => (
                      <button
                        key={prompt}
                        type="button"
                        onClick={() => pickExample(prompt)}
                        className="w-full text-left px-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {/* Input row */}
              <div className="flex items-end gap-2">
                <div className="flex flex-1 items-center gap-2 border-b border-gray-300 pb-1.5 focus-within:border-[#041729] transition-colors">
                  <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
                  <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    autoFocus
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={submitting}
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
              {!current.required && (
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={submitting}
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
