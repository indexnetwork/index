import { Network } from '@/lib/types';
import { useNetworks } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNotifications } from '@/contexts/NotificationContext';

import SettingsTab from '@/components/settings/SettingsTab';
import AccessTab from '@/components/settings/AccessTab';
import IntegrationsTab from '@/components/settings/IntegrationsTab';

interface NetworkSettingsPanelProps {
  index: Network;
  onDeleted?: () => void;
  activeTab: 'settings' | 'access' | 'integrations';
}

export default function NetworkSettingsPanel({ index, onDeleted, activeTab }: NetworkSettingsPanelProps) {
  const indexesService = useNetworks();
  const { indexes, updateIndex, removeIndex } = useNetworksState();
  const { success, error, info } = useNotifications();

  const currentIndex = indexes?.find(idx => idx.id === index.id) || index;

  if (activeTab === 'settings') {
    return (
      <SettingsTab
        network={currentIndex}
        networkId={index.id}
        updateNetwork={indexesService.updateNetwork}
        uploadImage={indexesService.uploadIndexImage}
        onUpdated={updateIndex}
        onDeleted={onDeleted}
        deleteNetwork={indexesService.deleteNetwork}
        onRemoved={removeIndex}
        success={success}
        error={error}
      />
    );
  }

  if (activeTab === 'access') {
    return (
      <AccessTab
        network={currentIndex}
        networkId={index.id}
        networkService={indexesService}
        onUpdated={updateIndex}
        success={success}
        error={error}
        info={info}
      />
    );
  }

  if (activeTab === 'integrations') {
    return (
      <IntegrationsTab
        network={currentIndex}
        networkId={index.id}
        success={success}
        error={error}
        info={info}
      />
    );
  }

  return null;
}
