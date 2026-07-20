/**
 * Opportunity variants — full-width card, sidebar card, in-chat chip.
 * Follows the OpportunityCardInChat presentation contract (HomeViewCardItem):
 * avatar + name + mutual-intents label, presenter mainText/cta, narrator chip,
 * status-keyed border colors, dark primary / outline secondary actions.
 */
import { CheckCircle2, Clock, MessageSquare, Sparkles, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { HomeViewCardItem, OpportunityLifecycleStatus } from '@/services/opportunities';
import { ChipLabel, ChipShell, EntityAvatar, Pill } from './shared';

/** The library consumes the presenter-driven card contract directly. */
export type LibraryOpportunity = HomeViewCardItem;

/** Border color keyed to lifecycle status (OpportunityCardInChat pattern). */
function statusBorderClass(status?: OpportunityLifecycleStatus): string {
  switch (status) {
    case 'rejected':
      return 'border-red-200';
    case 'expired':
      return 'border-amber-200';
    default:
      return 'border-gray-200';
  }
}

function statusTone(status?: OpportunityLifecycleStatus): 'emerald' | 'red' | 'amber' | 'blue' | 'gray' {
  switch (status) {
    case 'accepted':
      return 'emerald';
    case 'rejected':
      return 'red';
    case 'expired':
    case 'stalled':
      return 'amber';
    case 'negotiating':
      return 'blue';
    default:
      return 'gray';
  }
}

/** Compact resolved-status marker reused by all three variants. */
function ResolvedStatus({ status }: { status?: OpportunityLifecycleStatus }) {
  switch (status) {
    case 'accepted':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600">
          <CheckCircle2 className="h-3.5 w-3.5" /> Connected
        </span>
      );
    case 'rejected':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-500">
          <X className="h-3 w-3" /> Declined
        </span>
      );
    case 'expired':
      return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500">
          <Clock className="h-3 w-3" /> Expired
        </span>
      );
    default:
      return null;
  }
}

interface OpportunityCardProps {
  opportunity: LibraryOpportunity;
  onPrimaryAction?: (opportunity: LibraryOpportunity) => void;
  onSecondaryAction?: (opportunity: LibraryOpportunity) => void;
  onOpenProfile?: (opportunity: LibraryOpportunity) => void;
  className?: string;
}

/**
 * 1 · Full-width opportunity card — Signals page / discovery feed. Shows the
 * complete presenter payload: headline, mainText, cta, narrator, actions.
 */
