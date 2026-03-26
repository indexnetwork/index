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
  AlertTriangle,
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
    action: "Fetch signals",
    running: "Fetching your active signals...",
  },
  create_intent: {
    action: "Create signal",
    running: "Creating a new signal...",
  },
  update_intent: {
    action: "Update signal",
    running: "Updating signal...",
  },
  delete_intent: {
    action: "Delete signal",
    running: "Removing signal...",
  },
  create_intent_index: {
    action: "Save to index",
    running: "Saving signal to index...",
  },
  read_intent_indexes: {
    action: "Fetch index signals",
    running: "Fetching signals in index...",
  },
  delete_intent_index: {
    action: "Remove from index",
    running: "Removing signal from index...",
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
  import_gmail_contacts: {
    action: "Import Gmail contacts",
    running: "Importing Gmail contacts...",
  },
  import_contacts: {
    action: "Import contacts",
    running: "Importing contacts...",
  },
  list_contacts: {
    action: "List contacts",
    running: "Listing your contacts...",
  },
  add_contact: {
    action: "Add contact",
    running: "Adding contact...",
  },
  remove_contact: {
    action: "Remove contact",
    running: "Removing contact...",
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

const GRAPH_DISPLAY_NAMES: Record<string, string> = {
  "opportunity": "Opportunity graph",
  "intent": "Intent graph",
  "intent_index": "Intent indexing",
  "profile": "Profile graph",
  "hyde": "HyDE graph",
  "home": "Home graph",
  "index": "Index graph",
  "index_membership": "Index membership",
};

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  "opportunity-evaluator": "Evaluating opportunities",
  "opportunity-presenter": "Presenting opportunities",
  "intro-evaluator": "Evaluating introduction",
  "intent-inferrer": "Inferring intents",
  "intent-verifier": "Verifying intents",
  "intent-reconciler": "Reconciling intents",
  "intent-indexer": "Indexing intents",
  "profile-generator": "Generating profile",
  "hyde-generator": "Generating HyDE",
  "lens-inferrer": "Inferring lenses",
  "home-categorizer": "Categorizing home",
};

function getGraphDisplayName(name: string): string {
  return GRAPH_DISPLAY_NAMES[name] ?? name;
}

function getAgentDisplayName(name: string): string {
  return AGENT_DISPLAY_NAMES[name] ?? name;
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

// ─── Hierarchical tree structures ───────────────────────────────────────────

interface AgentNode {
  name: string;
  startTimestamp?: number;
  durationMs?: number;
  isRunning: boolean;
  summary?: string;
}

interface GraphNode {
  name: string;
  startTimestamp?: number;
  durationMs?: number;
  isRunning: boolean;
  agents: AgentNode[];
}

interface ToolNode {
  name: string;
  startTimestamp?: number;
  durationMs?: number;
  isRunning: boolean;
  activities: TraceEvent[];
  steps?: TraceEvent["steps"];
  status?: "success" | "error";
  summary?: string;
  graphs: GraphNode[];
}

/** Ordered list of items to render in the non-tool sections (llm / iteration events). */
interface NonToolItem {
  kind: "iteration_start" | "llm_start" | "llm_end" | "hallucination_detected";
  event: TraceEvent;
  /** For llm_start: duration if matched; null if still running. */
  duration?: number | null;
}

/** A single entry in the chronological timeline. */
type TimelineEntry =
  | { kind: "non_tool"; item: NonToolItem }
  | { kind: "tool"; tool: ToolNode; toolIdx: number };

interface ParsedTrace {
  timeline: TimelineEntry[];
  tools: ToolNode[];
}

/**
 * Scan the flat TraceEvent array and build a hierarchical ParsedTrace.
 * tool_start opens a ToolNode; graph_start opens a GraphNode inside the current tool;
 * agent_start opens an AgentNode inside the current graph.
 * The corresponding *_end events close and annotate their nodes.
 */
function parseTraceEvents(events: TraceEvent[]): ParsedTrace {
  const timeline: TimelineEntry[] = [];
  const tools: ToolNode[] = [];

  // Pointers to the currently-open nodes (stack state)
  let currentTool: ToolNode | null = null;
  let currentGraph: GraphNode | null = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    switch (event.type) {
      case "iteration_start":
        timeline.push({ kind: "non_tool", item: { kind: "iteration_start", event } });
        break;

      case "llm_start": {
        // Find matching llm_end for duration
        const llmEnd = events
          .slice(i + 1)
          .find((e) => e.type === "llm_end" && e.iteration === event.iteration);
        const duration = llmEnd ? llmEnd.timestamp - event.timestamp : null;
        timeline.push({ kind: "non_tool", item: { kind: "llm_start", event, duration } });
        break;
      }

      case "llm_end":
        timeline.push({ kind: "non_tool", item: { kind: "llm_end", event } });
        break;

      case "hallucination_detected":
        timeline.push({ kind: "non_tool", item: { kind: "hallucination_detected", event } });
        break;

      case "tool_start": {
        const node: ToolNode = {
          name: event.name ?? "",
          startTimestamp: event.timestamp,
          isRunning: true,
          activities: [],
          graphs: [],
        };
        const toolIdx = tools.length;
        tools.push(node);
        timeline.push({ kind: "tool", tool: node, toolIdx });
        currentTool = node;
        currentGraph = null;
        break;
      }

      case "tool_end": {
        // Find the most-recently opened tool with this name that is still running
        const toolNode = [...tools].reverse().find(
          (t) => t.name === (event.name ?? "") && t.isRunning,
        );
        if (toolNode) {
          if (toolNode.startTimestamp && event.timestamp) {
            toolNode.durationMs = event.timestamp - toolNode.startTimestamp;
          }
          toolNode.isRunning = false;
          toolNode.steps = event.steps;
          toolNode.summary = event.summary;
          toolNode.status = event.status as "success" | "error" | undefined;
          if (currentTool === toolNode) {
            currentTool = null;
            currentGraph = null;
          }
        }
        break;
      }

      case "graph_start": {
        const graphNode: GraphNode = {
          name: event.name ?? "",
          startTimestamp: event.timestamp,
          isRunning: true,
          agents: [],
        };
        // Attach to current tool if one is open, otherwise orphan (attach to last tool)
        const targetTool = currentTool ?? (tools.length > 0 ? tools[tools.length - 1] : null);
        if (targetTool) {
          targetTool.graphs.push(graphNode);
        }
        currentGraph = graphNode;
        break;
      }

      case "graph_end": {
        // Find the most-recently opened graph with this name that is still running
        const allGraphs = tools.flatMap((t) => t.graphs);
        const graphNode = [...allGraphs].reverse().find(
          (g) => g.name === (event.name ?? "") && g.isRunning,
        );
        if (graphNode) {
          graphNode.durationMs = event.durationMs ?? (graphNode.startTimestamp && event.timestamp
            ? event.timestamp - graphNode.startTimestamp
            : undefined);
          graphNode.isRunning = false;
          if (currentGraph === graphNode) {
            currentGraph = null;
          }
        }
        break;
      }

      case "agent_start": {
        const agentNode: AgentNode = {
          name: event.name ?? "",
          startTimestamp: event.timestamp,
          isRunning: true,
        };
        // Attach to current graph if one is open, otherwise orphan (attach to last open graph)
        const targetGraph = currentGraph ?? (() => {
          for (let ti = tools.length - 1; ti >= 0; ti--) {
            const gs = tools[ti].graphs;
            for (let gi = gs.length - 1; gi >= 0; gi--) {
              if (gs[gi].isRunning) return gs[gi];
            }
          }
          return null;
        })();
        if (targetGraph) {
          targetGraph.agents.push(agentNode);
        }
        break;
      }

      case "agent_end": {
        // Find the most-recently opened agent with this name that is still running
        const allAgents = tools.flatMap((t) => t.graphs.flatMap((g) => g.agents));
        const agentNode = [...allAgents].reverse().find(
          (a) => a.name === (event.name ?? "") && a.isRunning,
        );
        if (agentNode) {
          agentNode.durationMs = event.durationMs;
          agentNode.isRunning = false;
          agentNode.summary = event.summary;
        }
        break;
      }
    }
  }

  return { timeline, tools };
}

// ─── Step grouping types and helpers ──────────────────────────────────────────

type StepGroup =
  | { kind: "match_group"; steps: ToolCallStep[] }
  | { kind: "candidate_passed"; steps: ToolCallStep[] }
  | { kind: "candidate_failed"; steps: ToolCallStep[] }
  | { kind: "single"; step: ToolCallStep };

type ToolCallStep = NonNullable<ToolNode["steps"]>[number];

/**
 * Groups consecutive steps for summarized rendering.
 * - Consecutive "match" steps -> single match_group
 * - Consecutive "candidate" steps -> split into passed/failed groups
 * - Everything else -> single step
 */
function groupSteps(steps: ToolCallStep[]): StepGroup[] {
  const groups: StepGroup[] = [];
  let i = 0;

  while (i < steps.length) {
    const step = steps[i];

    // Group consecutive match steps
    if (step.step === "match") {
      const matchSteps: ToolCallStep[] = [];
      while (i < steps.length && steps[i].step === "match") {
        matchSteps.push(steps[i]);
        i++;
      }
      groups.push({ kind: "match_group", steps: matchSteps });
      continue;
    }

    // Group consecutive candidate steps into passed/failed
    if (step.step === "candidate") {
      const candidateSteps: ToolCallStep[] = [];
      while (i < steps.length && steps[i].step === "candidate") {
        candidateSteps.push(steps[i]);
        i++;
      }
      const passed = candidateSteps.filter((s) => (s.data as CandidateData | undefined)?.passed === true);
      const failed = candidateSteps.filter((s) => (s.data as CandidateData | undefined)?.passed !== true);
      if (passed.length > 0) {
        groups.push({ kind: "candidate_passed", steps: passed });
      }
      if (failed.length > 0) {
        groups.push({ kind: "candidate_failed", steps: failed });
      }
      continue;
    }

    // Everything else is a single step
    groups.push({ kind: "single", step });
    i++;
  }

  return groups;
}

function MatchGroupSummary({ steps }: { steps: ToolCallStep[] }) {
  // Extract similarity scores and sort descending
  const scores = steps
    .map((s) => {
      const data = s.data as Record<string, unknown> | undefined;
      const sim = data?.similarity;
      return typeof sim === "number" ? sim : undefined;
    })
    .filter((s): s is number => s !== undefined)
    .sort((a, b) => b - a);

  const topScores = scores.slice(0, 3).map((s) => `${s}%`);
  const suffix = scores.length > 3 ? "..." : "";

  return (
    <div className="px-3 py-0.5 text-gray-400">
      <div className="flex items-center gap-2">
        <Circle className="w-1.5 h-1.5 text-gray-600 fill-gray-600 flex-shrink-0" />
        <span>
          {steps.length} matches
          {topScores.length > 0 && (
            <span className="text-gray-500">
              {" "}(top: {topScores.join(", ")}{suffix})
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

function CandidatePassedGroup({ steps }: { steps: ToolCallStep[] }) {
  return (
    <>
      {steps.map((step, stepIdx) => (
        <div key={`cand-pass-${stepIdx}`} className="px-3 py-0.5 text-gray-400">
          <div className="flex items-center gap-2">
            <Circle className="w-1.5 h-1.5 text-green-600 fill-green-600 flex-shrink-0" />
            <span>
              candidate
              {step.detail && <span className="text-gray-500">: {step.detail}</span>}
            </span>
          </div>
          {step.data && <CandidateScore data={step.data as CandidateData} />}
        </div>
      ))}
    </>
  );
}

function CandidateFailedGroup({ steps }: { steps: ToolCallStep[] }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="px-3 py-0.5 text-gray-400">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 hover:text-gray-300 transition-colors"
      >
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-gray-600 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-gray-600 flex-shrink-0" />
        )}
        <span className="text-red-400/70">
          {steps.length} below threshold
        </span>
      </button>
      {isExpanded && (
        <div className="mt-1">
          {steps.map((step, stepIdx) => (
            <div key={`cand-fail-${stepIdx}`} className="py-0.5">
              <div className="flex items-center gap-2 ml-4">
                <Circle className="w-1.5 h-1.5 text-gray-600 fill-gray-600 flex-shrink-0" />
                <span>
                  candidate
                  {step.detail && <span className="text-gray-500">: {step.detail}</span>}
                </span>
              </div>
              {step.data && <CandidateScore data={step.data as CandidateData} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Agent grouping types and helpers ─────────────────────────────────────────

type AgentEntry =
  | { kind: "single"; agent: AgentNode }
  | { kind: "group"; name: string; agents: AgentNode[] };

/**
 * Groups consecutive agents with the same name into AgentEntry items.
 * Consecutive agents sharing a name become a "group"; lone agents become "single".
 */
function groupConsecutiveAgents(agents: AgentNode[]): AgentEntry[] {
  const entries: AgentEntry[] = [];
  let i = 0;

  while (i < agents.length) {
    const current = agents[i];
    // Collect consecutive agents with the same name
    const run: AgentNode[] = [current];
    while (i + 1 < agents.length && agents[i + 1].name === current.name) {
      i++;
      run.push(agents[i]);
    }
    if (run.length === 1) {
      entries.push({ kind: "single", agent: current });
    } else {
      entries.push({ kind: "group", name: current.name, agents: run });
    }
    i++;
  }

  return entries;
}

/**
 * Checks whether an agent summary indicates a "pass" (contains a numeric score).
 * e.g. "Ryan Noble: 75" → true, "Seref Yarar: not scored" → false
 */
function isAgentSummaryPassed(summary: string | undefined): boolean {
  if (!summary) return false;
  return /.+:\s*\d+/.test(summary);
}

// ─── Sub-components for hierarchical rendering ───────────────────────────────

interface TraceDisplayProps {
  traceEvents: TraceEvent[];
  isStreaming?: boolean;
  /** When true, show "Stopped" for in-progress events and freeze duration. */
  wasStoppedByUser?: boolean;
  /** Timestamp when user stopped; used for frozen duration display. */
  stoppedAt?: number;
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

interface AgentRowProps {
  agent: AgentNode;
  wasStoppedByUser?: boolean;
  stoppedAt?: number;
}

function AgentRow({ agent, wasStoppedByUser, stoppedAt }: AgentRowProps) {
  const isStopped = agent.isRunning && wasStoppedByUser && stoppedAt;
  const isRunning = agent.isRunning && !wasStoppedByUser;
  const displayName = getAgentDisplayName(agent.name);

  return (
    <div
      className={cn(
        "flex items-center gap-2 pl-12 pr-3 py-0.5",
        isRunning && "bg-orange-900/10",
        isStopped && "bg-amber-900/10",
      )}
    >
      <span className="text-gray-700 flex-shrink-0 select-none">└─</span>
      {isRunning ? (
        <Loader2 className="w-2.5 h-2.5 text-orange-400 animate-spin flex-shrink-0" />
      ) : isStopped ? (
        <Square className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />
      ) : (
        <Circle className="w-2.5 h-2.5 text-orange-400 fill-orange-400 flex-shrink-0" />
      )}
      <span className={cn(
        "flex-1 truncate",
        isStopped ? "text-amber-300" : "text-orange-300",
      )}>
        {isStopped ? "Stopped" : displayName}
        {!isRunning && !isStopped && agent.summary && (
          <span className="text-gray-500"> — {agent.summary}</span>
        )}
      </span>
      <span className="tabular-nums flex-shrink-0 text-gray-500">
        {isRunning && agent.startTimestamp ? (
          <RunningTimer startedAt={agent.startTimestamp} />
        ) : isStopped && stoppedAt && agent.startTimestamp ? (
          formatDuration(stoppedAt - agent.startTimestamp)
        ) : agent.durationMs !== undefined ? (
          formatDuration(agent.durationMs)
        ) : null}
      </span>
    </div>
  );
}

interface AgentGroupRowProps {
  name: string;
  agents: AgentNode[];
  wasStoppedByUser?: boolean;
  stoppedAt?: number;
}

function AgentGroupRow({ name, agents, wasStoppedByUser, stoppedAt }: AgentGroupRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const displayName = getAgentDisplayName(name);

  const runningCount = agents.filter((a) => a.isRunning && !wasStoppedByUser).length;
  const stoppedCount = agents.filter((a) => a.isRunning && wasStoppedByUser).length;
  const anyRunning = runningCount > 0;
  const anyStopped = stoppedCount > 0 && !anyRunning;

  // Total duration: sum of completed durations. If any are still running, show a live timer
  // from the earliest start timestamp.
  const earliestStart = agents.reduce<number | undefined>(
    (min, a) => (a.startTimestamp !== undefined ? (min === undefined ? a.startTimestamp : Math.min(min, a.startTimestamp)) : min),
    undefined,
  );
  const totalCompletedMs = agents.reduce((sum, a) => sum + (a.durationMs ?? 0), 0);

  return (
    <div>
      {/* Collapsed summary row */}
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className={cn(
          "flex items-center gap-2 pl-12 pr-3 py-0.5 w-full text-left hover:bg-gray-800/50 transition-colors",
          anyRunning && "bg-orange-900/10",
          anyStopped && "bg-amber-900/10",
        )}
      >
        <span className="text-gray-700 flex-shrink-0 select-none">└─</span>
        {isExpanded ? (
          <ChevronDown className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
        ) : (
          <ChevronRight className="w-2.5 h-2.5 text-gray-500 flex-shrink-0" />
        )}
        {anyRunning ? (
          <Loader2 className="w-2.5 h-2.5 text-orange-400 animate-spin flex-shrink-0" />
        ) : anyStopped ? (
          <Square className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />
        ) : (
          <Circle className="w-2.5 h-2.5 text-orange-400 fill-orange-400 flex-shrink-0" />
        )}
        <span className={cn(
          "flex-1 truncate",
          anyStopped ? "text-amber-300" : "text-orange-300",
        )}>
          {anyStopped ? "Stopped" : displayName}
          <span className="text-gray-500"> ({agents.length})</span>
          {anyRunning && runningCount < agents.length && (
            <span className="text-gray-600"> — {agents.length - runningCount} done, {runningCount} running</span>
          )}
          {!anyRunning && !anyStopped && (() => {
            const scored = agents.filter((a) => isAgentSummaryPassed(a.summary)).length;
            return scored > 0
              ? <span className="text-gray-600"> — <span className="text-green-400">{scored} scored</span>, {agents.length - scored} no match</span>
              : <span className="text-gray-600"> — no matches</span>;
          })()}
        </span>
        <span className="tabular-nums flex-shrink-0 text-gray-500">
          {anyRunning && earliestStart ? (
            <RunningTimer startedAt={earliestStart} />
          ) : anyStopped && stoppedAt && earliestStart ? (
            formatDuration(stoppedAt - earliestStart)
          ) : totalCompletedMs > 0 ? (
            <>{formatDuration(totalCompletedMs)} total</>
          ) : null}
        </span>
      </button>

      {/* Expanded: individual agent sub-rows */}
      {isExpanded && agents.map((agent, aIdx) => {
        const agentIsRunning = agent.isRunning && !wasStoppedByUser;
        const agentIsStopped = agent.isRunning && wasStoppedByUser && !!stoppedAt;
        const passed = isAgentSummaryPassed(agent.summary);

        return (
          <div
            key={`${agent.name}-group-${aIdx}`}
            className={cn(
              "flex items-center gap-2 pl-16 pr-3 py-0.5",
              agentIsRunning && "bg-orange-900/5",
              agentIsStopped && "bg-amber-900/5",
            )}
          >
            <span className="text-gray-700 flex-shrink-0 select-none">└─</span>
            {agentIsRunning ? (
              <Loader2 className="w-2 h-2 text-orange-400 animate-spin flex-shrink-0" />
            ) : agentIsStopped ? (
              <Square className="w-2 h-2 text-amber-400 fill-amber-400 flex-shrink-0" />
            ) : passed ? (
              <Circle className="w-2 h-2 text-green-400 fill-green-400 flex-shrink-0" />
            ) : (
              <Circle className="w-2 h-2 text-gray-500 fill-gray-500 flex-shrink-0" />
            )}
            <span className={cn(
              "flex-1 truncate",
              agentIsStopped ? "text-amber-300" : agentIsRunning ? "text-orange-300" : "text-gray-400",
            )}>
              {agentIsStopped
                ? "Stopped"
                : agentIsRunning
                  ? "Running..."
                  : agent.summary ?? getAgentDisplayName(agent.name)}
            </span>
            <span className="tabular-nums flex-shrink-0 text-gray-600">
              {agentIsRunning && agent.startTimestamp ? (
                <RunningTimer startedAt={agent.startTimestamp} />
              ) : agentIsStopped && stoppedAt && agent.startTimestamp ? (
                formatDuration(stoppedAt - agent.startTimestamp)
              ) : agent.durationMs !== undefined ? (
                formatDuration(agent.durationMs)
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface GraphRowProps {
  graph: GraphNode;
  wasStoppedByUser?: boolean;
  stoppedAt?: number;
}

function GraphRow({ graph, wasStoppedByUser, stoppedAt }: GraphRowProps) {
  const isStopped = graph.isRunning && wasStoppedByUser && stoppedAt;
  const isRunning = graph.isRunning && !wasStoppedByUser;
  const displayName = getGraphDisplayName(graph.name);

  return (
    <>
      <div
        className={cn(
          "flex items-center gap-2 pl-8 pr-3 py-0.5",
          isRunning && "bg-teal-900/10",
          isStopped && "bg-amber-900/10",
        )}
      >
        <span className="text-gray-700 flex-shrink-0 select-none">└─</span>
        {isRunning ? (
          <Loader2 className="w-2.5 h-2.5 text-teal-400 animate-spin flex-shrink-0" />
        ) : isStopped ? (
          <Square className="w-2.5 h-2.5 text-amber-400 fill-amber-400 flex-shrink-0" />
        ) : (
          <Square className="w-2.5 h-2.5 text-teal-500 fill-teal-500 flex-shrink-0" />
        )}
        <span className={cn(
          "flex-1 truncate",
          isStopped ? "text-amber-300" : "text-teal-300",
        )}>
          {isStopped ? "Stopped" : displayName}
        </span>
        <span className="tabular-nums flex-shrink-0 text-gray-500">
          {isRunning && graph.startTimestamp ? (
            <RunningTimer startedAt={graph.startTimestamp} />
          ) : isStopped && stoppedAt && graph.startTimestamp ? (
            formatDuration(stoppedAt - graph.startTimestamp)
          ) : graph.durationMs !== undefined ? (
            formatDuration(graph.durationMs)
          ) : null}
        </span>
      </div>
      {groupConsecutiveAgents(graph.agents).map((entry, eIdx) => {
        if (entry.kind === "single") {
          return (
            <AgentRow
              key={`${entry.agent.name}-${eIdx}`}
              agent={entry.agent}
              wasStoppedByUser={wasStoppedByUser}
              stoppedAt={stoppedAt}
            />
          );
        }
        return (
          <AgentGroupRow
            key={`${entry.name}-group-${eIdx}`}
            name={entry.name}
            agents={entry.agents}
            wasStoppedByUser={wasStoppedByUser}
            stoppedAt={stoppedAt}
          />
        );
      })}
    </>
  );
}

interface ToolRowProps {
  tool: ToolNode;
  toolIdx: number;
  expandedTools: Set<number>;
  onToggleExpand: (idx: number) => void;
  wasStoppedByUser?: boolean;
  stoppedAt?: number;
}

function ToolRow({
  tool,
  toolIdx,
  expandedTools,
  onToggleExpand,
  wasStoppedByUser,
  stoppedAt,
}: ToolRowProps) {
  const isStopped = tool.isRunning && wasStoppedByUser && stoppedAt;
  const isRunning = tool.isRunning && !wasStoppedByUser;
  const desc = getToolDescription(tool.name);
  const hasSteps = (tool.steps?.length ?? 0) > 0;
  const isToolExpanded = expandedTools.has(toolIdx);

  return (
    <div>
      {/* Tool header row */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5",
          isRunning && "bg-yellow-900/10",
          isStopped && "bg-amber-900/10",
          !isRunning && !isStopped && tool.status === "error" && "bg-red-900/10",
        )}
      >
        {hasSteps ? (
          <button
            type="button"
            onClick={() => onToggleExpand(toolIdx)}
            aria-label={isToolExpanded ? `Collapse ${desc.action} details` : `Expand ${desc.action} details`}
            aria-expanded={isToolExpanded}
            aria-controls={`tool-steps-${toolIdx}`}
            className="w-3 h-3 flex items-center justify-center text-gray-500 hover:text-gray-300"
          >
            {isToolExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
          </button>
        ) : isRunning ? (
          <Loader2 className="w-3 h-3 text-yellow-400 animate-spin flex-shrink-0" />
        ) : isStopped ? (
          <Square className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
        ) : tool.status === "success" ? (
          <Play className="w-3 h-3 text-cyan-400 fill-cyan-400 flex-shrink-0" />
        ) : tool.status === "error" ? (
          <X className="w-3 h-3 text-red-500 flex-shrink-0" />
        ) : (
          <Play className="w-3 h-3 text-cyan-400 fill-cyan-400 flex-shrink-0" />
        )}

        <span className={cn(
          "flex-1",
          isStopped ? "text-amber-300" : tool.status === "error" ? "text-red-300" : "text-cyan-300",
        )}>
          {isRunning
            ? desc.running
            : isStopped
              ? "Stopped"
              : tool.status === "error"
                ? `Failed: ${desc.action}`
                : desc.action}
          {!isRunning && !isStopped && tool.summary && (
            <span className="text-gray-500"> — {tool.summary}</span>
          )}
        </span>

        <span className="tabular-nums flex-shrink-0 ml-auto text-gray-500">
          {isRunning && tool.startTimestamp ? (
            <RunningTimer startedAt={tool.startTimestamp} />
          ) : isStopped && stoppedAt && tool.startTimestamp ? (
            formatDuration(stoppedAt - tool.startTimestamp)
          ) : tool.durationMs !== undefined ? (
            formatDuration(tool.durationMs)
          ) : null}
        </span>
      </div>

      {/* Graphs nested under this tool */}
      {tool.graphs.map((graph, gIdx) => (
        <GraphRow
          key={`${graph.name}-${gIdx}`}
          graph={graph}
          wasStoppedByUser={wasStoppedByUser}
          stoppedAt={stoppedAt}
        />
      ))}

      {/* Expandable steps detail */}
      {hasSteps && isToolExpanded && (
        <div id={`tool-steps-${toolIdx}`} className="bg-gray-950 border-l-2 border-gray-700 ml-4 py-1">
          {groupSteps(tool.steps!).map((group, groupIdx) => {
            if (group.kind === "match_group") {
              return <MatchGroupSummary key={`match-group-${groupIdx}`} steps={group.steps} />;
            }

            if (group.kind === "candidate_passed") {
              return <CandidatePassedGroup key={`cand-pass-${groupIdx}`} steps={group.steps} />;
            }

            if (group.kind === "candidate_failed") {
              return <CandidateFailedGroup key={`cand-fail-${groupIdx}`} steps={group.steps} />;
            }

            const { step } = group;
            const isFelicity = step.data && ("clarity" in step.data || "classification" in step.data);
            const isSearchQuery = step.step === "search_query" || step.step === "hyde_query";

            return (
              <div
                key={`${step.step}-${groupIdx}`}
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
                {step.data && isFelicity && (
                  <FelicityScores data={step.data as FelicityData} />
                )}
                {step.data && isSearchQuery && (
                  <SearchQueryDisplay data={step.data as SearchQueryData} />
                )}
                {step.data && !isFelicity && !isSearchQuery && (
                  <div className="ml-4 mt-1 text-xs text-gray-500 space-y-0.5">
                    {Object.entries(step.data).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-gray-600 flex-shrink-0">{key}:</span>
                        <span className="text-gray-400 break-all">
                          {typeof value === "string"
                            ? value.length > 200 ? value.slice(0, 200) + "..." : value
                            : (() => { const s = JSON.stringify(value); return s.length > 200 ? s.slice(0, 200) + "..." : s; })()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ToolCallsDisplay({
  traceEvents,
  isStreaming,
  wasStoppedByUser,
  stoppedAt,
}: TraceDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  if (!traceEvents || traceEvents.length === 0) return null;

  const parsed = parseTraceEvents(traceEvents);

  const runningTools = parsed.tools.filter((t) => t.isRunning).length;
  const hasErrors = parsed.tools.some((t) => t.status === "error");

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
          {runningTools > 0 || (isStreaming && !wasStoppedByUser) ? (
            <span className="text-yellow-400">{traceEvents.length} events</span>
          ) : wasStoppedByUser ? (
            <span className="text-amber-400">{traceEvents.length} events (stopped)</span>
          ) : (
            <span className={hasErrors ? "text-red-400" : "text-green-400"}>
              {traceEvents.length} events
            </span>
          )}
        </span>
        <span className="text-gray-600 ml-auto">
          {runningTools > 0 || (isStreaming && !wasStoppedByUser) ? (
            <Loader2 className="w-3 h-3 animate-spin text-yellow-400" />
          ) : wasStoppedByUser && stoppedAt && firstEvent ? (
            formatDuration(stoppedAt - firstEvent.timestamp)
          ) : (
            totalDuration > 0 && formatDuration(totalDuration)
          )}
        </span>
      </button>

      {isExpanded && (
        <div className="divide-y divide-gray-800">
          {parsed.timeline.map((entry, idx) => {
            if (entry.kind === "tool") {
              return (
                <ToolRow
                  key={`tool-${entry.tool.name}-${entry.toolIdx}`}
                  tool={entry.tool}
                  toolIdx={entry.toolIdx}
                  expandedTools={expandedTools}
                  onToggleExpand={toggleToolExpanded}
                  wasStoppedByUser={wasStoppedByUser}
                  stoppedAt={stoppedAt}
                />
              );
            }

            const { item } = entry;
            const { event } = item;

            if (item.kind === "iteration_start") {
              return (
                <div
                  key={`iter-${idx}`}
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

            if (item.kind === "hallucination_detected") {
              return (
                <div
                  key={`hallucination-${idx}`}
                  className="flex items-center gap-2 px-3 py-1.5 bg-amber-900/20"
                >
                  <AlertTriangle className="w-3 h-3 text-amber-400 flex-shrink-0" />
                  <span className="text-amber-300 font-medium">
                    Hallucinated {event.summary} block — auto-invoking {event.name}
                  </span>
                  <span className="text-gray-600 text-[10px] ml-auto">
                    {formatTime(event.timestamp)}
                  </span>
                </div>
              );
            }

            if (item.kind === "llm_start") {
              const duration = item.duration ?? null;
              const wouldBeRunning = duration === null;
              const isRunning = wouldBeRunning && !wasStoppedByUser;
              const isStopped = wouldBeRunning && wasStoppedByUser && stoppedAt;

              return (
                <div
                  key={`llm-start-${idx}`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5",
                    isRunning && "bg-purple-900/10",
                    isStopped && "bg-amber-900/10",
                  )}
                >
                  {isRunning ? (
                    <Loader2 className="w-3 h-3 text-purple-400 animate-spin flex-shrink-0" />
                  ) : isStopped ? (
                    <Square className="w-3 h-3 text-amber-400 fill-amber-400 flex-shrink-0" />
                  ) : (
                    <Cpu className="w-3 h-3 text-purple-400 flex-shrink-0" />
                  )}
                  <span className={isStopped ? "text-amber-300" : "text-purple-300"}>
                    {isRunning
                      ? "Thinking about your request..."
                      : isStopped
                        ? "Stopped"
                        : "Analyzed your request"}
                  </span>
                  <span className="tabular-nums flex-shrink-0 ml-auto text-gray-500">
                    {isRunning ? (
                      <RunningTimer startedAt={event.timestamp} />
                    ) : isStopped && stoppedAt ? (
                      formatDuration(stoppedAt - event.timestamp)
                    ) : duration !== null ? (
                      formatDuration(duration)
                    ) : null}
                  </span>
                </div>
              );
            }

            if (item.kind === "llm_end") {
              return (
                <div key={`llm-end-${idx}`} className="flex items-center gap-2 px-3 py-1.5">
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

            return null;
          })}
        </div>
      )}
    </div>
  );
}
