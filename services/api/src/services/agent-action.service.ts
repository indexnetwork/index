import type { AgentActionProposalResultRecord, AgentActionProposalRow } from '../schemas/database.schema';
import type { AgentActionProposalDatabaseAdapter, AgentActionProposalDisplay } from '../adapters/agent-action-proposal.database.adapter';
import { chatDatabaseAdapter, type ChatDatabaseAdapter } from '../adapters/database.adapter';

export type AgentActionPauseResult =
  | { kind: 'success'; id: string; status: 'ACTIVE' | 'PAUSED'; changed: boolean; lifecycleVersionMs: number }
  | { kind: 'conflict' }
  | { kind: 'stale' }
  | { kind: 'other' };

export interface AgentActionRuntime {
  getIntent(intentId: string, userId: string): Promise<{
    id: string;
    payload: string;
    summary: string | null;
    status: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | null;
    archivedAt: Date | null;
    updatedAt: Date;
  } | null>;
  retractPremise(premiseId: string, userId: string, expectedUpdatedAt: Date): Promise<'applied' | 'alreadyDone' | 'stale' | 'not_found'>;
  updateIntentDescription(intentId: string, userId: string, description: string, expectedUpdatedAt: Date): Promise<'applied' | 'stale' | 'not_found'>;
  transitionStatus(intentId: string, userId: string, status: 'ACTIVE' | 'PAUSED', expectedUpdatedAtMs: number): Promise<AgentActionPauseResult>;
}

export type AgentActionConfirmResult = {
  proposalId: string;
  status: 'consumed' | 'replayed';
  results: AgentActionProposalResultRecord[];
};

export type AgentActionProposalReadResult = {
  proposalId: string;
  status: AgentActionProposalDisplay['status'];
  actions: AgentActionProposalDisplay['actions'];
  results: AgentActionProposalResultRecord[] | null;
};

/** Executes owner-confirmed reporter cleanup proposals through existing paths. */
export class AgentActionService {
  constructor(
    private readonly proposals: Pick<AgentActionProposalDatabaseAdapter, 'getProposal' | 'claimProposal' | 'consumeProposal'>,
    private readonly runtime: AgentActionRuntime,
    private readonly premises: Pick<ChatDatabaseAdapter, 'getPremise'> = chatDatabaseAdapter,
  ) {}

  /** Returns canonical display-safe proposal state for the authenticated owner. */
  async readProposal(userId: string, proposalId: string): Promise<AgentActionProposalReadResult | null> {
    const proposal = await this.proposals.getProposal(proposalId, userId);
    if (!proposal) return null;
    return {
      proposalId: proposal.id,
      status: proposal.status,
      actions: proposal.actions,
      results: proposal.status === 'consumed' ? proposal.result ?? [] : null,
    };
  }

  async confirm(userId: string, proposalId: string): Promise<
    | { kind: 'not_found' }
    | { kind: 'in_progress' }
    | { kind: 'success'; result: AgentActionConfirmResult }
  > {
    const claim = await this.proposals.claimProposal(proposalId, userId);
    if (claim.kind === 'missing') return { kind: 'not_found' };
    if (claim.kind === 'in_progress') return claim;
    if (claim.kind === 'replay') {
      return {
        kind: 'success',
        result: { proposalId, status: 'replayed', results: claim.result },
      };
    }

    const results: AgentActionProposalResultRecord[] = [];
    for (const action of claim.proposal.actions) {
      if (action.skipped || !action.snapshot) {
        results.push({
          type: action.type,
          entityId: action.entityId,
          operation: action.proposedOperation,
          previousState: action.currentState,
          resultingState: action.currentState,
          ...(action.evidence ? { evidence: action.evidence } : {}),
          outcome: 'skipped',
          ...(action.reason ? { reason: action.reason } : {}),
        });
        continue;
      }

      if (action.type === 'retract_premise') {
        results.push(await this.confirmPremise(userId, action));
        continue;
      }
      results.push(await this.confirmIntent(userId, action));
    }

    await this.proposals.consumeProposal(proposalId, userId, results);
    return { kind: 'success', result: { proposalId, status: 'consumed', results } };
  }