export function OpportunityCard({
  opportunity,
  onPrimaryAction,
  onSecondaryAction,
  onOpenProfile,
  className,
}: OpportunityCardProps) {
  const resolved = opportunity.status === 'accepted' || opportunity.status === 'rejected' || opportunity.status === 'expired';
  return (
    <div className={cn('rounded-lg border bg-white p-4 sm:p-5', statusBorderClass(opportunity.status), className)}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpenProfile?.(opportunity)}
          className="flex min-w-0 items-center gap-2.5 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
        >
          <EntityAvatar name={opportunity.name || 'Someone'} size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-gray-900">{opportunity.name || 'Someone'}</span>
            <span className="block truncate text-[11px] text-[#3D3D3D]">
              {opportunity.mutualIntentsLabel || 'Potential connection'}
            </span>
          </span>
        </button>
        {resolved ? (
          <ResolvedStatus status={opportunity.status} />
        ) : (
          <div className="flex shrink-0 gap-1.5">
            {onPrimaryAction && (
              <button
                type="button"
                onClick={() => onPrimaryAction(opportunity)}
                className="rounded-sm bg-[#041729] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#0a2d4a]"
              >
                {opportunity.primaryActionLabel || 'Start Chat'}
              </button>
            )}
            {onSecondaryAction && (
              <button
                type="button"
                onClick={() => onSecondaryAction(opportunity)}
                className="rounded-sm border border-gray-400 bg-transparent px-3 py-1.5 text-xs font-medium text-[#3D3D3D] transition-colors hover:bg-gray-200"
              >
                {opportunity.secondaryActionLabel || 'Skip'}
              </button>
            )}
          </div>
        )}
      </div>

      {opportunity.headline && (
        <p className="mt-3 text-[15px] font-semibold leading-snug text-gray-900">{opportunity.headline}</p>
      )}
      <p className="mt-1.5 whitespace-pre-line text-[14px] leading-relaxed text-[#3D3D3D]">{opportunity.mainText}</p>

      {opportunity.cta && (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-[#4091BB]">
          <Sparkles className="h-3.5 w-3.5" />
          {opportunity.cta}
        </p>
      )}

      {opportunity.narratorChip && (
        <div className="mt-3">
          <span className="inline-flex items-center gap-2.5 rounded-md border border-gray-200 bg-[#F0F0F0] px-3 py-1">
            <EntityAvatar name={opportunity.narratorChip.name} size={24} />
            <span className="text-[13px] text-[#3D3D3D]">
              <span className="font-semibold">{opportunity.narratorChip.name}:</span> {opportunity.narratorChip.text}
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * 2 · Sidebar opportunity card — the intent-page Radar rail. Identity +
 * clamped presenter text + one action; no narrator, no secondary action.
 */
export function OpportunitySidebarCard({
  opportunity,
  onPrimaryAction,
  onOpenProfile,
  className,
}: OpportunityCardProps) {
  const resolved = opportunity.status === 'accepted' || opportunity.status === 'rejected' || opportunity.status === 'expired';
  return (
    <div className={cn('rounded-lg border bg-white p-3', statusBorderClass(opportunity.status), className)}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpenProfile?.(opportunity)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus:outline-none focus:ring-2 focus:ring-[#4091BB]/30"
        >
          <EntityAvatar name={opportunity.name || 'Someone'} size={24} />
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-bold text-gray-900">{opportunity.name || 'Someone'}</span>
            <span className="block truncate text-[11px] text-gray-500">
              {opportunity.mutualIntentsLabel || 'Potential connection'}
            </span>
          </span>
        </button>
        {opportunity.status && opportunity.status !== 'pending' && (
          <Pill tone={statusTone(opportunity.status)} className="px-1.5 py-0 text-[10px] capitalize">
            {opportunity.status}
          </Pill>
        )}
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-[#3D3D3D] line-clamp-3">
        {opportunity.headline || opportunity.mainText}
      </p>
      <div className="mt-2.5">
        {resolved ? (
          <ResolvedStatus status={opportunity.status} />
        ) : (
          onPrimaryAction && (
            <button
              type="button"
              onClick={() => onPrimaryAction(opportunity)}
              className="inline-flex items-center gap-1.5 rounded-sm bg-[#041729] px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-[#0a2d4a]"
            >
              <MessageSquare className="h-3 w-3" />
              {opportunity.primaryActionLabel || 'Start Chat'}
            </button>
          )
        )}
      </div>
    </div>
  );
}

/**
 * 3 · In-chat opportunity chip — smallest variant. Avatar + name + clamped
 * headline + status hint; one click target.
 */
export function OpportunityChip({ opportunity, onOpenProfile, className }: OpportunityCardProps) {
  return (
    <ChipShell
      icon={<EntityAvatar name={opportunity.name || 'Someone'} size={16} />}
      title={opportunity.headline || opportunity.mainText}
      onClick={onOpenProfile ? () => onOpenProfile(opportunity) : undefined}
      className={className}
    >
      <span className="shrink-0 font-semibold text-gray-900">{opportunity.name || 'Someone'}</span>
      <ChipLabel className="max-w-[200px] font-normal text-gray-600">
        {opportunity.headline || opportunity.mainText}
      </ChipLabel>
      {(opportunity.status === 'accepted' || opportunity.status === 'rejected' || opportunity.status === 'expired') && (
        <ResolvedStatus status={opportunity.status} />
      )}
    </ChipShell>
  );
}
