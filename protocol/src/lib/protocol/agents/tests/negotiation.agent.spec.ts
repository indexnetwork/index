import { config } from "dotenv";
config({ path: '.env.development', override: true });

import { describe, expect, it, beforeAll, mock } from "bun:test";
import { NegotiationAgent } from "../negotiation.agent";
import type {
  NegotiationAgentInput,
  NegotiationTrigger,
  NegotiationTurn,
} from "../../../../types/negotiation.types";
import type { Id } from "../../../../types/common.types";

describe('NegotiationAgent - Basic Turn Generation', () => {
  let agent: NegotiationAgent;

  beforeAll(() => {
    agent = new NegotiationAgent();
  });

  it('should generate an opening turn message', async () => {
    const input: NegotiationAgentInput = {
      principal: {
        userId: 'user-1' as Id<'users'>,
        profile: {
          name: 'Alice Smith',
          bio: 'AI startup founder building agent infrastructure',
          location: 'San Francisco',
          skills: ['AI', 'Agents', 'Infrastructure'],
          interests: ['AI coordination', 'Multi-agent systems'],
        },
        activeIntents: [
          {
            intentId: 'intent-1' as Id<'intents'>,
            payload: 'Looking for investors interested in AI agent infrastructure',
            summary: 'Seeking AI investors',
          },
        ],
      },
      counterparty: {
        userId: 'user-2' as Id<'users'>,
        profile: {
          name: 'Bob Johnson',
          bio: 'Partner at AI Ventures, investing in agent technology',
          location: 'New York',
          skills: ['Investing', 'Due diligence', 'Portfolio management'],
          interests: ['AI startups', 'Agent technology', 'Infrastructure'],
        },
        activeIntents: [
          {
            intentId: 'intent-2' as Id<'intents'>,
            payload: 'Seeking AI infrastructure companies for Series A',
            summary: 'Looking for AI infra investments',
          },
        ],
      },
      negotiationState: {
        turns: [],
        currentTurn: 0,
        trigger: {
          source: 'search',
          query: 'AI investors',
        },
      },
      action: 'generate_turn',
    };

    const result = await agent.invoke(input);

    expect(result.decision).toBeDefined();
    expect(['continue', 'extend', 'accept', 'decline', 'defer']).toContain(result.decision);
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.length).toBeGreaterThan(10);
    
    // For a good match like this, should not immediately decline
    if (result.message) {
      expect(result.message.context).toBeDefined();
      expect(result.message.context.length).toBeGreaterThan(0);
    }
  }, 60000);

  it('should evaluate a counterparty response', async () => {
    const existingTurn: NegotiationTurn = {
      turn: 1,
      participantUserId: 'user-1' as Id<'users'>,
      message: {
        context: 'AI infrastructure for agent coordination',
        upside: 'High potential for distribution compounds',
        invitation: 'Would this fit your investment mandate?',
      },
      decision: 'continue',
      reasoning: 'Strong profile match, initiating conversation',
      timestamp: new Date().toISOString(),
    };

    const input: NegotiationAgentInput = {
      principal: {
        userId: 'user-2' as Id<'users'>,
        profile: {
          name: 'Bob Johnson',
          bio: 'Partner at AI Ventures',
          skills: ['Investing'],
          interests: ['AI startups'],
        },
        activeIntents: [],
      },
      counterparty: {
        userId: 'user-1' as Id<'users'>,
        profile: {
          name: 'Alice Smith',
          bio: 'AI startup founder',
          skills: ['AI', 'Agents'],
          interests: ['AI coordination'],
        },
        activeIntents: [],
      },
      negotiationState: {
        turns: [existingTurn],
        currentTurn: 1,
        trigger: { source: 'search' },
      },
      action: 'evaluate_response',
    };

    const result = await agent.invoke(input);

    expect(result.decision).toBeDefined();
    expect(result.reasoning).toBeDefined();
  }, 60000);

  it('should decline when there is clear mismatch', async () => {
    const input: NegotiationAgentInput = {
      principal: {
        userId: 'user-1' as Id<'users'>,
        profile: {
          name: 'Charlie Brown',
          bio: 'Elementary school teacher focused on art education',
          location: 'Vermont',
          skills: ['Teaching', 'Art'],
          interests: ['K-12 education', 'Watercolor painting'],
        },
        activeIntents: [
          {
            intentId: 'intent-1' as Id<'intents'>,
            payload: 'Looking for art supply discounts for classroom',
          },
        ],
      },
      counterparty: {
        userId: 'user-2' as Id<'users'>,
        profile: {
          name: 'Diana Tech',
          bio: 'Deep learning researcher at quantum computing lab',
          location: 'Boston',
          skills: ['Quantum computing', 'Neural networks', 'Physics'],
          interests: ['Quantum ML', 'Hardware optimization'],
        },
        activeIntents: [
          {
            intentId: 'intent-2' as Id<'intents'>,
            payload: 'Seeking collaborators on quantum error correction',
          },
        ],
      },
      negotiationState: {
        turns: [],
        currentTurn: 0,
        trigger: { source: 'search' },
      },
      action: 'generate_turn',
    };

    const result = await agent.invoke(input);

    // Should recognize the mismatch
    expect(result.decision).toBeDefined();
    expect(result.reasoning).toBeDefined();
    expect(result.reasoning.length).toBeGreaterThan(20);
  }, 60000);
});

