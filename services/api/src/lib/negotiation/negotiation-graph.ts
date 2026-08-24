/**
 * The single NegotiationGraph construction (negotiation-graph rewrite,
 * #1494). Every host surface that needs to invoke a negotiation — background
 * discovery, the MCP tools, chat tools — shares this one compiled graph.
 *
 * `agentDispatcher` is exported separately: it is no longer part of the
 * negotiation graph's own deps (external-agent dispatch is offline, #1494
 * round-3 Option A — see the PR body), but the opportunity graph still uses
 * `hasExternalAgent` for the unlimited-maxTurns rule (IND-410), so the host
 * still needs one shared instance to wire there.
 *
 * A shared module (rather than literally inlining the construction in
 * main.ts) exists only so every importer gets it at their own module-eval
 * time without a circular import back into main.ts — the same reason
 * `chatFactory` lives in mcp.controller.ts instead of main.ts.
 */
import { NegotiationGraphFactory } from '@indexnetwork/protocol';

import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { agentService } from '../../services/agent.service';
import { AgentDispatcherImpl } from '../../services/agent-dispatcher.service';
import { roundReflectEnqueue } from '../../queues/negotiations/round-reflect.queue';

export const agentDispatcher = new AgentDispatcherImpl(agentService);

export const negotiationGraph = new NegotiationGraphFactory({
  database: conversationDatabaseAdapter,
  // All-paused → reflect trigger for the round (stub consumer for now).
  reflectEnqueue: roundReflectEnqueue(),
}).createGraph();
