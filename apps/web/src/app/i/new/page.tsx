import { useState, useRef, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { ArrowLeft, CornerDownLeft, ChevronRight, Loader2 } from "lucide-react";

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
      <div className="px-6 lg:px-8 py-6 pb-32 flex-1">
        <ContentContainer size="wide">
          {/* Top row: back · label · progress */}
          <div className="flex items-center gap-4 mb-12">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-black transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              back
            </button>
            <span className="text-sm font-bold tracking-widest text-black font-ibm-plex-mono uppercase">
              New signal
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-[#041729] max-w-md" />
          </div>

          {/* Heading */}
          <div className="flex items-center gap-4 mb-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#041729] text-white text-lg font-bold font-ibm-plex-mono">
              h
            </div>
            <h1 className="text-2xl lg:text-3xl font-bold text-black font-ibm-plex-mono">
              who are you trying to meet right now?
            </h1>
          </div>
          <p className="text-base text-gray-500 mb-10 ml-15">
            one sentence is enough — the agent handles the rest.
          </p>

          {/* Examples */}
          <p className="text-xs tracking-widest text-gray-400 font-ibm-plex-mono uppercase mb-3">
            or pick one
          </p>
          <div className="space-y-3 mb-8">
            {EXAMPLE_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => pickExample(prompt)}
                className="w-full text-left px-5 py-4 rounded-xl border border-gray-200 bg-white text-[15px] text-gray-900 hover:border-gray-300 hover:shadow-sm transition-all"
              >
                {prompt}
              </button>
            ))}
          </div>

          {/* Input row */}
          <div className="flex items-end gap-3">
            <div className="flex flex-1 items-center gap-2 border-b border-gray-300 pb-2 focus-within:border-[#041729] transition-colors">
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
              <input
                ref={inputRef}
                type="text"
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={submitting}
                placeholder="meet cool AI people in NYC · find a co-founder…"
                className="flex-1 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
              />
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className={cn(
                "flex items-center gap-2 px-5 py-3 rounded-xl bg-[#041729] text-white text-sm font-bold font-ibm-plex-mono transition-colors hover:bg-[#0a2d4a]",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  send
                  <CornerDownLeft className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export default NewSignalPage;
export const Component = NewSignalPage;
