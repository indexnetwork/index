import type { Execute, ExecutionInput } from '@indexnetwork/agent';

import type { TuiActivity, TuiToolCall } from './negotiation.tui.js';

const TOOL_LABELS: Record<string, string> = {
  set_brief: 'Briefing a negotiator',
  note_principal: 'Updating the principal',
  ask_principal: 'Asking a question',
  expire_question: 'Retiring a question',
  reach_counterparties: 'Discovering counterparties and opening opportunities',
};

/** Ephemeral, owner-only execution observations; never conversation records or agent inputs. */
export class ReasoningObserver implements TuiActivity {
  readonly toolCalls: TuiToolCall[] = [];
  private readonly runs = new Map<string, Pick<ExecutionInput, 'operation' | 'opportunityId'>>();

  /** @param onChange - Notifies the board without scheduling agent work. */
  constructor(private readonly onChange: () => void) {}

  get reviewing(): boolean { return [...this.runs.values()].some((run) => run.operation !== 'negotiate'); }
  get negotiating(): string[] {
    return [...this.runs.values()].filter((run) => run.operation === 'negotiate').map((run) => run.opportunityId!);
  }

  /**
   * Observe one execution without changing its prompts, budget, handlers' results, or failures.
   * @param input - The agent's prepared reasoning run.
   * @param execute - The supplied direct or native reasoning executor.

   * @returns After the original executor completes.
   * @throws The original execution or handler failure, without retries or recovery.
   */
  async run(input: ExecutionInput, execute: Execute): Promise<void> {
    if (input.abortSignal.aborted) return execute(input);
    const runId = crypto.randomUUID();
    const calls = new Set<TuiToolCall>();
    this.runs.set(runId, { operation: input.operation, opportunityId: input.opportunityId });
    const cancel = () => {
      this.runs.delete(runId);
      for (const call of calls) {
        if (call.status !== 'running') continue;
        call.status = 'cancelled';
        call.summary = 'Cancelled.';
      }
      this.onChange();
    };
    input.abortSignal.addEventListener('abort', cancel, { once: true });
    this.onChange();
    try {
      if (input.operation === 'negotiate') {
        await execute(input);
        return;
      }
      const operation = input.operation;
      await execute({
        ...input,
        tools: input.tools.map((tool) => ({
          ...tool,
          run: async (argument) => {
            if (input.abortSignal.aborted) return tool.run(argument);
            const call: TuiToolCall = {
              id: crypto.randomUUID(), runId, operation,
              name: tool.name, label: TOOL_LABELS[tool.name] ?? tool.name,
              status: 'running',
              details: (operation === 'brief' ? 'Opportunity: ' + input.opportunityId + '\n\n' : '') + describe(argument),
            };
            calls.add(call);
            this.toolCalls.push(call);
            this.onChange();
            try {
              const result = await tool.run(argument);
              if (call.status === 'running') {
                call.status = 'completed';
                call.summary = describe(result) || 'Completed.';
              }
              return result;
            } catch (error) {
              if (call.status === 'running') {
                call.status = 'error';
                call.summary = error instanceof Error ? error.message : describe(error);
              }
              throw error;
            } finally {
              this.onChange();
            }
          },
        })),
      });
    } finally {
      input.abortSignal.removeEventListener('abort', cancel);
      this.runs.delete(runId);
      this.onChange();
    }
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    // Observation formatting must not turn a successful tool invocation into a failure.
    return '[Value cannot be displayed as JSON]';
  }
}
