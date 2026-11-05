import type { ReactNode } from "react";

import { MyAgentAvatar } from "@/components/workbench/agent-avatar";
import IntentNegotiatorChat from "@/components/IntentNegotiatorChat";

/**
 * The right column: your one agent, showing its conversation about one intent.
 * The same thread opens from the intent page and from the inbox; `scope` names
 * the intent when that isn't obvious from the page, and `actions` lets the
 * inbox offer a way back to its overview.
 */
export default function IntentAgentPanel({ intentId, paused, onSelectMatch, scope, actions }: {
  intentId: string;
  paused: boolean;
  onSelectMatch(opportunityId: string): void;
  scope?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="ih-agent" data-testid="intent-agent-panel">
      <AgentPanelHead
        sub={scope}
        status={<span style={{ color: paused ? "var(--ih-disabled)" : "var(--ih-live)" }}>● {paused ? "paused" : "live"}</span>}
        actions={actions}
      />
      <IntentNegotiatorChat key={intentId} intentId={intentId} onSelectMatch={onSelectMatch} />
    </div>
  );
}

/** One face and one name everywhere: the same avatar its messages carry, because it is the same agent on every page. */
export function AgentPanelHead({ sub, status, actions }: { sub?: ReactNode; status?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="ih-agent-head">
      <span aria-hidden="true"><MyAgentAvatar size={28} /></span>
      <span className="ih-agent-who">
        <span className="ih-agent-heading">YOUR AGENT</span>
        {sub && <span className="ih-agent-scope">{sub}</span>}
      </span>
      <span className="ih-agent-side">{actions}{status}</span>
    </div>
  );
}