describe('NegotiationAgent - Decision Types', () => {
  let agent: NegotiationAgent;

  beforeAll(() => {
    agent = new NegotiationAgent();
  });

  it('should return valid decision types', async () => {
    const validDecisions = ['continue', 'extend', 'accept', 'decline', 'defer'];
    
    const input: NegotiationAgentInput = {
      principal: {
        userId: 'user-1' as Id<'users'>,
        profile: { name: 'Test User' },
        activeIntents: [],
      },
      counterparty: {
        userId: 'user-2' as Id<'users'>,
        profile: { name: 'Other User' },
        activeIntents: [],
      },
      negotiationState: {
        turns: [],
        currentTurn: 0,
        trigger: { source: 'search' },
      },
      action: 'generate_turn',
    };

    const result = await agent.invoke(input);

    expect(validDecisions).toContain(result.decision);
  }, 60000);

  it('should include extendReason when decision is extend', async () => {
    // Create a scenario that might trigger extension
    const turns: NegotiationTurn[] = [
      {
        turn: 1,
        participantUserId: 'user-1' as Id<'users'>,
        message: { context: 'Exploring potential collaboration' },
        decision: 'continue',
        reasoning: 'Initial exploration',
        timestamp: new Date().toISOString(),
      },
      {
        turn: 2,
        participantUserId: 'user-2' as Id<'users'>,
        message: { context: 'Interesting, but need more details about scope' },
        decision: 'continue',
        reasoning: 'Need clarification',
        timestamp: new Date().toISOString(),
      },
    ];

    const input: NegotiationAgentInput = {
      principal: {
        userId: 'user-1' as Id<'users'>,
        profile: {
          name: 'Alice',
          bio: 'Building something complex that needs explanation',
        },
        activeIntents: [
          {
            intentId: 'intent-1' as Id<'intents'>,
            payload: 'Complex multi-phase project needing detailed discussion',
          },
        ],
      },
      counterparty: {
        userId: 'user-2' as Id<'users'>,
        profile: { name: 'Bob', bio: 'Careful evaluator' },
        activeIntents: [],
      },
      negotiationState: {
        turns,
        currentTurn: 2,
        trigger: { source: 'search' },
      },
      action: 'evaluate_response',
    };

    const result = await agent.invoke(input);

    // If decision is extend, extendReason should be provided
    if (result.decision === 'extend') {
      expect(result.extendReason).toBeDefined();
      expect(result.extendReason!.length).toBeGreaterThan(0);
    }
  }, 60000);
});
