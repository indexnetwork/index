import { useEffect, useMemo, useRef, useState } from "react";

import { REPORTER_BRIEFING_KICKOFF } from "@indexnetwork/protocol";
import { useAIChat } from "@/contexts/AIChatContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useQuestions } from "@/contexts/QuestionsContext";
import { useIntents } from "@/contexts/APIContext";
import type { Suggestion } from "@/hooks/useSuggestions";
import ChatContent from "@/components/ChatContent";

const REPORTER_SUGGESTIONS: Suggestion[] = [
  { label: "What did you do in the last 24 hours?", type: "direct", followupText: "What did you do in the last 24 hours?" },
  { label: "Which signals got new opportunities?", type: "direct", followupText: "Which signals got new opportunities?" },
  { label: "What's waiting on me?", type: "direct", followupText: "What's waiting on me?" },
  { label: "Give me the short version", type: "direct", followupText: "Give me the short version of what's happening." },
];

/** Read-only, web-only reporter chat surface for /agent. */
export default function AgentReporterSurface() {
  const { isAuthenticated, features } = useAuthContext();
  const { messages, startReporterSession, sendWebMessage } = useAIChat();
  const intentsService = useIntents();
  const { globalPending, loading: questionsLoading } = useQuestions();
  const [activeSignalCount, setActiveSignalCount] = useState<number | null>(null);
  const [signalsLoading, setSignalsLoading] = useState(true);
  const startedRef = useRef(false);

  const agentSurfaceEnabled = features?.agentSurface === true;

  useEffect(() => {
    if (!isAuthenticated || !agentSurfaceEnabled || startedRef.current) return;
    startedRef.current = true;
    startReporterSession();
    // The reporter prompt builder matches this marker to produce the opening briefing.
    void sendWebMessage(
      REPORTER_BRIEFING_KICKOFF,
      undefined,
      undefined,
      { hidden: true, persona: "reporter" },
    );
  }, [agentSurfaceEnabled, isAuthenticated, sendWebMessage, startReporterSession]);

  useEffect(() => {
    let active = true;
    void intentsService.getIntents(1, 100, false)
      .then((response) => {
        if (!active) return;
        const count = response.intents.filter((intent: { status?: string | null }) => (
          !intent.status || intent.status === "ACTIVE"
        )).length;
        setActiveSignalCount(count);
      })
      .catch(() => {
        if (active) setActiveSignalCount(null);
      })
      .finally(() => {
        if (active) setSignalsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [intentsService]);

  const hasUserMessage = useMemo(
    () => messages.some((message) => message.role === "user"),
    [messages],
  );
  const suggestions = hasUserMessage ? [] : REPORTER_SUGGESTIONS;
  const isStatusLoading = signalsLoading || questionsLoading || activeSignalCount === null;

  return (
    <div className="flex min-h-full flex-col">
      <div className="border-b border-gray-100 bg-white px-6 py-5 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <h1 className="font-ibm-plex-mono text-xl font-bold text-[#041729]">Agent reporter</h1>
          <p className="mt-1 text-xs font-ibm-plex-mono text-gray-500" aria-live="polite">
            {isStatusLoading
              ? "online"
              : `online — watching ${activeSignalCount} signals · ${globalPending} questions pending`}
          </p>
        </div>
      </div>
      <ChatContent
        persona="reporter"
        readOnlySurface
        suggestionOverride={suggestions}
      />
    </div>
  );
}
