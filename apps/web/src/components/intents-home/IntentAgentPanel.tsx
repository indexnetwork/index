import { AgentFace } from "@/components/workbench/agent-face";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";

/** Keep the redesigned panel shell; the conversation is the original chat. */
export default function IntentAgentPanel({ intentId, paused, onSelectMatch }: {
  intentId: string;
  paused: boolean;
  onSelectMatch(opportunityId: string): void;
}) {
  return (
    <div className="ih-agent" data-testid="intent-agent-panel">
      <div className="ih-bar">
        <span className="ih-agent-heading"><span aria-hidden="true"><AgentFace seed="index" size={20} /></span>YOUR AGENT</span>
        <span style={{ color: paused ? "var(--ih-disabled)" : "var(--ih-live)" }}>● {paused ? "paused" : "live"}</span>
      </div>
      <IntentNegotiatorChat key={intentId} intentId={intentId} onSelectMatch={onSelectMatch} />
    </div>
  );
}
