import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';
import { Plus, Users, Loader2, Calendar } from 'lucide-react';
import NetworkAvatar from '@/components/IndexAvatar';
import ClientLayout from '@/components/ClientLayout';
import CreateNetworkModal from '@/components/modals/CreateIndexModal';
import RequestNetworkModal from '@/components/modals/RequestNetworkModal';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import MasterKeyDialog from '@/components/MasterKeyDialog';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworks, useNetworkRequests } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { Network as NetworkType } from '@/lib/types';
import type { NetworkRequest, NetworkRequestInput } from '@/services/networkRequests';
import { log } from '@/lib/logger';

const logger = log.page.from('networks');

export default function NetworksPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { success, error } = useNotifications();
  const indexesService = useNetworks();
  const networkRequestsService = useNetworkRequests();
  const { indexes: rawIndexes, loading: indexesLoading, addIndex } = useNetworksState();

  // Staff capability is decided by the server (covers STAFF_EMAILS and mixed-case
  // addresses), not inferred from the email on the client.
  const [canReview, setCanReview] = useState(false);

  const [activeTab, setActiveTab] = useState<'my-networks' | 'discover'>('my-networks');
  const [createNetworkModalOpen, setCreateNetworkModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<NetworkRequest | null>(null);
  const [myRequests, setMyRequests] = useState<NetworkRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<NetworkRequest[]>([]);
  const [publicNetworks, setPublicNetworks] = useState<(NetworkType & { isMember?: boolean })[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [joiningNetwork, setJoiningNetwork] = useState<string | null>(null);
  const [masterKeyModal, setMasterKeyModal] = useState<{ networkId: string; masterKey: string } | null>(null);

  const loadRequests = useCallback(async () => {
    try {
      const mine = await networkRequestsService.listMine();
      setMyRequests(mine.requests);
      setCanReview(mine.canReview);
      setPendingRequests(mine.canReview ? await networkRequestsService.listPending() : []);
    } catch (err) {
      logger.error('Error loading network requests', { error: err });
    }
  }, [networkRequestsService]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  const handleRequestSubmit = useCallback(async (input: NetworkRequestInput): Promise<NetworkRequest> => {
    const request = editingRequest
      ? await networkRequestsService.update(editingRequest.id, input)
      : await networkRequestsService.create(input);
    await loadRequests();
    return request;
  }, [editingRequest, networkRequestsService, loadRequests]);

  const handleDismissRequest = useCallback(async (id: string) => {
    try {
      await networkRequestsService.dismiss(id);
      setMyRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      logger.error('Error dismissing request', { error: err });
      error('Failed to dismiss request');
    }
  }, [networkRequestsService, error]);

  const handleReview = useCallback(async (id: string, decision: 'approve' | 'needs_changes') => {
    try {
      let reviewNote: string | undefined;
      if (decision === 'needs_changes') {
        reviewNote = window.prompt('What context is missing? This is sent to the requester.') || undefined;
        if (!reviewNote) return;
      }
      await networkRequestsService.review(id, decision, reviewNote);
      success(decision === 'approve' ? 'Network approved' : 'Sent back for changes');
      await loadRequests();
    } catch (err) {
      logger.error('Error reviewing request', { error: err });
      error('Failed to review request');
    }
  }, [networkRequestsService, loadRequests, success, error]);

  const allNetworks = (rawIndexes || []).filter(Boolean).sort((a, b) => {
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
      logger.error('Error loading public networks', { error: err });
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
      logger.error('Error joining network', { error: err });
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
      logger.error('Error creating network', { error: err });
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
              <button
                onClick={() => {
                  if (canReview) {
                    setCreateNetworkModalOpen(true);
                  } else {
                    setEditingRequest(null);
                    setRequestModalOpen(true);
                  }
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 border border-gray-200 rounded-sm transition-colors"
              >
                <Plus className="w-4 h-4" />
                Create a network
              </button>
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
                {/* Staff review queue */}
                {canReview && pendingRequests.length > 0 && (
                  <div className="mb-8">
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Requests to review</p>
                    <div className="space-y-3">
                      {pendingRequests.map((r) => (
                        <div key={r.id} className="border border-gray-200 rounded-sm p-4">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-black">{r.title}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-sm ${r.status === 'needs_changes' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {r.status === 'needs_changes' ? 'Needs changes' : 'In review'}
                            </span>
                          </div>
                          {r.requestedBy && (
                            <p className="text-xs text-gray-400 mb-2">{r.requestedBy.name}{r.requestedBy.email ? ` · ${r.requestedBy.email}` : ''}</p>
                          )}
                          {r.purpose && <p className="text-sm text-gray-600 mb-2">{r.purpose}</p>}
                          {(r.audience || r.expectedSize) && (
                            <p className="text-xs text-gray-500 mb-2">
                              {[r.audience, r.expectedSize].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {r.notes && <p className="text-xs text-gray-500 mb-3">{r.notes}</p>}
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => handleReview(r.id, 'approve')} className="text-xs h-7">Approve</Button>
                            <Button size="sm" variant="outline" onClick={() => handleReview(r.id, 'needs_changes')} className="text-xs h-7">Needs changes</Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* The caller's own requests */}
                {myRequests.length > 0 && (
                  <div className="mb-8 space-y-3">
                    {myRequests.map((r) => (
                      <div key={r.id} className="border border-gray-200 rounded-sm p-4">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-black">{r.title}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-sm ${r.status === 'needs_changes' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                            {r.status === 'needs_changes' ? 'Needs changes' : 'In review'}
                          </span>
                        </div>
                        {r.status === 'needs_changes' && r.reviewNote ? (
                          <>
                            <p className="text-xs text-gray-500 mb-1">Index team</p>
                            <p className="text-sm text-gray-700 mb-3 italic">“{r.reviewNote}”</p>
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" onClick={() => handleDismissRequest(r.id)} className="text-xs h-7">Dismiss</Button>
                              <Button size="sm" onClick={() => { setEditingRequest(r); setRequestModalOpen(true); }} className="text-xs h-7">Update request</Button>
                            </div>
                          </>
                        ) : (
                          <p className="text-sm text-gray-500">We&apos;re reviewing your request and may reach out with questions.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

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
                          {network.type === 'event' && (
                            <span className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
                              <Calendar className="w-3 h-3" />
                              Event
                            </span>
                          )}
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
                        {network.type === 'event' && (
                          <span className="flex items-center gap-1 text-xs text-gray-500 flex-shrink-0">
                            <Calendar className="w-3 h-3" />
                            Event
                          </span>
                        )}
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

      <RequestNetworkModal
        open={requestModalOpen}
        onOpenChange={(open) => {
          setRequestModalOpen(open);
          if (!open) setEditingRequest(null);
        }}
        onSubmit={handleRequestSubmit}
        initial={editingRequest}
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
