import type { Tool, ToolContext } from '../core/tools.ts';
import type { RunResult, Step } from '../core/types.ts';

/** A native host's speaking session. Domain tools and their completion fences remain owned by the agent. */
export interface NegotiationSpeaker {
  /**
   * @param input - Fresh instructions and the exact tools for this H2A review or A2A turn.
   * @returns The native session's result.
   * @throws The original onStep exception when the domain ends this run; stop offering tools immediately.
   */
  run(input: {
    kind: 'inbox' | 'turn';
    intentId: string;
    opportunityId?: string;
    counterparty?: string;
    systemPrompt: string;
    prompt: string;
    tools: Tool[];
    context: ToolContext;
    onStep?: (step: Step) => void;
    signal?: AbortSignal;
  }): Promise<RunResult>;
}