  private async confirmPremise(
    userId: string,
    action: Extract<AgentActionProposalRow['actions'][number], { type: 'retract_premise' }>,
  ): Promise<AgentActionProposalResultRecord> {
    const premise = await this.premises.getPremise(action.entityId).catch(() => null);
    if (!premise || premise.userId !== userId) {
      return this.skipped(action, 'Premise not found or not owned by the authenticated user.');
    }
    if (premise.status === 'RETRACTED') {
      return this.result(action, 'RETRACTED', 'RETRACTED', 'alreadyDone');
    }
    if (premise.status !== 'ACTIVE') {
      return this.result(action, premise.status, premise.status, 'skipped', `Premise is already ${premise.status}.`);
    }
    if (action.snapshot?.status !== premise.status || action.snapshot.updatedAt !== premise.updatedAt.toISOString()) {
      return this.result(action, premise.status, premise.status, 'stale', 'Premise state changed after the proposal was prepared.');
    }

    const mutation = await this.runtime.retractPremise(action.entityId, userId, new Date(action.snapshot?.updatedAt ?? ''));
    if (mutation === 'alreadyDone') {
      return this.result(action, 'RETRACTED', 'RETRACTED', 'alreadyDone');
    }
    if (mutation !== 'applied') {
      const latest = await this.premises.getPremise(action.entityId).catch(() => null);
      if (latest?.status === 'RETRACTED' && latest.userId === userId) {
        return this.result(action, 'RETRACTED', 'RETRACTED', 'alreadyDone');
      }
      if (mutation === 'stale') {
        return this.result(action, latest?.status ?? action.currentState, latest?.status ?? action.currentState, 'stale', 'Premise state changed during confirmation.');
      }
      return this.skipped(action, 'Premise could not be retracted safely.');
    }
    return this.result(action, 'ACTIVE', 'RETRACTED', 'applied');
  }

  private async confirmIntent(
    userId: string,
    action: Extract<AgentActionProposalRow['actions'][number], { type: 'narrow_signal' | 'pause_signal' }>,
  ): Promise<AgentActionProposalResultRecord> {
    const intent = await this.runtime.getIntent(action.entityId, userId);
    if (!intent) return this.skipped(action, 'Signal not found or not owned by the authenticated user.');
    const status = intent.status ?? 'ACTIVE';
    if (action.type === 'pause_signal' && status === 'PAUSED') {
      return this.result(action, 'PAUSED', 'PAUSED', 'alreadyDone');
    }
    if (intent.archivedAt || status === 'FULFILLED' || status === 'EXPIRED') {
      return this.result(action, status, status, 'skipped', 'Signal is archived or terminal and cannot be changed.');
    }
    if (action.snapshot?.status !== status || action.snapshot.updatedAt !== intent.updatedAt.toISOString()) {
      return this.result(action, status, status, 'stale', 'Signal state changed after the proposal was prepared.');
    }

    if (action.type === 'narrow_signal') {
      if (!action.description) return this.skipped(action, 'A narrower description is required.');
      const mutation = await this.runtime.updateIntentDescription(action.entityId, userId, action.description, new Date(action.snapshot?.updatedAt ?? ''));
      if (mutation === 'stale') return this.result(action, status, status, 'stale', 'Signal state changed during confirmation.');
      if (mutation !== 'applied') return this.skipped(action, 'Signal could not be updated safely.');
      return this.result(action, status, status, 'applied');
    }

    const transitioned = await this.runtime.transitionStatus(action.entityId, userId, 'PAUSED', new Date(action.snapshot?.updatedAt ?? '').getTime());
    if (transitioned.kind === 'success') {
      return this.result(action, status, transitioned.status, transitioned.changed ? 'applied' : 'alreadyDone');
    }
    if (transitioned.kind === 'conflict') {
      return this.result(action, status, status, 'skipped', 'Signal became terminal before confirmation.');
    }
    if (transitioned.kind === 'stale') {
      return this.result(action, status, status, 'stale', 'Signal state changed during confirmation.');
    }
    return this.skipped(action, 'Signal could not be paused safely.');
  }

  private result(
    action: { type: AgentActionProposalResultRecord['type']; entityId: string; proposedOperation: string; evidence?: string },
    previousState: string,
    resultingState: string,
    outcome: AgentActionProposalResultRecord['outcome'],
    reason?: string,
  ): AgentActionProposalResultRecord {
    return {
      type: action.type,
      entityId: action.entityId,
      operation: action.proposedOperation,
      previousState,
      resultingState,
      ...(action.evidence ? { evidence: action.evidence } : {}),
      outcome,
      ...(reason ? { reason } : {}),
    };
  }

  private skipped(
    action: { type: AgentActionProposalResultRecord['type']; entityId: string; proposedOperation: string; currentState: string; evidence?: string },
    reason: string,
  ): AgentActionProposalResultRecord {
    return this.result(action, action.currentState, action.currentState, 'skipped', reason);
  }
}
