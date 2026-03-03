"use client";

import { useState, useEffect } from "react";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Play,
  Square,
  X,
  Circle,
  Cpu,
  Zap,
  MessageSquare,
  User,
  Bot,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";
import type { TraceEvent } from "@/contexts/AIChatContext";
import { cn } from "@/lib/utils";

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return (
    date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }) +
    "." +
    String(date.getMilliseconds()).padStart(3, "0")
  );
}

const TOOL_DESCRIPTIONS: Record<string, { action: string; running: string }> = {
  read_user_profiles: {
    action: "Read profile",
    running: "Reading your profile...",
  },
  create_user_profile: {
    action: "Create profile",
    running: "Creating your profile...",
  },
  update_user_profile: {
    action: "Update profile",
    running: "Updating your profile...",
  },
  read_intents: {
    action: "Fetch intents",
    running: "Fetching your active intents...",
  },
  create_intent: {
    action: "Create intent",
    running: "Creating a new intent...",
  },
  update_intent: {
    action: "Update intent",
    running: "Updating intent...",
  },
  delete_intent: {
    action: "Delete intent",
    running: "Removing intent...",
  },
  create_intent_index: {
    action: "Save to index",
    running: "Saving intent to index...",
  },
  read_intent_indexes: {
    action: "Fetch index intents",
    running: "Fetching intents in index...",
  },
  delete_intent_index: {
    action: "Remove from index",
    running: "Removing intent from index...",
  },
  read_indexes: {
    action: "Check indexes",
    running: "Checking your indexes...",
  },
  create_index: {
    action: "Create index",
    running: "Creating a new index...",
  },
  update_index: {
    action: "Update index",
    running: "Updating index...",
  },
  delete_index: {
    action: "Delete index",
    running: "Deleting index...",
  },
  create_index_membership: {
    action: "Add member",
    running: "Adding member to index...",
  },
  read_index_memberships: {
    action: "Fetch memberships",
    running: "Fetching index memberships...",
  },
  create_opportunities: {
    action: "Find opportunities",
    running: "Searching for relevant connections...",
  },
  list_my_opportunities: {
    action: "List opportunities",
    running: "Listing your opportunities...",
  },
  update_opportunity: {
    action: "Update opportunity",
    running: "Updating opportunity status...",
  },
  scrape_url: {
    action: "Read web content",
    running: "Reading content from URL...",
  },
  read_docs: {
    action: "Look up docs",
    running: "Looking up documentation...",
  },
};

function getToolDescription(name: string): { action: string; running: string } {
  return (
    TOOL_DESCRIPTIONS[name] || {
      action: name.replace(/_/g, " "),
      running: `Running ${name.replace(/_/g, " ")}...`,
    }
  );
}

const SPEECH_ACT_LABELS: Record<string, { label: string; color: string }> = {
  COMMISSIVE: { label: "Commitment", color: "text-green-400" },
  DIRECTIVE: { label: "Request", color: "text-blue-400" },
  DECLARATION: { label: "Declaration", color: "text-purple-400" },
  ASSERTIVE: { label: "Statement", color: "text-gray-400" },
  EXPRESSIVE: { label: "Expression", color: "text-yellow-400" },
};

function ScoreBar({ value, label }: { value: number; label: string }) {
  const percentage = Math.min(100, Math.max(0, value));
  const color =
    percentage >= 70
      ? "bg-green-500"
      : percentage >= 50
        ? "bg-yellow-500"
        : "bg-red-500";

  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="w-16 text-gray-500">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full", color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-8 text-right tabular-nums text-gray-400">
        {Math.round(value)}
      </span>
    </div>
  );
}

interface FelicityData {
  clarity?: number;
  authority?: number;
  sincerity?: number;
  entropy?: number;
  classification?: string;
  score?: number;
}

interface CandidateData {
  name?: string;
  bio?: string;
  userId?: string;
  score?: number;
  passed?: boolean;
  reasoning?: string;
  role?: string;
  similarity?: number;
  strategy?: string;
  hasIntent?: boolean;
}

