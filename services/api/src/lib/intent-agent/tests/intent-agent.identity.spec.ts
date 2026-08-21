/**
 * The IntentAgent knows its own name.
 *
 * The DM surface addresses this agent by the name on the client's
 * `type='personal'` agent row — the placeholder is `Message ${agentName}…`
 * and the header says "your direct line to {agentName} about this signal".
 * Between #1478 (which retired the named negotiator persona from this scope)
 * and this change, the law opened namelessly, so the client called the agent
 * something the agent had never heard.
 *
 * Two things are pinned here: the name reaches BOTH stages of a turn from
 * the one context, and a missing row is never fatal — it degrades to the
 * generic opener, because this loop conducts negotiations unattended.
 */
import { describe, expect, it } from 'bun:test';

import { assembleIntentAgentContext } from '../intent-agent.context';
import type { IntentAgentContextDeps, IntentAgentTurnContext } from '../intent-agent.context';
import { INTENT_AGENT_SYSTEM_PROMPT_VERSION, buildIntentAgentSystemPrompt } from '../intent-agent.prompt';
import { IntentAgentTurn } from '../intent-agent.turn';
import type { IntentAgentInboxEvent } from '../intent-agent.types';

const NEEDS_INPUT: IntentAgentInboxEvent = {
  kind: 'negotiation_needs_input',
  userId: 'user-1',
  intentId: 'intent-1',
  opportunityId: '11111111-1111-4111-8111-111111111111',
  taskId: 'task-1',
};

const USER_MESSAGE: IntentAgentInboxEvent = {
  kind: 'user_message',
  userId: 'user-1',
  intentId: 'intent-1',
  sessionId: 'session-1',
  messageId: 'reply-1',
  text: 'Q4 works.',
};

function context(overrides: Partial<IntentAgentTurnContext> = {}): IntentAgentTurnContext {
  return {
    event: NEEDS_INPUT,
    signalText: 'Find a manufacturing partner',
    parked: [],
    dossier: [],
    opportunities: [],
    recentDm: [],
    recentActs: [],
    ...overrides,
  };
}

/** Every collaborator injected: the assembly runs with no database at all. */
function contextDeps(overrides: Partial<IntentAgentContextDeps> = {}): IntentAgentContextDeps {
  return {
    readAgentName: async () => 'Ada\'s Agent',
    readParkedNegotiations: async () => [],
    readDossier: async () => [],
    readOpportunities: async () => [],
    readLedger: async () => [],
    findSession: async () => null,
    getSessionMessages: async () => [],
    getIntentText: async () => 'Find a manufacturing partner',
    ...overrides,
  };
}

/** A turn that records the system prompt each stage actually sent. */
class CapturingTurn extends IntentAgentTurn {
  systems: string[] = [];
  constructor() {
    super({ model: 'test-model' });
  }
  protected override async callModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.systems.push(messages.find((message) => message.role === 'system')!.content);
    return { acts: [{ act: 'wait', reason: 'nothing to do' }] };
  }
  protected override async callReplyModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.systems.push(messages.find((message) => message.role === 'system')!.content);
    return { reply: 'Nothing needs you right now.' };
  }
}

describe('buildIntentAgentSystemPrompt', () => {
  it('opens in the agent\'s own name — identity is the self-conception, not a context field', () => {
    const prompt = buildIntentAgentSystemPrompt({ agentName: 'Ada\'s Agent' });
    expect(prompt.startsWith(
      'You are Ada\'s Agent, your client\'s personal agent for ONE signal — one thing they are trying to find or make happen.',
    )).toBe(true);
  });

  it('falls back to the nameless opener, unchanged from version 2, when the row has no name', () => {
    // Byte-identical to the pre-identity opener: a missing agent row must
    // cost the client nothing but the name.
    const opener = 'You are your client\'s personal agent for ONE signal — one thing they are trying to find or make happen.';
    expect(buildIntentAgentSystemPrompt().startsWith(opener)).toBe(true);
    expect(buildIntentAgentSystemPrompt({}).startsWith(opener)).toBe(true);
  });

  it('changes nothing else about the law — the identity is one sentence', () => {
    const named = buildIntentAgentSystemPrompt({ agentName: 'Ada\'s Agent' });
    const nameless = buildIntentAgentSystemPrompt();
    const firstSentence = (prompt: string) => prompt.slice(0, prompt.indexOf('You conduct negotiations'));
    expect(named.slice(firstSentence(named).length)).toBe(nameless.slice(firstSentence(nameless).length));
    // The version constant exists to make a prompt change loud.
    expect(INTENT_AGENT_SYSTEM_PROMPT_VERSION).toBe(4);
  });
});

describe('the turn carries one identity through both stages', () => {
  it('names the agent to the acts stage and to the reply stage alike', async () => {
    const turn = new CapturingTurn();
    const bound = context({ event: USER_MESSAGE, agentName: 'Ada\'s Agent' });
    await turn.decide(bound);
    await turn.reply(bound, []);
    expect(turn.systems).toHaveLength(2);
    for (const system of turn.systems) {
      expect(system.startsWith('You are Ada\'s Agent, ')).toBe(true);
    }
  });

  it('speaks generically when the context carries no name — a turn is never lost to one', async () => {
    const turn = new CapturingTurn();
    await turn.decide(context());
    expect(turn.systems[0]!.startsWith('You are your client\'s personal agent')).toBe(true);
  });
});

describe('context assembly resolves the identity', () => {
  it('reads the name from the personal agent row, trimmed', async () => {
    const assembled = await assembleIntentAgentContext(
      NEEDS_INPUT,
      contextDeps({ readAgentName: async () => '  Ada\'s Agent  ' }),
    );
    expect(assembled.agentName).toBe('Ada\'s Agent');
  });

  it('leaves the name absent — never throws — when the row is missing, nameless, or unreadable', async () => {
    for (const readAgentName of [
      async () => null,
      async () => '   ',
      async () => { throw new Error('agent row unreadable'); },
    ] satisfies Array<IntentAgentContextDeps['readAgentName']>) {
      const assembled = await assembleIntentAgentContext(NEEDS_INPUT, contextDeps({ readAgentName }));
      expect(assembled.agentName).toBeUndefined();
      // The rest of the turn is untouched by a name that did not resolve.
      expect(assembled.signalText).toBe('Find a manufacturing partner');
    }
  });
});
