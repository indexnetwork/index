'use client';

import Image from 'next/image';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import SynthesisMarkdown from '@/components/SynthesisMarkdown';
import { getAvatarUrl } from '@/lib/file-utils';

interface ConnectionRequestCardProps {
  initiator: {
    id: string;
    name: string;
    avatar: string | null;
  };
  receiver: {
    id: string;
    name: string;
    avatar: string | null;
  };
  createdAt: string;
  synthesis?: string;
  synthesisLoading?: boolean;
  onApprove: () => void;
  onDeny: () => void;
  isProcessing?: boolean;
}

export default function ConnectionRequestCard({
  initiator,
  receiver,
  synthesis,
  synthesisLoading,
  onApprove,
  onDeny,
  isProcessing = false
}: ConnectionRequestCardProps) {
  return (
    <div className="p-0 mt-0 bg-white border border-b-2 border-gray-800 mb-4">
      <div className="py-4 px-2 sm:px-4">
        {/* User Header - Initiator → Receiver */}
        <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
          <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
            {/* Initiator */}
            <div className="flex items-center gap-3">
              <Image
                src={getAvatarUrl(initiator)}
                alt={initiator.name}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{initiator.name}</h2>
                <p className="text-sm text-gray-500 font-ibm-plex-mono">Requesting</p>
              </div>
            </div>

            {/* Arrow */}
            <ArrowRight className="w-6 h-6 text-gray-400 flex-shrink-0 mx-2" />

            {/* Receiver */}
            <div className="flex items-center gap-3">
              <Image
                src={getAvatarUrl(receiver)}
                alt={receiver.name}
                width={48}
                height={48}
                className="rounded-full"
              />
              <div>
                <h2 className="font-bold text-lg text-gray-900 font-ibm-plex-mono">{receiver.name}</h2>
                <p className="text-sm text-gray-500 font-ibm-plex-mono">To connect</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            <Button
              onClick={onApprove}
              disabled={isProcessing}
              className="bg-black hover:bg-gray-800 text-white font-ibm-plex-mono"
              size="sm"
            >
              {isProcessing ? 'Processing...' : 'Approve'}
            </Button>
            <Button
              onClick={onDeny}
              disabled={isProcessing}
              variant="outline"
              className="border-gray-300 text-black hover:bg-gray-50 font-ibm-plex-mono"
              size="sm"
            >
              {isProcessing ? 'Processing...' : 'Skip'}
            </Button>
          </div>
        </div>

        {/* Synthesis Section */}
        {(synthesisLoading || synthesis) && (
          <div className="mb-4">
            <h3 className="font-medium text-gray-700 mb-2 text-sm">What Could Happen Here</h3>
            {synthesisLoading ? (
              <div className="animate-pulse space-y-2">
                <div className="h-3 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-11/12"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-10/12"></div>
                <div className="h-3 bg-gray-200 rounded w-full"></div>
                <div className="h-3 bg-gray-200 rounded w-9/12"></div>
              </div>
            ) : (
              <SynthesisMarkdown 
                content={synthesis || ''}
                className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