function CandidateScore({ data }: { data: CandidateData }) {
  const { name, bio, score, passed, reasoning, similarity, strategy } = data;
  const rawScore = score ?? (similarity !== undefined ? (similarity <= 1 ? similarity * 100 : similarity) : undefined);
  const displayScore = rawScore !== undefined ? Math.round(rawScore) : undefined;

  if (displayScore === undefined) return null;

  const scoreColor =
    displayScore >= 70
      ? "text-green-400"
      : displayScore >= 50
        ? "text-yellow-400"
        : "text-red-400";

  return (
    <div className="ml-5 mt-1 mb-1 p-2 bg-gray-800/50 rounded border border-gray-700/50 space-y-1">
      <div className="flex items-center gap-3 text-[11px]">
        {name && <span className="text-gray-300 font-medium">{name}</span>}
        <span className={cn("font-mono", scoreColor)}>
          {displayScore}/100
        </span>
        {passed !== undefined && (
          <span className={passed ? "text-green-500" : "text-red-500"}>
            {passed ? "✓ passed" : "✗ below threshold"}
          </span>
        )}
        {strategy && (
          <span className="text-gray-500">via {strategy}</span>
        )}
      </div>
      {bio && (
        <div className="text-[10px] text-gray-500 italic">
          {bio}
        </div>
      )}
      {reasoning && (
        <div className="text-[10px] text-gray-400 leading-relaxed">
          {reasoning}
        </div>
      )}
    </div>
  );
}

interface SearchQueryData {
  hydeText?: string;
  bio?: string;
  context?: string;
  strategy?: string;
  type?: string;
}

function SearchQueryDisplay({ data }: { data: SearchQueryData }) {
  const { hydeText, bio, context, strategy } = data;
  const displayText = hydeText || bio || context;

  if (!displayText) return null;

  return (
    <div className="ml-5 mt-1 mb-1 p-2 bg-blue-900/20 rounded border border-blue-800/30">
      {strategy && (
        <div className="text-[10px] text-blue-400 font-medium mb-1">
          Strategy: {strategy}
        </div>
      )}
      <div className="text-[10px] text-blue-200 leading-relaxed whitespace-pre-wrap">
        {displayText}
      </div>
    </div>
  );
}

function FelicityScores({ data }: { data: FelicityData }) {
  const { clarity, authority, sincerity, entropy, classification } = data;
  const speechAct = classification ? SPEECH_ACT_LABELS[classification] : null;

  const hasScores =
    clarity !== undefined ||
    authority !== undefined ||
    sincerity !== undefined;

  if (!hasScores && !classification) return null;

  return (
    <div className="ml-5 mt-1 mb-1 p-2 bg-gray-800/50 rounded border border-gray-700/50 space-y-1.5">
      {speechAct && (
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-500">Speech Act:</span>
          <span className={cn("font-medium", speechAct.color)}>
            {speechAct.label}
          </span>
          {entropy !== undefined && (
            <span className="text-gray-600 ml-2">
              Entropy: {entropy.toFixed(2)}
            </span>
          )}
        </div>
      )}
      {hasScores && (
        <div className="space-y-1">
          {clarity !== undefined && (
            <ScoreBar value={clarity} label="Clarity" />
          )}
          {authority !== undefined && (
            <ScoreBar value={authority} label="Authority" />
          )}
          {sincerity !== undefined && (
            <ScoreBar value={sincerity} label="Sincerity" />
          )}
        </div>
      )}
    </div>
  );
}

const DECISION_STYLES: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  accept: { label: "Match found", color: "text-green-400", icon: CheckCircle2 },
  decline: { label: "Not a match", color: "text-red-400", icon: XCircle },
  defer: { label: "Timing mismatch", color: "text-yellow-400", icon: Clock },
  continue: { label: "Negotiating", color: "text-blue-400", icon: MessageSquare },
  extend: { label: "Need more info", color: "text-purple-400", icon: MessageSquare },
};

const OUTCOME_STYLES: Record<string, { label: string; color: string; bgColor: string }> = {
  opportunity: { label: "Connection established", color: "text-green-400", bgColor: "bg-green-900/20" },
  disengaged: { label: "No match", color: "text-red-400", bgColor: "bg-red-900/20" },
  deferred: { label: "Deferred for later", color: "text-yellow-400", bgColor: "bg-yellow-900/20" },
};

