import { useState, useRef, KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { ChevronRight, CornerDownLeft, Loader2 } from "lucide-react";

import ClientLayout from "@/components/ClientLayout";
import { ContentContainer } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useIntents } from "@/contexts/APIContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { log } from "@/lib/logger";

const logger = log.ui.from("NewSignal");

/**
 * Static example prompts shown under "OR PICK ONE". Clicking one fills the
 * input; the user can edit before sending. Intentionally fixed (no backend).
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
 * lands on the signal detail page.
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
          {/* Heading */}
          <div className="flex items-center gap-2.5 mb-6">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#041729] text-white text-xs font-bold font-ibm-plex-mono">
              h
            </div>
            <h1 className="text-lg font-bold text-black font-ibm-plex-mono">
              who are you trying to meet right now?
            </h1>
          </div>

          {/* Examples */}
          <p className="mb-2 text-[11px] font-bold tracking-[0.2em] text-gray-400 font-ibm-plex-mono uppercase">
            Or pick one
          </p>
          <div className="space-y-2 mb-6">
            {EXAMPLE_PROMPTS.map((prompt) => (
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

          {/* Input row: chevron + underline input, send button on the right */}
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
                placeholder="meet cool AI people in NYC · get feedback on a new idea…"
                className="flex-1 bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none disabled:opacity-50"
              />
            </div>
            <Button type="button" size="sm" onClick={handleSend} disabled={!canSend} className="shrink-0 gap-1.5">
              {submitting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  send
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export default NewSignalPage;
export const Component = NewSignalPage;
