import { useState, useEffect } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { LogOut } from 'lucide-react';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import IntentList from '@/components/IntentList';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';
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
  const { removeIndex } = useNetworksState();
  const { success, error } = useNotifications();
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
  const [intents, setIntents] = useState<Record<string, unknown>[]>([]);
  const [intentsLoading, setIntentsLoading] = useState(true);

  // Load intents when component mounts
  useEffect(() => {
    const loadIntents = async () => {
      try {
        const myIntents = await indexesService.getMyIndexIntents(index.id);
        setIntents(myIntents);
      } catch (err) {
        console.error('Error loading intents:', err);
      } finally {
        setIntentsLoading(false);
      }
    };
    loadIntents();
  }, [index.id, indexesService]);

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
