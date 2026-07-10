import { useState, useRef, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronLeft, ArrowUp, Loader2 } from "lucide-react";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { useIntents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { cn } from "@/lib/utils";
import { log } from "@/lib/logger";

const logger = log.ui.from("NewSignal");

/**
 * Static example prompts shown under "OR PICK ONE". Clicking one fills the
 * input; the user can edit before sending. Intentionally fixed (no backend) —
 * agent-generated suggestions are out of scope for this page.
 */
const EXAMPLE_PROMPTS = [
  "want to meet cool ai people in nyc",
  "have a new business idea, want honest feedback from others",
  "looking for a cool open-source project to contribute to",
  "want to find a co-founder who's actually shipped something",
];

/**
 * New Signal page. One sentence describing who the user wants to meet becomes a
 * signal (intent); on send it is created directly (POST /intents) and the user
 * lands on the signal detail page. Single step — the agent handles refinement
 * afterward via intent-centric questions on the detail page.
 */
function NewSignalPage() {
  const navigate = useNavigate();
  const intentsService = useIntents();
  const { error } = useNotifications();
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !submitting;

  const handleSend = async () => {
    if (!canSend) return;
    setSubmitting(true);
    try {
      const { intentId } = await intentsService.createIntent(trimmed);
      navigate(`/i/${intentId}`);
    } catch (err) {
      logger.error("Failed to create signal", { error: err });
      error("Couldn't create your signal. Please try again.");
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const pickExample = (prompt: string) => {
    setValue(prompt);
    inputRef.current?.focus();
  };

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-6 pb-24 flex-1">
        <ContentContainer>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-black transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          {/* Prompt card — mirrors the signal detail card */}
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2.5 mb-1.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#041729] text-white text-xs font-bold font-ibm-plex-mono">
                h
              </div>
              <h1 className="text-base font-bold text-black font-ibm-plex-mono leading-snug">
                who are you trying to meet right now?
              </h1>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              one sentence is enough — the agent handles the rest.
            </p>

            {/* Composer — matches the app's message input */}
            <div className="flex items-center gap-2 bg-[#FCFCFC] border border-[#E9E9E9] rounded-full pl-4 pr-1.5 py-1.5">
              <input
                ref={inputRef}
                type="text"
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={submitting}
                placeholder="meet cool AI people in NYC · find a co-founder…"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!canSend}
                className={cn(
                  "shrink-0 h-8 w-8 flex items-center justify-center rounded-full bg-[#041729] text-white hover:bg-[#0a2d4a] transition-colors",
                  "disabled:opacity-50 disabled:cursor-not-allowed",
                )}
                aria-label="Create signal"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Examples */}
          <p className="mb-2 text-xs font-bold tracking-[0.2em] text-[#3D3D3D] font-ibm-plex-mono uppercase">
            Or pick one
          </p>
          <div className="space-y-2">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => pickExample(prompt)}
                className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export default NewSignalPage;
export const Component = NewSignalPage;
