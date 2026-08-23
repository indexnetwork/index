/**
 * The single NegotiationGraph construction (negotiation-graph rewrite,
 * #1494). Every host surface that needs to invoke a negotiation — background
 * discovery, the MCP tools, the REST negotiation routes, chat tools — shares
 * this one compiled graph and the one real `AgentDispatcherImpl` behind it.
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
import { negotiationTimeoutQueue } from '../../queues/negotiations/timeout.queue';
import { roundReflectEnqueue } from '../../queues/negotiations/round-reflect.queue';

export const agentDispatcher = new AgentDispatcherImpl(agentService, negotiationTimeoutQueue);

export const negotiationGraph = new NegotiationGraphFactory({
  database: conversationDatabaseAdapter,
  dispatcher: agentDispatcher,
  // All-paused → reflect trigger for the round (stub consumer for now).
  reflectEnqueue: roundReflectEnqueue(),
}).createGraph();

negotiationTimeoutQueue.setNegotiationGraph(negotiationGraph);
