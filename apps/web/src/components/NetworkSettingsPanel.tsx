import { Network } from '@/lib/types';
import { useNetworks } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNotifications } from '@/contexts/NotificationContext';

import SettingsTab from '@/components/settings/SettingsTab';
import AccessTab from '@/components/settings/AccessTab';

interface NetworkSettingsPanelProps {
  network: Network;
  onDeleted?: () => void;
  activeTab: 'settings' | 'access';
}

export default function NetworkSettingsPanel({ network, onDeleted, activeTab }: NetworkSettingsPanelProps) {
  const networksService = useNetworks();
  const { networks, updateNetwork, removeNetwork } = useNetworksState();
  const { success, error, info } = useNotifications();

  const currentNetwork = networks?.find(n => n.id === network.id) || network;

  if (activeTab === 'settings') {
    return (
      <SettingsTab
        network={currentNetwork}
        networkId={network.id}
        updateNetwork={networksService.updateNetwork}
        uploadImage={networksService.uploadNetworkImage}
        onUpdated={updateNetwork}
        onDeleted={onDeleted}
        deleteNetwork={networksService.deleteNetwork}
        onRemoved={removeNetwork}
        success={success}
        error={error}
      />
    );
  }

  if (activeTab === 'access') {
    return (
      <AccessTab
        network={currentNetwork}
        networkId={network.id}
        networkService={networksService}
        onUpdated={updateNetwork}
        success={success}
        error={error}
        info={info}
      />
    );
  }

  return null;
}
