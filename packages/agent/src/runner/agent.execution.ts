import { NegotiatorAgent, type NegotiateResult } from "../agents/negotiator.agent.js";
import { PrincipalAgent } from "../agents/principal/principal.agent.js";
import type { PrincipalAgentOptions } from "../agents/principal/principal.agent.js";
import type { WakeResult } from "../agents/principal/principal.context.js";
import type { Decision } from "../agents/shared/agent.context.js";
import type { Execute } from "../agents/shared/reasoning/reasoning.execution.js";

import type { AgentHost } from "./agent.host.js";
import { publishActions, publishStall } from "./conversation.codec.js";
import { prepareNegotiationContext, readNegotiationContext, readWakeContext, type IntentMembership } from "./runner.context.js";

export type NegotiationRunResult = NegotiateResult | { unbriefed: true } | undefined;

interface AgentExecutionOptions {
  host: AgentHost;
  execute: Execute;
  abortSignal: AbortSignal;
  membership: IntentMembership;
  now?: () => Date;
  log?: (line: string) => void;
  scheduleNegotiation: (intentId: string, opportunityId: string, decision?: Decision) => void;
}

/** Runs fresh read → reason → persist work while scheduling remains in AgentRunner. */
export class AgentExecution {
  private readonly principalAgents = new Map<string, PrincipalAgent>();

  /** @param options - Host, execution, cancellation, scheduling, and optional reporting dependencies. */
  constructor(private readonly options: AgentExecutionOptions) {}

  /**
   * Executes one fresh eligible principal wake and persists its outputs.
   * @param intentId - Intent whose current context should be read.
   * @returns The collected wake result, or undefined when the intent is inactive.
   * @throws If reading, reasoning, publication, or cancellation fails.
   */
  async runWake(intentId: string): Promise<WakeResult | undefined> {
    const { abortSignal } = this.options;
    abortSignal.throwIfAborted();
    const read = await readWakeContext(this.options.host, abortSignal, this.options.membership, intentId);
    abortSignal.throwIfAborted();
    if (!read) return undefined;

    const { wake, publication } = read;
    this.options.log?.(`wake ${wake.intent.statement}`);
    const result = await this.getPrincipalAgent(wake.profile.id, wake.intent.id).wake({
      ...wake,
      onBrief: async (actions) => {
        abortSignal.throwIfAborted();
        await publishActions(this.options.host, this.options.log, wake.intent.id, actions, publication);
        abortSignal.throwIfAborted();
        for (const action of actions) {
          if (action.type === "decision" && action.decision !== "stop") {
            abortSignal.throwIfAborted();
            this.options.scheduleNegotiation(wake.intent.id, action.opportunityId, action.decision);
          }
        }
      },
      onProgress: async (text) => {
        abortSignal.throwIfAborted();
        await publishActions(this.options.host, this.options.log, wake.intent.id, [{ type: "progress", text }], publication);
        abortSignal.throwIfAborted();
      },
      onOpened: (opportunityIds) => {
        abortSignal.throwIfAborted();
        this.options.log?.(`  opened ${opportunityIds.length}`);
        for (const opportunityId of opportunityIds) {
          abortSignal.throwIfAborted();
          this.options.scheduleNegotiation(wake.intent.id, opportunityId);
        }
      },
    });
    abortSignal.throwIfAborted();
    if (!result.actions.length) this.options.log?.("  silent");
    await publishActions(this.options.host, this.options.log, wake.intent.id, result.actions.filter((action) => action.type !== "brief" && action.type !== "decision" && action.type !== "progress"), publication);
    abortSignal.throwIfAborted();
    return result;
  }

  /**
   * Executes one eligible negotiation, first briefing it when needed.
   * @param intentId - Intent expected to own the opportunity.
   * @param opportunityId - Opportunity whose negotiation should run.
   * @returns A turn, stall, transient unbriefed result, or undefined for ineligible work.
   * @throws If reading, reasoning, publication, submission, or cancellation fails.
   */
  async runNegotiation(intentId: string, opportunityId: string): Promise<NegotiationRunResult> {
    const { abortSignal } = this.options;
    abortSignal.throwIfAborted();
    const read = await readNegotiationContext(this.options.host, intentId, opportunityId);
    abortSignal.throwIfAborted();
    if (!read) return undefined;

    const { briefing, negotiation, publication } = read;
    const { profile, intent, opportunity } = briefing;
    if (opportunity.decision === "stop") return undefined;
    if (!opportunity.brief || !opportunity.decision) {
      this.options.log?.(`  briefing ${opportunityId} with ${opportunity.counterpart}`);
      const actions = await this.getPrincipalAgent(profile.id, intent.id).brief(briefing);
      abortSignal.throwIfAborted();
      if (!actions.length) return { unbriefed: true };
      await publishActions(this.options.host, this.options.log, intent.id, actions, publication);
      abortSignal.throwIfAborted();
      for (const action of actions) {
        if (action.type === "brief") opportunity.brief = action.brief;
        if (action.type === "decision") opportunity.decision = action.decision;
      }
    }

    const context = prepareNegotiationContext(briefing, negotiation);
    if (!context) return undefined;
    const negotiator = new NegotiatorAgent({ principalId: profile.id, intentId: intent.id, execute: this.options.execute, abortSignal, now: this.options.now });
    this.options.log?.(`  negotiating ${opportunityId} with ${opportunity.counterpart} at turn ${negotiation.turnCount}`);
    const result = await negotiator.negotiate(context);
    abortSignal.throwIfAborted();
    if ("turn" in result) await this.options.host.submitTurn(opportunityId, { ...result.turn, expectedTurnCount: negotiation.turnCount });
    else await publishStall(this.options.host, negotiation, result.stall);
    abortSignal.throwIfAborted();
    return result;
  }

  private getPrincipalAgent(principalId: string, intentId: string): PrincipalAgent {
    let agent = this.principalAgents.get(intentId);
    if (!agent) {
      const options: PrincipalAgentOptions = { principalId, intentId, execute: this.options.execute, operations: this.options.host, abortSignal: this.options.abortSignal, now: this.options.now };
      agent = new PrincipalAgent(options);
      this.principalAgents.set(intentId, agent);
    }
    return agent;
  }
}
