import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LogOut } from 'lucide-react';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import IntentList from '@/components/IntentList';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useAIChat } from '@/contexts/AIChatContext';
import { useNetworkFilter } from '@/contexts/IndexFilterContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useNetworks } from '@/contexts/APIContext';

interface NetworkOverviewPanelProps {
  index: Network;
  isOwner: boolean;
  onLeft?: () => void;
  onLeaveRequest?: boolean;
  onLeaveRequestHandled?: () => void;
}

export default function NetworkOverviewPanel({ index, isOwner, onLeft, onLeaveRequest, onLeaveRequestHandled }: NetworkOverviewPanelProps) {
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
  
  // Intents state
  const [intents, setIntents] = useState<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(true);
  const [premises, setPremises] = useState<{ id: string; text: string; summary: string | null; createdAt: string }[]>([]);
  const [userContext, setUserContext] = useState<{ text: string; generatedAt: string } | null>(null);

  // Load the full network overview (intents, premises, user_context) when component mounts
  useEffect(() => {
    const loadOverview = async () => {
      try {
        const overview = await indexesService.getNetworkOverview(index.id);
        setIntents(overview.intents);
        setPremises(overview.premises);
        setUserContext(overview.userContext);
      } catch (err) {
        console.error('Error loading network overview:', err);
      } finally {
        setIntentsLoading(false);
      }
    };
    loadOverview();
  }, [index.id, indexesService]);

  const handleOpenIntentChat = useCallback(async (intent: { id: string; payload: string; summary?: string | null }) => {
    try {
      clearChat({ abortStream: false });
      setSelectedNetworkIds([]);
      const label = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
      const sessionId = await resolveIntentSession({ id: intent.id, label });
      navigate(`/d/${sessionId}`);
    } catch {
      error('Failed to open intent chat');
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
      console.error('Error leaving network:', err);
      error('Failed to leave network');
    } finally {
      setIsLeaving(false);
    }
  };

  const isPublic = index.permissions?.joinPolicy === 'anyone';

  return (
    <>
      <div className="space-y-8">

        {/* My Intents */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
              My Intents
            </p>
            {!intentsLoading && (
              <span className="text-xs text-gray-400">{intents.length} intent{intents.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <IntentList
            intents={intents}
            isLoading={intentsLoading}
            emptyMessage="You haven't shared any intents in this network yet"
            onIntentClick={handleOpenIntentChat}
          />
        </div>

        {/* My Premises */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
              My Premises
            </p>
            {!intentsLoading && (
              <span className="text-xs text-gray-400">{premises.length} premise{premises.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {intentsLoading ? null : premises.length === 0 ? (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              <p>No premises assigned to this network yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {premises.map((p) => (
                <div key={p.id} className="p-4 rounded-lg border border-gray-200 bg-white">
                  <p className="text-sm text-gray-900 leading-relaxed">
                    {(p.summary && p.summary.trim().length > 0 ? p.summary : p.text).trim()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Your Context */}
        {userContext && userContext.text.trim().length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
              Your Context
            </p>
            <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{userContext.text}</p>
            </div>
          </div>
        )}

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
