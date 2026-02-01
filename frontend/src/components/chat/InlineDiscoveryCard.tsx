'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { MessageCircle, User } from 'lucide-react';
import { getAvatarUrl } from '@/lib/file-utils';
import type { DiscoveryOpportunity } from '@/contexts/AIChatContext';

interface InlineDiscoveryCardProps {
  discovery: DiscoveryOpportunity;
}

export default function InlineDiscoveryCard({ discovery }: InlineDiscoveryCardProps) {
  const router = useRouter();
  const avatarUrl = getAvatarUrl({
    id: discovery.candidateId,
    avatar: discovery.candidateAvatar || null,
    name: discovery.candidateName || 'User',
  });

  const handleViewProfile = () => {
    router.push(`/u/${discovery.candidateId}`);
  };

  const handleStartChat = () => {
    router.push(`/u/${discovery.candidateId}/chat`);
  };

  return (
    <div className="bg-card border border-border rounded-lg p-4 my-2">
      <div className="flex items-start gap-3">
        <button onClick={handleViewProfile} className="flex-shrink-0">
          <Image
            src={avatarUrl}
            alt={discovery.candidateName || 'User'}
            width={40}
            height={40}
            className="rounded-full"
          />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <button
              onClick={handleViewProfile}
              className="font-bold text-sm text-foreground font-ibm-plex-mono hover:text-muted-foreground truncate"
            >
              {discovery.candidateName || 'Potential Connection'}
            </button>
            <span className="text-xs text-muted-foreground font-ibm-plex-mono flex-shrink-0">
              {Math.round(discovery.score)}% match
            </span>
          </div>
          <p className="text-sm text-foreground/80 leading-relaxed">
            {discovery.sourceDescription}
          </p>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleViewProfile}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-foreground bg-muted hover:bg-muted/80 rounded transition-colors font-ibm-plex-mono"
            >
              <User className="w-3.5 h-3.5" />
              View Profile
            </button>
            <button
              onClick={handleStartChat}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-primary-foreground bg-primary hover:opacity-90 rounded transition-colors font-ibm-plex-mono"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Start Conversation
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
