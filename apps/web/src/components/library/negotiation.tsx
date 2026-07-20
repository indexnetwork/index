/**
 * Negotiation variants — full-width card, sidebar card, in-chat chip.
 * Follows NegotiationHistory: per-turn action labels with semantic colors
 * (propose blue / counter amber / accept emerald / reject red), agent-attributed
 * reasoning, and relative timestamps.
 */
import { ArrowLeftRight, Bot } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { NegotiationSummary, NegotiationTurnSummary } from '@/services/users';
import { ChipLabel, ChipShell, EntityAvatar, Pill, timeAgo } from './shared';

/** The library consumes the service negotiation summary directly. */
export type LibraryNegotiation = NegotiationSummary;

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  propose: { label: 'Proposed', color: 'text-blue-600' },
  counter: { label: 'Countered', color: 'text-amber-600' },
  accept: { label: 'Accepted', color: 'text-emerald-600' },
  reject: { label: 'Rejected', color: 'text-red-600' },
};

function actionInfo(action: string): { label: string; color: string } {
  return ACTION_LABELS[action] ?? { label: action, color: 'text-gray-600' };
}

function stateTone(state: NegotiationSummary['state']): 'blue' | 'amber' | 'emerald' | 'red' | 'gray' {
  switch (state) {
    case 'completed':
      return 'emerald';
    case 'failed':
    case 'rejected':
    case 'canceled':
      return 'red';
    case 'input_required':
    case 'waiting_for_agent':
    case 'auth_required':
      return 'amber';
    case 'working':
    case 'claimed':
    case 'submitted':
      return 'blue';
    default:
      return 'gray';
  }
}

function stateLabel(state: NegotiationSummary['state']): string {
  return state.replace(/_/g, ' ');
}

function latestTurn(negotiation: LibraryNegotiation): NegotiationTurnSummary | null {
  return negotiation.turns.length > 0 ? negotiation.turns[negotiation.turns.length - 1] : null;
}

interface NegotiationCardProps {
  negotiation: LibraryNegotiation;
  onOpen?: (negotiation: LibraryNegotiation) => void;
  className?: string;
}

/**
 * 1 · Full-width negotiation card — parties, state, latest agent turn, and a
 * compact timeline of the most recent turns.
 */
export function NegotiationCard({ negotiation, onOpen, className }: NegotiationCardProps) {
  const recentTurns = negotiation.turns.slice(-3);
  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-4 sm:p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityAvatar name={negotiation.counterparty.name} size={32} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-bold text-gray-900">
              {negotiation.counterparty.name}&rsquo;s Agent
              <Bot className="h-3.5 w-3.5 shrink-0 text-gray-400" />
            </p>
            <p className="text-[11px] text-gray-500 font-ibm-plex-mono">
              {negotiation.outcome?.turnCount ?? negotiation.turns.length} turns · {timeAgo(negotiation.updatedAt)}
            </p>
          </div>
        </div>
        <Pill tone={stateTone(negotiation.state)} className="capitalize">
          {stateLabel(negotiation.state)}
        </Pill>
      </div>

      {recentTurns.length > 0 && (
        <div className="mt-4 space-y-3 border-l border-gray-200 pl-4">
          {recentTurns.map((turn, index) => {
            const info = actionInfo(turn.action);
            return (
              <div key={`${turn.createdAt}-${index}`} className="relative">
                <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full border border-gray-300 bg-white" />
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-medium text-gray-900">{turn.speaker.name}&rsquo;s Agent</span>
                  <span className={cn('text-xs font-medium', info.color)}>{info.label}</span>
                  <span className="text-[11px] text-gray-400 font-ibm-plex-mono">{timeAgo(turn.createdAt)}</span>
                </div>
                <p className={cn('mt-0.5 text-[13px] leading-relaxed text-gray-600', index < recentTurns.length - 1 && 'line-clamp-2')}>
                  {turn.reasoning}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {onOpen && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onOpen(negotiation)}
            className="rounded-sm border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#3D3D3D] transition-colors hover:bg-gray-100"
          >
            View full negotiation
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * 2 · Sidebar negotiation card — parties, state pill, latest action, and one
 * clamped reasoning line.
 */
export function NegotiationSidebarCard({ negotiation, onOpen, className }: NegotiationCardProps) {
  const turn = latestTurn(negotiation);
  const info = turn ? actionInfo(turn.action) : null;
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(negotiation) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(negotiation);
              }
            }
          : undefined
      }
      className={cn(
        'rounded-lg border border-gray-200 bg-white p-3 transition-colors',
        onOpen && 'cursor-pointer hover:border-gray-300 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EntityAvatar name={negotiation.counterparty.name} size={22} />
          <span className="truncate text-[13px] font-bold text-gray-900">{negotiation.counterparty.name}&rsquo;s Agent</span>
        </div>
        <Pill tone={stateTone(negotiation.state)} className="px-1.5 py-0 text-[10px] capitalize">
          {stateLabel(negotiation.state)}
        </Pill>
      </div>
      {turn && info && (
        <p className="mt-2 text-[13px] leading-relaxed text-gray-600 line-clamp-2">
          <span className={cn('font-medium', info.color)}>{info.label}</span> — {turn.reasoning}
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-400 font-ibm-plex-mono">
        {negotiation.outcome?.turnCount ?? negotiation.turns.length} turns · {timeAgo(negotiation.updatedAt)}
      </p>
    </div>
  );
}

/**
 * 3 · In-chat negotiation chip — smallest variant. Icon + counterparty +
 * state; one click target.
 */
export function NegotiationChip({ negotiation, onOpen, className }: NegotiationCardProps) {
  return (
    <ChipShell
      icon={<ArrowLeftRight className="h-3 w-3" />}
      title={`Negotiation with ${negotiation.counterparty.name} (${stateLabel(negotiation.state)})`}
      onClick={onOpen ? () => onOpen(negotiation) : undefined}
      className={className}
    >
      <ChipLabel className="max-w-[180px]">{negotiation.counterparty.name}&rsquo;s Agent</ChipLabel>
      <Pill tone={stateTone(negotiation.state)} className="px-1.5 py-0 text-[10px] capitalize">
        {stateLabel(negotiation.state)}
      </Pill>
    </ChipShell>
  );
}
