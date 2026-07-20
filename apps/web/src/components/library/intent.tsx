/**
 * Intent ("signal") variants — full-width Signals card, sidebar card, in-chat chip.
 * Visual language mirrors the IntentList Signals shelf: pulsing live indicator
 * for ACTIVE signals, blue "N to answer" badge, network chips, mono meta row.
 */
import { MessageSquare, Network, Pause, Play, RadioTower, Sparkles } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ChipLabel, ChipShell, CountBadge, LiveDot, LiveIndicator, MetaDate, Pill } from './shared';

/** Intent shape consumed by the library — a superset of the service Intent. */
export interface LibraryIntent {
  id: string;
  payload: string;
  summary?: string | null;
  /** Lifecycle status; undefined or ACTIVE renders the live indicator. */
  status?: 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED' | string;
  createdAt: string;
  networks?: Array<{ id: string; title: string }>;
  pendingQuestionCount?: number;
  opportunityCount?: number;
}

function intentSummary(intent: LibraryIntent): string {
  return (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
}

function isLive(intent: LibraryIntent): boolean {
  return !intent.status || intent.status.toUpperCase() === 'ACTIVE';
}

function statusTone(status?: string): 'amber' | 'emerald' | 'gray' {
  switch (status?.toUpperCase()) {
    case 'PAUSED':
      return 'amber';
    case 'FULFILLED':
      return 'emerald';
    default:
      return 'gray';
  }
}

interface IntentCardProps {
  intent: LibraryIntent;
  onOpen?: (intent: LibraryIntent) => void;
  onTogglePause?: (intent: LibraryIntent) => void;
  className?: string;
}

/**
 * 1 · Full-width intent card — the Signals page row. Shows everything:
 * summary, live/status, networks, pending questions, opportunities, actions.
 */
export function IntentCard({ intent, onOpen, onTogglePause, className }: IntentCardProps) {
  const live = isLive(intent);
  return (
    <div
      className={cn(
        'group rounded-lg border border-gray-200 bg-white p-4 transition-all hover:border-gray-300 hover:shadow-sm sm:p-5',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen?.(intent)}
            className="block w-full rounded-sm text-left text-[15px] font-semibold leading-snug text-gray-900 hover:text-[#041729] focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
          >
            {intentSummary(intent)}
          </button>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {live ? (
              <LiveIndicator />
            ) : (
              <Pill tone={statusTone(intent.status)} className="capitalize">
                {intent.status!.toLowerCase()}
              </Pill>
            )}
            <MetaDate dateStr={intent.createdAt} />
            {intent.networks?.slice(0, 2).map((network) => (
              <Pill key={network.id} tone="blue">
                <Network className="h-3 w-3" />
                <span className="max-w-[160px] truncate">{network.title}</span>
              </Pill>
            ))}
            {intent.networks && intent.networks.length > 2 && <Pill tone="blue">+{intent.networks.length - 2}</Pill>}
            {typeof intent.opportunityCount === 'number' && intent.opportunityCount > 0 && (
              <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 font-ibm-plex-mono">
                <Sparkles className="h-3 w-3" />
                {intent.opportunityCount} {intent.opportunityCount === 1 ? 'opportunity' : 'opportunities'}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          {typeof intent.pendingQuestionCount === 'number' && intent.pendingQuestionCount > 0 && (
            <CountBadge count={intent.pendingQuestionCount} icon={<MessageSquare className="h-3 w-3" />} />
          )}
          <div className="flex items-center gap-1.5">
            {onTogglePause && (
              <button
                type="button"
                onClick={() => onTogglePause(intent)}
                className="inline-flex items-center gap-1.5 rounded-sm border border-gray-300 px-3 py-1.5 text-xs font-medium text-[#3D3D3D] transition-colors hover:bg-gray-100"
              >
                {live ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {live ? 'Pause' : 'Resume'}
              </button>
            )}
            {onOpen && (
              <button
                type="button"
                onClick={() => onOpen(intent)}
                className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0a2d4a]"
              >
                View signal
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 2 · Sidebar intent card — condensed reference in a contextual rail.
 * Keeps identity, liveness, and the two actionable counts; drops actions.
 */
export function IntentSidebarCard({ intent, onOpen, className }: Pick<IntentCardProps, 'intent' | 'onOpen' | 'className'>) {
  const live = isLive(intent);
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(intent) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(intent);
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
      <div className="flex items-start gap-2">
        <RadioTower className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', live ? 'text-emerald-500' : 'text-gray-400')} />
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-gray-900 line-clamp-2">
          {intentSummary(intent)}
        </p>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 pl-[22px]">
        {live ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 font-ibm-plex-mono">
            <LiveDot /> live
          </span>
        ) : (
          <span className="text-[11px] capitalize text-gray-500 font-ibm-plex-mono">{intent.status!.toLowerCase()}</span>
        )}
        {typeof intent.pendingQuestionCount === 'number' && intent.pendingQuestionCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#4091BB] px-1.5 py-0.5 text-[10px] font-semibold text-white font-ibm-plex-mono">
            <MessageSquare className="h-2.5 w-2.5" />
            {intent.pendingQuestionCount}
          </span>
        )}
        {typeof intent.opportunityCount === 'number' && intent.opportunityCount > 0 && (
          <span className="inline-flex items-center gap-1 text-[11px] text-gray-500 font-ibm-plex-mono">
            <Sparkles className="h-2.5 w-2.5" />
            {intent.opportunityCount}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * 3 · In-chat intent chip — smallest variant. Icon + truncated summary +
 * liveness dot; the whole chip is one click target.
 */
export function IntentChip({ intent, onOpen, className }: Pick<IntentCardProps, 'intent' | 'onOpen' | 'className'>) {
  return (
    <ChipShell
      icon={<RadioTower className="h-3 w-3" />}
      title={intentSummary(intent)}
      onClick={onOpen ? () => onOpen(intent) : undefined}
      className={className}
    >
      <ChipLabel className="max-w-[220px]">{intentSummary(intent)}</ChipLabel>
      {isLive(intent) && <LiveDot />}
    </ChipShell>
  );
}
