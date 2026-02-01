'use client';

import Image from 'next/image';
import { ArrowRight, Send, X } from 'lucide-react';
import { DiscoveredOpportunity } from '@/services/admin';
import { getAvatarUrl } from '@/lib/file-utils';

interface OpportunityCardProps {
  opportunity: DiscoveredOpportunity;
  onSendToSource?: () => void;
  onSendToBoth?: () => void;
  onDismiss?: () => void;
  isProcessing?: boolean;
}

export default function OpportunityCard({
  opportunity,
  onSendToSource,
  onSendToBoth,
  onDismiss,
  isProcessing = false
}: OpportunityCardProps) {
  const { sourceUser, targetUser, opportunity: opp } = opportunity;

  // Score color based on value
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-green-300 dark:border-green-700';
    if (score >= 80) return 'bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 border-yellow-300 dark:border-yellow-700';
    return 'bg-muted text-muted-foreground border-border';
  };

  // Type badge color
  const getTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      collaboration: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300',
      mentorship: 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300',
      networking: 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300',
      other: 'bg-muted text-muted-foreground'
    };
    return colors[type] || colors.other;
  };

  return (
    <div className="bg-card border border-b-2 border-foreground p-4">
      {/* Header: Source -> Target with Score */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Source User */}
          <div className="flex items-center gap-2">
            <Image
              src={getAvatarUrl(sourceUser)}
              alt={sourceUser.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-ibm-plex-mono text-sm font-medium text-foreground">
              {sourceUser.name}
            </span>
          </div>

          {/* Arrow */}
          <ArrowRight className="w-4 h-4 text-muted-foreground" />

          {/* Target User */}
          <div className="flex items-center gap-2">
            <Image
              src={getAvatarUrl(targetUser)}
              alt={targetUser.name}
              width={32}
              height={32}
              className="rounded-full"
            />
            <span className="font-ibm-plex-mono text-sm font-medium text-foreground">
              {targetUser.name}
            </span>
          </div>
        </div>

        {/* Score Badge */}
        <div className={`px-2 py-1 rounded border font-ibm-plex-mono text-xs font-bold ${getScoreColor(opp.score)}`}>
          {opp.score}
        </div>
      </div>

      {/* Type Badge */}
      <div className="mb-2">
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium capitalize ${getTypeBadge(opp.type)}`}>
          {opp.type}
        </span>
      </div>

      {/* Title */}
      <h3 className="font-ibm-plex-mono text-sm font-bold text-foreground mb-1">
        {opp.title}
      </h3>

      {/* Description */}
      <p className="font-ibm-plex-mono text-xs text-muted-foreground mb-4 line-clamp-2">
        {opp.description}
      </p>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {onSendToSource && (
          <button
            onClick={onSendToSource}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-ibm-plex-mono rounded hover:opacity-90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Send to {sourceUser.name.split(' ')[0]}
          </button>
        )}
        {onSendToBoth && (
          <button
            onClick={onSendToBoth}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 bg-muted text-foreground text-xs font-ibm-plex-mono rounded hover:bg-muted/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-3 h-3" />
            Send to both
          </button>
        )}
        {onDismiss && (
          <button
            onClick={onDismiss}
            disabled={isProcessing}
            className="flex items-center gap-1 px-3 py-1.5 text-muted-foreground text-xs font-ibm-plex-mono hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <X className="w-3 h-3" />
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
