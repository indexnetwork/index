import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { Network } from '@/lib/types';
import { ConfirmWindow } from '@/components/workbench/Workbench';
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
            <p style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" }}>
              your signals
            </p>
            {!overviewLoading && (
              <span className="text-xs text-gray-400">{intents.length} signal{intents.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          <IntentList
            intents={intents}
            isLoading={overviewLoading}
            emptyMessage="you haven't shared any signals in this network yet"
            onIntentClick={handleOpenIntent}
          />
        </div>
      </div>

      {showLeaveConfirmation && (
        <ConfirmWindow
          title="leave"
          body={`leave ${network.title}? you can rejoin later if the network is public or you are invited again.`}
          confirmLabel={isLeaving ? "leaving" : "leave"}
          busy={isLeaving}
          onCancel={() => { if (!isLeaving) setLeaveConfirmation(false); }}
          onConfirm={() => void handleLeaveNetwork()}
        />
      )}
    </>
  );
}
