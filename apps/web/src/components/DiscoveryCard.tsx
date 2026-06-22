import UserAvatar from '@/components/UserAvatar';
import ConnectionActions, { ConnectionAction } from '@/components/ConnectionActions';
import SynthesisMarkdown from '@/components/SynthesisMarkdown';

interface Intent {
  intent: {
    id: string;
    summary?: string | null;
    payload: string;
    updatedAt: string;
  };
  totalStake: string;
  agents: unknown[];
}

interface DiscoveryCardProps {
  user: {
    id: string;
    name: string;
    avatar: string | null;
  };
  intents: Intent[];
  synthesis?: string;
  synthesisLoading?: boolean;
  onUserClick?: () => void;
  onAction: (action: ConnectionAction, userId: string) => Promise<void>;
  onArchive?: () => void;
  connectionStatus?: 'none' | 'pending_sent' | 'pending_received' | 'connected' | 'declined' | 'skipped';
  popoverControlRef?: React.MutableRefObject<{ close: () => void } | null>;
}

export default function DiscoveryCard({
  user,
  intents,
  synthesis,
  synthesisLoading,
  onUserClick,
  onAction,
  onArchive,
  connectionStatus = 'none',
  popoverControlRef
}: DiscoveryCardProps) {
  return (
    <div>
      {/* User Header */}
      <div className="flex flex-wrap sm:flex-nowrap justify-between items-start mb-4">
        <div className="flex items-center gap-4 w-full sm:w-auto mb-2 sm:mb-0">
          <button
            onClick={onUserClick}
            className="flex-shrink-0 cursor-pointer transition-opacity hover:opacity-80"
          >
            <UserAvatar
              id={user.id}
              name={user.name}
              avatar={user.avatar}
              size={36}
            />
          </button>
          <div>
            <button
              onClick={onUserClick}
              className="cursor-pointer transition-opacity hover:opacity-80"
            >
              <h2 className="font-bold text-md text-gray-900 font-ibm-plex-mono text-left">
                {user.name}
              </h2>
            </button>
            <div className="flex items-center gap-4 text-sm text-gray-500 font-ibm-plex-mono">
              {intents.length > 0 ? (
                <span>{intents.length} mutual intent{intents.length !== 1 ? 's' : ''}</span>
              ) : (
                <span>Potential connection</span>
              )}
            </div>
          </div>
        </div>
        {/* Connection Actions */}
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <ConnectionActions
            userId={user.id}
            userName={user.name}
            userAvatar={user.avatar || undefined}
            connectionStatus={connectionStatus}
            onAction={onAction}
            size="sm"
            mutualIntents={intents}
            synthesis={synthesis}
          />
        </div>
      </div>

      {/* Synthesis Section */}
      {(synthesisLoading || synthesis) && (
        <div className="mb-4">
          {synthesisLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-11/12"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-10/12"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
              <div className="h-3 bg-gray-200 rounded w-9/12"></div>
              <div className="mt-3 pt-2">
                <div className="h-3 bg-gray-200 rounded w-3/4"></div>
              </div>
            </div>
          ) : (
            <SynthesisMarkdown
              content={synthesis!}
              className="text-gray-700 text-sm leading-relaxed prose prose-sm max-w-none [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:mb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:mb-2 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:mb-1 [&_p]:mb-2 [&_strong]:font-semibold [&_em]:italic [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_code]:text-sm synthesis-markdown-content"
              onArchive={onArchive}
              popoverControlRef={popoverControlRef}
            />
          )}
        </div>
      )}
    </div>
  );
}
