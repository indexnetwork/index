import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import IntentList from '@/components/IntentList';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworkFilter } from '@/contexts/NetworkFilterContext';
import { useAuthenticatedAPI } from '@/lib/api';
import { useNetworks } from '@/contexts/APIContext';
import { log } from '@/lib/logger';

const logger = log.ui.from('NetworkOverviewPanel');

interface NetworkOverviewPanelProps {
  network: Network;
  isOwner: boolean;
  onLeft?: () => void;
  onLeaveRequest?: boolean;
  onLeaveRequestHandled?: () => void;
}

export default function NetworkOverviewPanel({ network, onLeft, onLeaveRequest, onLeaveRequestHandled }: NetworkOverviewPanelProps) {
  const navigate = useNavigate();
  const { removeNetwork } = useNetworksState();
  const { success, error } = useNotifications();
  const { setSelectedNetworkIds } = useNetworkFilter();
  const api = useAuthenticatedAPI();
  const networksService = useNetworks();

  // The parent can also ask for the dialog via `onLeaveRequest`; both sources
  // are combined during render rather than mirrored into state by an effect.
  const [leaveConfirmationOpen, setLeaveConfirmationOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const showLeaveConfirmation = leaveConfirmationOpen || !!onLeaveRequest;

  const setLeaveConfirmation = (open: boolean) => {
    setLeaveConfirmationOpen(open);
    if (!open) onLeaveRequestHandled?.();
  };

  const [intents, setIntents] = useState<{
    id: string;
    payload: string;
    summary?: string | null;
    createdAt: string;
    userId: string;
    userName: string;
  }[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);

  useEffect(() => {
    const loadOverview = async () => {
      try {
        const overview = await networksService.getNetworkOverview(network.id);
        setIntents(overview.intents);
      } catch (err) {
        logger.error('Error loading network overview', { error: err });
      } finally {
        setOverviewLoading(false);
      }
    };
    loadOverview();
  }, [network.id, networksService]);

  const handleOpenIntent = useCallback((intent: { id: string }) => {
    setSelectedNetworkIds([]);
    navigate(`/i/${intent.id}`);
  }, [setSelectedNetworkIds, navigate]);

  const handleLeaveNetwork = async () => {
    try {
      setIsLeaving(true);
      await api.post(`/networks/${network.id}/leave`, {});
      removeNetwork(network.id);
      success(`Left ${network.title}`);
      setLeaveConfirmation(false);
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
            onIntentClick={handleOpenIntent}
          />
        </div>
      </div>

      <AlertDialog.Root open={showLeaveConfirmation} onOpenChange={setLeaveConfirmation}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Leave &apos;{network.title}&apos;?</AlertDialog.Title>
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
