/**
 * Premise variants — full-width card, sidebar card, in-chat chip.
 * Premises are the atomic beliefs/facts the protocol holds about a user; the
 * cards surface provenance (source, kind, confidence) alongside the text.
 */
import { FileText, Link as LinkIcon, MessageSquare, Quote, Slack } from 'lucide-react';

import { cn } from '@/lib/utils';
import { ChipLabel, ChipShell, MetaDate, Pill } from './shared';

/**
 * Premise shape consumed by the library. The base fields match the network
 * overview premise (`networks.ts`); provenance fields are optional extras.
 */
export interface LibraryPremise {
  id: string;
  text: string;
  summary?: string | null;
  createdAt: string;
  /** 'assertive' premises are durable; 'contextual' premises are volatile and expire. */
  kind?: 'assertive' | 'contextual';
  sourceType?: 'file' | 'link' | 'integration' | 'discovery_form' | 'enrichment';
  /** Provenance confidence 0–1, derived from analyzer felicity scores. */
  confidence?: number;
}

function premiseText(premise: LibraryPremise): string {
  return (premise.summary && premise.summary.trim().length > 0 ? premise.summary : premise.text).trim();
}

function SourcePill({ sourceType }: { sourceType?: LibraryPremise['sourceType'] }) {
  if (!sourceType) return null;
  const icon =
    sourceType === 'file' ? (
      <FileText className="h-3 w-3" />
    ) : sourceType === 'link' ? (
      <LinkIcon className="h-3 w-3" />
    ) : sourceType === 'integration' ? (
      <Slack className="h-3 w-3" />
    ) : (
      <MessageSquare className="h-3 w-3" />
    );
  return (
    <Pill tone="gray" className="capitalize">
      {icon}
      {sourceType.replace(/_/g, ' ')}
    </Pill>
  );
}

interface PremiseCardProps {
  premise: LibraryPremise;
  onOpen?: (premise: LibraryPremise) => void;
  className?: string;
}

/**
 * 1 · Full-width premise card — complete text plus all provenance: kind,
 * source, confidence, and creation date.
 */
export function PremiseCard({ premise, className }: PremiseCardProps) {
  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-4 sm:p-5', className)}>
      <div className="flex items-start gap-3">
        <Quote className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[15px] leading-relaxed text-gray-900">{premiseText(premise)}</p>
          {premise.summary && premise.summary.trim() !== premise.text.trim() && (
            <p className="mt-1.5 text-[13px] leading-relaxed text-gray-500 line-clamp-2">{premise.text}</p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {premise.kind && (
              <Pill tone={premise.kind === 'assertive' ? 'purple' : 'amber'} className="capitalize">
                {premise.kind}
              </Pill>
            )}
            <SourcePill sourceType={premise.sourceType} />
            {typeof premise.confidence === 'number' && (
              <span className="text-xs text-gray-500 font-ibm-plex-mono">
                {Math.round(premise.confidence * 100)}% confidence
              </span>
            )}
            <MetaDate dateStr={premise.createdAt} />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 2 · Sidebar premise card — clamped text with kind + source only.
 */
export function PremiseSidebarCard({ premise, onOpen, className }: PremiseCardProps) {
  return (
    <div
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen(premise) : undefined}
      onKeyDown={
        onOpen
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onOpen(premise);
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
      <p className="text-[13px] leading-relaxed text-gray-900 line-clamp-3">{premiseText(premise)}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        {premise.kind && (
          <Pill tone={premise.kind === 'assertive' ? 'purple' : 'amber'} className="px-1.5 py-0 text-[10px] capitalize">
            {premise.kind}
          </Pill>
        )}
        <MetaDate dateStr={premise.createdAt} className="text-[11px]" />
      </div>
    </div>
  );
}

/**
 * 3 · In-chat premise chip — smallest variant. Quote icon + truncated text;
 * one click target.
 */
export function PremiseChip({ premise, onOpen, className }: PremiseCardProps) {
  return (
    <ChipShell
      icon={<Quote className="h-3 w-3" />}
      title={premiseText(premise)}
      onClick={onOpen ? () => onOpen(premise) : undefined}
      className={className}
    >
      <ChipLabel className="max-w-[240px] font-normal italic text-gray-600">{premiseText(premise)}</ChipLabel>
    </ChipShell>
  );
}