interface NegotiationEventProps {
  event: TraceEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

function NegotiationEventDisplay({ event, isExpanded, onToggle }: NegotiationEventProps) {
  const { eventType, candidateName, candidateUserId, turn, maxTurns, speaker, message, decision, outcome, reasoning } = event;

  if (eventType === "start") {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-900/20">
        <MessageSquare className="w-3 h-3 text-indigo-400 flex-shrink-0" />
        <span className="text-indigo-300 font-medium">
          Negotiating with {candidateName || candidateUserId?.slice(0, 8) || "agent"}
        </span>
        {maxTurns && (
          <span className="text-gray-500 text-[10px] ml-auto">
            max {maxTurns} turns
          </span>
        )}
      </div>
    );
  }

  if (eventType === "turn") {
    const isUserAgent = speaker === "user_agent";
    const decisionStyle = decision ? DECISION_STYLES[decision] : null;
    const DecisionIcon = decisionStyle?.icon || MessageSquare;

    return (
      <div className="px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="w-full flex items-center gap-2 hover:bg-gray-800/50 rounded px-1 -mx-1"
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 text-gray-500" />
          ) : (
            <ChevronRight className="w-3 h-3 text-gray-500" />
          )}
          {isUserAgent ? (
            <Bot className="w-3 h-3 text-blue-400 flex-shrink-0" />
          ) : (
            <User className="w-3 h-3 text-purple-400 flex-shrink-0" />
          )}
          <span className={isUserAgent ? "text-blue-300" : "text-purple-300"}>
            {isUserAgent ? "Your agent" : candidateName || "Their agent"}
          </span>
          <span className="text-gray-500 text-[10px]">
            Turn {turn}/{maxTurns}
          </span>
          {decisionStyle && (
            <span className={cn("text-[10px] flex items-center gap-1 ml-auto", decisionStyle.color)}>
              <DecisionIcon className="w-3 h-3" />
              {decisionStyle.label}
            </span>
          )}
        </button>
        {isExpanded && message && (
          <div className="ml-5 mt-1 mb-1 p-2 bg-gray-800/50 rounded border border-gray-700/50">
            <div className="text-[10px] text-gray-300 leading-relaxed whitespace-pre-wrap">
              {message}
            </div>
            {reasoning && (
              <div className="mt-1 pt-1 border-t border-gray-700/50 text-[10px] text-gray-500 italic">
                {reasoning}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (eventType === "end") {
    const outcomeStyle = outcome ? OUTCOME_STYLES[outcome] : null;

    return (
      <div className={cn("flex items-center gap-2 px-3 py-1.5", outcomeStyle?.bgColor)}>
        {outcome === "opportunity" ? (
          <CheckCircle2 className="w-3 h-3 text-green-400 flex-shrink-0" />
        ) : outcome === "disengaged" ? (
          <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
        ) : (
          <Clock className="w-3 h-3 text-yellow-400 flex-shrink-0" />
        )}
        <span className={outcomeStyle?.color || "text-gray-300"}>
          {candidateName || candidateUserId?.slice(0, 8) || "Negotiation"}: {outcomeStyle?.label || outcome}
        </span>
      </div>
    );
  }

  return null;
}

interface TraceDisplayProps {
  traceEvents: TraceEvent[];
  isStreaming?: boolean;
}

function RunningTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(Date.now() - startedAt);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Date.now() - startedAt);
    }, 100);
    return () => clearInterval(interval);
  }, [startedAt]);

  return <span className="tabular-nums">{formatDuration(elapsed)}</span>;
}

