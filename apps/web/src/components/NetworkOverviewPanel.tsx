import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import IntentList from '@/components/IntentList';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useNetworkFilter } from '@/contexts/IndexFilterContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useNetworks } from '@/contexts/APIContext';
import { log } from '@/lib/logger';

const logger = log.ui.from('NetworkOverviewPanel');

interface NetworkOverviewPanelProps {
  index: Network;
  isOwner: boolean;
  onLeft?: () => void;
  onLeaveRequest?: boolean;
  onLeaveRequestHandled?: () => void;
}

export default function NetworkOverviewPanel({ index, onLeft, onLeaveRequest, onLeaveRequestHandled }: NetworkOverviewPanelProps) {
  const navigate = useNavigate();
  const { removeIndex } = useNetworksState();
  const { success, error } = useNotifications();
  const { clearChat, resolveIntentSession } = useAIChat();
  const { setSelectedNetworkIds } = useNetworkFilter();
  const api = useAuthenticatedAPI();
  const indexesService = useNetworks();

  const [showLeaveConfirmation, setShowLeaveConfirmation] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  useEffect(() => {
    if (onLeaveRequest) {
      setShowLeaveConfirmation(true);
      onLeaveRequestHandled?.();
    }
  }, [onLeaveRequest, onLeaveRequestHandled]);

  const [intents, setIntents] = useState<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [userContext, setUserContext] = useState<{ text: string; generatedAt: string } | null>(null);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const overview = await indexesService.getNetworkOverview(index.id);
        setIntents(overview.intents);
        setUserContext(overview.userContext);
      } catch (err) {
        logger.error('Error loading network overview', { error: err });
      } finally {
        setOverviewLoading(false);
      }
    };
    loadOverview();
  }, [index.id, indexesService]);

  const handleOpenIntentChat = useCallback(async (intent: { id: string; payload: string; summary?: string | null }) => {
    try {
      clearChat({ abortStream: false });
      setSelectedNetworkIds([]);
      const label = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
      const sessionId = await resolveIntentSession(
        { id: intent.id, label },
        'signal',
      );
      if (!sessionId) return;
      navigate(`/d/${sessionId}`);
    } catch {
      error('Failed to open signal chat');
    }
  }, [clearChat, setSelectedNetworkIds, resolveIntentSession, navigate, error]);

  const handleLeaveNetwork = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/networks/${index.id}/leave`, {});
      removeIndex(index.id);
      success(`Left ${index.title}`);
      setShowLeaveConfirmation(false);
      onLeft?.();
    } catch (err) {
      logger.error('Error leaving network', { error: err });
      error('Failed to leave network');
    } finally {
      setIsLeaving(false);
    }
  };

  return (
    <>
      <div className="space-y-8">
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
            Your Context
          </p>
          {overviewLoading ? (
            <div
              role="status"
              className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg"
            >
              Loading your network context…
            </div>
          ) : userContext && userContext.text.trim().length > 0 ? (
            <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{userContext.text}</p>
            </div>
          ) : (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              <p>Your context for this network is still being generated</p>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
              Your Signals
            </p>
            {!overviewLoading && (
              <span className="text-xs text-gray-400">{intents.length} signal{intents.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <IntentList
            intents={intents}
            isLoading={overviewLoading}
            emptyMessage="You haven't shared any signals in this network yet"
            onIntentClick={handleOpenIntentChat}
          />
        </div>
      </div>

      <AlertDialog.Root open={showLeaveConfirmation} onOpenChange={setShowLeaveConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Leave &apos;{index.title}&apos;?</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              You will lose access to this network. You can rejoin later if the network is public or if you receive a new invitation.
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild><Button variant="outline">Cancel</Button></AlertDialog.Cancel>
              <Button onClick={handleLeaveNetwork} disabled={isLeaving} className="bg-red-600 hover:bg-red-700 text-white">
                {isLeaving ? 'Leaving...' : 'Leave'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
