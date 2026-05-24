import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { Plus, Users, Loader2 } from 'lucide-react';
import NetworkAvatar from '@/components/IndexAvatar';
import ClientLayout from '@/components/ClientLayout';
import CreateNetworkModal from '@/components/modals/CreateIndexModal';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import MasterKeyDialog from '@/components/MasterKeyDialog';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworks } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { Network as NetworkType } from '@/lib/types';

export default function NetworksPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { success, error } = useNotifications();
  const indexesService = useNetworks();
  const { indexes: rawIndexes, loading: indexesLoading, addIndex } = useNetworksState();

  const [activeTab, setActiveTab] = useState<'my-networks' | 'discover'>('my-networks');
  const [createNetworkModalOpen, setCreateNetworkModalOpen] = useState(false);
  const [publicNetworks, setPublicNetworks] = useState<(NetworkType & { isMember?: boolean })[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [joiningNetwork, setJoiningNetwork] = useState<string | null>(null);
  const [masterKeyModal, setMasterKeyModal] = useState<{ networkId: string; masterKey: string } | null>(null);

  const allNetworks = [...(rawIndexes || [])].filter(Boolean).sort((a, b) => {
    if (a.isPersonal && !b.isPersonal) return -1;
    if (!a.isPersonal && b.isPersonal) return 1;
    return (a.title || '').localeCompare(b.title || '');
  });

  const loadPublicNetworks = async () => {
    try {
      setLoadingPublic(true);
      const response = await indexesService.discoverPublicIndexes(1, 50);
      setPublicNetworks(response.data);
    } catch (err) {
      console.error('Error loading public networks:', err);
    } finally {
      setLoadingPublic(false);
    }
  };

  const handleJoinNetwork = async (networkId: string) => {
    try {
      setJoiningNetwork(networkId);
      const result = await indexesService.joinIndex(networkId);
      if (result.alreadyMember) {
        success('You are already a member of this network');
      } else {
        addIndex(result.network);
        success('Joined network successfully');
      }
      await loadPublicNetworks();
    } catch (err) {
      console.error('Error joining network:', err);
      error('Failed to join network');
    } finally {
      setJoiningNetwork(null);
    }
  };

  const handleCreateIndex = useCallback(async (indexData: { name: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; isExperiment?: boolean; type?: 'community' | 'event'; metadata?: Record<string, unknown> }) => {
    try {
      const newIndex = await indexesService.createNetwork({
        title: indexData.name,
        prompt: indexData.prompt,
        imageUrl: indexData.imageUrl,
        joinPolicy: indexData.joinPolicy,
        isExperiment: indexData.isExperiment,
        type: indexData.type,
        metadata: indexData.metadata,
      });
      const { masterKey, ...network } = newIndex;
      addIndex(network);
      setCreateNetworkModalOpen(false);
      if (masterKey) {
        setMasterKeyModal({ networkId: network.id, masterKey });
      } else {
        navigate(`/networks/${network.id}`);
      }
      success('Network created successfully');
    } catch (err) {
      console.error('Error creating network:', err);
      error('Failed to create network');
    }
  }, [indexesService, addIndex, navigate, success, error]);

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>

            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">Networks</h1>
              {user?.email?.endsWith('@index.network') && (
                <button
                  onClick={() => setCreateNetworkModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-sm transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Create
                </button>
              )}
            </div>

            <Tabs.Root value={activeTab} onValueChange={(v) => {
              const tab = v as typeof activeTab;
              setActiveTab(tab);
              if (tab === 'discover') loadPublicNetworks();
            }}>
              <Tabs.List className="flex border-b border-gray-200 mb-8">
                <Tabs.Trigger
                  value="my-networks"
                  className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
                >
                  My Networks
                  {allNetworks.length > 0 && <span className="ml-2 text-xs text-gray-400">({allNetworks.length})</span>}
                </Tabs.Trigger>
                <Tabs.Trigger
                  value="discover"
                  className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold"
                >
                  Discover
                </Tabs.Trigger>
              </Tabs.List>

              {/* My Networks */}
              <Tabs.Content value="my-networks">
                {indexesLoading ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : allNetworks.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {allNetworks.map((network) => {
                      const isOwner = user?.id === network.user?.id;
                      return (
                        <button
                          key={network.id}
                          onClick={() => navigate(network.isPersonal ? '/mynetwork' : `/networks/${network.id}`)}
                          className={`w-full flex items-center gap-3 py-3 -mx-2 px-2 rounded-sm transition-colors text-left group ${
                            network.isPersonal ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                          }`}
                        >
                          <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                            <NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={40} rounded="full" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-black truncate">{network.title}</p>
                            <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {network._count?.members || 0} members
                            </p>
                          </div>
                          <span className={`text-xs px-1.5 py-0.5 rounded-sm font-medium flex-shrink-0 ml-3 ${
                            isOwner ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500'
                          }`}>
                            {isOwner ? 'Owner' : 'Member'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm font-medium text-gray-700 mb-1">No networks yet</p>
                    <p className="text-xs text-gray-400">Join one from the Discover tab</p>
                  </div>
                )}
              </Tabs.Content>

              {/* Discover */}
              <Tabs.Content value="discover">
                {loadingPublic ? (
                  <div className="flex justify-center py-16">
                    <Loader2 className="h-5 w-5 animate-spin text-gray-300" />
                  </div>
                ) : publicNetworks.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {publicNetworks.map((network) => (
                      <div key={network.id} className="flex items-center gap-3 py-3">
                        <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                          <NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={40} rounded="full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-black truncate">{network.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {network._count?.members ?? (network as { memberCount?: number }).memberCount ?? 0} members
                          </p>
                        </div>
                        {network.isMember ? (
                          <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-sm font-medium flex-shrink-0 ml-3">
                            Joined
                          </span>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleJoinNetwork(network.id)}
                            disabled={joiningNetwork === network.id}
                            className="text-xs h-7 flex-shrink-0 ml-3"
                          >
                            {joiningNetwork === network.id ? 'Joining...' : 'Join'}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center">
                    <p className="text-sm font-medium text-gray-700 mb-1">No public networks</p>
                    <p className="text-xs text-gray-400">Check back later</p>
                  </div>
                )}
              </Tabs.Content>
            </Tabs.Root>

        </ContentContainer>
      </div>

      <CreateNetworkModal
        open={createNetworkModalOpen}
        onOpenChange={setCreateNetworkModalOpen}
        onSubmit={handleCreateIndex}
        uploadIndexImage={indexesService.uploadIndexImage}
      />

      <MasterKeyDialog
        open={!!masterKeyModal}
        masterKey={masterKeyModal?.masterKey ?? ''}
        onClose={() => {
          const networkId = masterKeyModal?.networkId;
          setMasterKeyModal(null);
          if (networkId) navigate(`/networks/${networkId}`);
        }}
      />
    </ClientLayout>
  );
}

export const Component = NetworksPage;
