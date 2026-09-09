import { decideNegotiationTurn, observeNegotiation, type NegotiationTurn } from '../protocol/negotiation.rules.js';
import type { NegotiationDatabase } from '../platform/database/negotiation.js';

/** Autonomous participation: observe current rules, then commit a decision under those rules. */
export class Negotiations {
  constructor(private readonly database: NegotiationDatabase) {}

  /** @param id - Opportunity identity. @param userId - Reading principal. @returns Current guidance and legal actions, or null for an absent seat. */
  async observe(id: string, userId: string) {
    const state = await this.database.readNegotiationState(id, userId);
    return state ? observeNegotiation(state, userId) : null;
  }

  /** @param id - Opportunity identity. @param userId - Acting principal. @param turn - Decision against an observed log. @returns The authoritative transition or refusal. */
  execute(id: string, userId: string, turn: NegotiationTurn) {
    return this.database.commitNegotiationTurn(id, userId, turn, (state) => decideNegotiationTurn(state, userId, turn));
  }
}
