import type { Model, ModelMessage, ModelRequestOptions, ToolDefinition } from '@indexnetwork/agent';

interface BridgeReply {
  content?: string | null;
  tool_calls?: ModelMessage['tool_calls'];
  error?: string;
}

/**
 * The agent loop's model capability, executed by the owner's Hermes runtime.
 *
 * Hermes owns provider selection, credentials, timeouts, and its own fallback
 * chain, so this makes exactly one call and reports a failure unchanged. A
 * failed turn is not lost work: every Index event re-reads authoritative state
 * before deciding, so the next wake reconsiders the match from scratch.
 */
export class HermesModel implements Model {
  constructor(private readonly bridge: { url: string; token: string }) {}

  /**
   * @param messages - The conversation for this call, in OpenAI shape.
   * @param tools - Tool definitions the agent injected for this turn.
   * @param options - Per-call cancellation; retries belong to Hermes.
   * @returns The assistant's text or tool calls.
   * @throws When the bridge refuses the call or Hermes reports a model failure.
   */
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    options: ModelRequestOptions = {},
  ): Promise<ModelMessage> {
    const response = await fetch(`${this.bridge.url}/complete`, {
      method: 'POST',
      signal: options.signal,
      headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, ...(tools.length > 0 ? { tools } : {}) }),
    });

    const body = await response.text();
    let reply: BridgeReply = {};
    try {
      reply = JSON.parse(body) as BridgeReply;
    } catch {
      // A non-JSON body is reported through the status check below.
    }
    if (!response.ok) {
      throw new Error(`Hermes model call failed (${response.status}): ${reply.error ?? body.slice(0, 500)}`);
    }

    return {
      role: 'assistant',
      content: reply.content ?? null,
      ...(reply.tool_calls?.length ? { tool_calls: reply.tool_calls } : {}),
    };
  }
}