export function ToolCallsDisplay({
  traceEvents,
  isStreaming,
}: TraceDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [expandedNegotiations, setExpandedNegotiations] = useState<Set<number>>(new Set());

  const toggleNegotiationExpanded = (idx: number) => {
    setExpandedNegotiations((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  if (!traceEvents || traceEvents.length === 0) return null;

  const toolStarts = traceEvents.filter((e) => e.type === "tool_start").length;
  const toolEnds = traceEvents.filter((e) => e.type === "tool_end").length;
  const runningTools = toolStarts - toolEnds;
  const hasErrors = traceEvents.some(
    (e) => e.type === "tool_end" && e.status === "error"
  );

  const firstEvent = traceEvents[0];
  const lastEvent = traceEvents[traceEvents.length - 1];
  const totalDuration =
    firstEvent && lastEvent ? lastEvent.timestamp - firstEvent.timestamp : 0;

  const toggleToolExpanded = (idx: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const getEventDuration = (event: TraceEvent, idx: number): number | null => {
    if (event.type === "llm_start") {
      const llmEnd = traceEvents
        .slice(idx + 1)
        .find((e) => e.type === "llm_end" && e.iteration === event.iteration);
      return llmEnd ? llmEnd.timestamp - event.timestamp : null;
    }
    if (event.type === "tool_start") {
      // Count how many prior tool_start events share the same name (occurrence index)
      const occurrence = traceEvents
        .slice(0, idx)
        .filter((e) => e.type === "tool_start" && e.name === event.name).length;
      // Find the Nth tool_end with the same name (matching occurrence)
      let seen = 0;
      const toolEnd = traceEvents
        .slice(idx + 1)
        .find((e) => e.type === "tool_end" && e.name === event.name && seen++ === occurrence);
      return toolEnd ? toolEnd.timestamp - event.timestamp : null;
    }
    return null;
  };

  return (
    <div className="mb-3 font-mono text-[11px] leading-tight border border-gray-200 rounded-lg overflow-hidden bg-gray-900 text-gray-100">
      {/* Header */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-label={isExpanded ? "Collapse trace" : "Expand trace"}
        aria-expanded={isExpanded}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-gray-300 hover:bg-gray-800 transition-colors border-b border-gray-700"
      >
        {isExpanded ? (
          <ChevronDown className="w-3 h-3 text-gray-500" />
        ) : (
          <ChevronRight className="w-3 h-3 text-gray-500" />
        )}
        <span className="text-gray-500">TRACE</span>
        <span className="text-gray-600">│</span>
        <span>
          {runningTools > 0 || isStreaming ? (
            <span className="text-yellow-400">{traceEvents.length} events</span>
          ) : (
            <span className={hasErrors ? "text-red-400" : "text-green-400"}>
              {traceEvents.length} events
            </span>
          )}
        </span>
        <span className="text-gray-600 ml-auto">
          {runningTools > 0 || isStreaming ? (
            <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
          ) : (
            totalDuration > 0 && formatDuration(totalDuration)
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="divide-y divide-gray-800">
          {traceEvents.map((event, idx) => {
            const duration = getEventDuration(event, idx);
            const isRunning =
              (event.type === "llm_start" || event.type === "tool_start") &&
              duration === null;

            if (event.type === "iteration_start") {
              return (
                <div
                  key={idx}
                  className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/20"
                >
                  <Zap className="w-3 h-3 text-blue-400 flex-shrink-0" />
                  <span className="text-blue-300 font-medium">
                    Starting iteration {event.iteration}
                  </span>
                  <span className="text-gray-600 text-[10px] ml-auto">
                    {formatTime(event.timestamp)}
                  </span>
                </div>
              );
            }

            if (event.type === "llm_start") {
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5",
                    isRunning && "bg-purple-900/10"
                  )}
                >
                  {isRunning ? (
                    <Loader2 className="w-3 h-3 text-purple-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Cpu className="w-3 h-3 text-purple-400 flex-shrink-0" />
                  )}
                  <span className="text-purple-300">
                    {isRunning
                      ? "Thinking about your request..."
                      : "Analyzed your request"}
                  </span>
                  <span className="tabular-nums flex-shrink-0 ml-auto text-gray-500">
                    {isRunning ? (
                      <RunningTimer startedAt={event.timestamp} />
                    ) : duration !== null ? (
                      formatDuration(duration)
                    ) : null}
                  </span>
                </div>
              );
            }

            if (event.type === "llm_end") {
              return (
                <div key={idx} className="flex items-center gap-2 px-3 py-1.5">
                  <Square className="w-3 h-3 text-purple-500 fill-purple-500 flex-shrink-0" />
                  <span className="text-purple-300">
                    {event.hasToolCalls && event.toolNames
                      ? `Decided to ${event.toolNames
                          .map((t) => getToolDescription(t).action.toLowerCase())
                          .join(", ")}`
                      : "Preparing response"}
                  </span>
                </div>
              );
            }

            if (event.type === "tool_start") {
              const desc = getToolDescription(event.name || "");
              return (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5",
                    isRunning && "bg-yellow-900/10"
                  )}
                >
                  {isRunning ? (
                    <Loader2 className="w-3 h-3 text-yellow-400 animate-spin flex-shrink-0" />
                  ) : (
                    <Play className="w-3 h-3 text-cyan-400 fill-cyan-400 flex-shrink-0" />
                  )}
                  <span className="text-cyan-300">{desc.running}</span>
                  <span className="tabular-nums flex-shrink-0 ml-auto text-gray-500">
                    {isRunning ? (
                      <RunningTimer startedAt={event.timestamp} />
                    ) : duration !== null ? (
                      formatDuration(duration)
                    ) : null}
                  </span>
                </div>
              );
            }

            if (event.type === "tool_end") {
              const hasSteps = event.steps && event.steps.length > 0;
              const isToolExpanded = expandedTools.has(idx);
              const desc = getToolDescription(event.name || "");

              return (
                <div key={idx}>
                  <div
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5",
                      event.status === "error" && "bg-red-900/10"
                    )}
                  >
                    {hasSteps ? (
                      <button
                        type="button"
                        onClick={() => toggleToolExpanded(idx)}
                        aria-label={isToolExpanded ? `Collapse ${desc.action} details` : `Expand ${desc.action} details`}
                        aria-expanded={isToolExpanded}
                        aria-controls={`tool-steps-${idx}`}
                        className="w-3 h-3 flex items-center justify-center text-gray-500 hover:text-gray-300"
                      >
                        {isToolExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                      </button>
                    ) : event.status === "success" ? (
                      <Square className="w-3 h-3 text-green-500 fill-green-500 flex-shrink-0" />
                    ) : (
                      <X className="w-3 h-3 text-red-500 flex-shrink-0" />
                    )}
                    <span
                      className={cn(
                        event.status === "success"
                          ? "text-green-300"
                          : "text-red-300"
                      )}
                    >
                      {event.status === "success"
                        ? `Completed: ${desc.action}`
                        : `Failed: ${desc.action}`}
                      {event.summary && (
                        <span className="text-gray-500"> — {event.summary}</span>
                      )}
                    </span>
                  </div>

                  {hasSteps && isToolExpanded && (
                    <div id={`tool-steps-${idx}`} className="bg-gray-950 border-l-2 border-gray-700 ml-4 py-1">
                      {event.steps!.map((step, stepIdx) => {
                        const isCandidate = step.step === "candidate" || step.step === "match";
                        const isFelicity = !isCandidate && step.data && ("clarity" in step.data || "classification" in step.data);
                        const isSearchQuery = step.step === "search_query" || step.step === "hyde_query";

                        return (
                          <div
                            key={`${step.step}-${stepIdx}`}
                            className="px-3 py-0.5 text-gray-400"
                          >
                            <div className="flex items-center gap-2">
                              <Circle className="w-1.5 h-1.5 text-gray-600 fill-gray-600 flex-shrink-0" />
                              <span>
                                {step.step}
                                {step.detail && (
                                  <span className="text-gray-500">
                                    : {step.detail}
                                  </span>
                                )}
                              </span>
                            </div>
                            {step.data && isCandidate && (
                              <CandidateScore data={step.data as CandidateData} />
                            )}
                            {step.data && isFelicity && (
                              <FelicityScores data={step.data as FelicityData} />
                            )}
                            {step.data && isSearchQuery && (
                              <SearchQueryDisplay data={step.data as SearchQueryData} />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            if (event.type === "negotiation_progress") {
              return (
                <NegotiationEventDisplay
                  key={idx}
                  event={event}
                  isExpanded={expandedNegotiations.has(idx)}
                  onToggle={() => toggleNegotiationExpanded(idx)}
                />
              );
            }

            return null;
          })}
        </div>
      )}
    </div>
  );
}
