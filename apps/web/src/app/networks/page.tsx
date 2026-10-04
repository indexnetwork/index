import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { resolveNetworkImageSrc } from '@/lib/network-image';
import { Stage, Window } from '@/components/workbench/Workbench';
import CreateNetworkModal from '@/components/modals/CreateNetworkModal';
import RequestNetworkModal from '@/components/modals/RequestNetworkModal';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { useNetworks, useNetworkRequests } from '@/contexts/APIContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { Network as NetworkType } from '@/lib/types';
import type { NetworkRequest, NetworkRequestInput } from '@/services/networkRequests';
import { log } from '@/lib/logger';
import { EmptyState } from "@/components/ui/EmptyState";

const logger = log.page.from('networks');

const TILE = ["#FF8A00", "#0055AA", "#C64B8C", "#3E8E7E", "#E8C547", "#7B5EA7"];

function NetworkTile({ id, name, photo }: { id?: string; name?: string; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const size = 36;
  if (photo && !broken) {
    return (
      <img
        src={resolveNetworkImageSrc(photo)}
        alt=""
        onError={() => setBroken(true)}
        style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", border: "1px solid #000", filter: "grayscale(1) contrast(1.05)" }}
      />
    );
  }
  const seed = String(name || id || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = [0, 1, 2, 3].map((i) => TILE[(h >>> (i * 3)) % TILE.length]);
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, border: "1px solid #000", display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "1fr 1fr" }}>
      {cells.map((color, i) => <span key={i} style={{ background: color }} />)}
    </span>
  );
}

export default function NetworksPage() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { success, error } = useNotifications();
  const networksService = useNetworks();
  const networkRequestsService = useNetworkRequests();
  const { networks: rawNetworks, loading: networksLoading, error: networksError, refreshNetworks, addNetwork } = useNetworksState();

  // Staff capability is decided by the server (covers STAFF_EMAILS and mixed-case
  // addresses), not inferred from the email on the client.
  const [canReview, setCanReview] = useState(false);

  const [activeTab, setActiveTab] = useState<'mine' | 'discover'>('mine');
  const [createNetworkModalOpen, setCreateNetworkModalOpen] = useState(false);
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<NetworkRequest | null>(null);
  const [myRequests, setMyRequests] = useState<NetworkRequest[]>([]);
  const [pendingRequests, setPendingRequests] = useState<NetworkRequest[]>([]);
  const [publicNetworks, setPublicNetworks] = useState<(NetworkType & { isMember?: boolean })[]>([]);
  const [loadingPublic, setLoadingPublic] = useState(false);
  const [publicError, setPublicError] = useState(false);
  const [joiningNetwork, setJoiningNetwork] = useState<string | null>(null);

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

  const allNetworks = (rawNetworks || []).filter(Boolean).sort((a, b) =>
    (a.title || '').localeCompare(b.title || ''),
  );

  const loadPublicNetworks = async () => {
    try {
      setLoadingPublic(true);
      setPublicError(false);
      const response = await networksService.discoverPublicNetworks(1, 50);
      setPublicNetworks(response.data);
    } catch (err) {
      logger.error('Error loading public networks', { error: err });
      setPublicError(true);
    } finally {
      setLoadingPublic(false);
    }
  };

  const handleJoinNetwork = async (networkId: string) => {
    try {
      setJoiningNetwork(networkId);
      const result = await networksService.joinNetwork(networkId);
      if (result.alreadyMember) {
        success('You are already a member of this network');
      } else {
        addNetwork(result.network);
        success('joined network');
      }
      await loadPublicNetworks();
    } catch (err) {
      logger.error('Error joining network', { error: err });
      error('Failed to join network');
    } finally {
      setJoiningNetwork(null);
    }
  };

  const handleCreateNetwork = useCallback(async (networkData: { name: string; prompt?: string; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only' }) => {
    try {
      const newNetwork = await networksService.createNetwork({
        title: networkData.name,
        prompt: networkData.prompt,
        imageUrl: networkData.imageUrl,
        joinPolicy: networkData.joinPolicy,
      });
      addNetwork(newNetwork);
      setCreateNetworkModalOpen(false);
      navigate(`/networks/${newNetwork.id}/contacts`);
      success(`${networkData.name} is live. send the link to let people in.`);
    } catch (err) {
      logger.error('Error creating network', { error: err });
      error('Failed to create network');
    }
  }, [networksService, addNetwork, navigate, success, error]);

  const openCreate = () => {
    if (canReview) {
      setCreateNetworkModalOpen(true);
    } else {
      setEditingRequest(null);
      setRequestModalOpen(true);
    }
  };
  const openDiscover = () => { setActiveTab('discover'); void loadPublicNetworks(); };

  return (
    <>
      <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title="networks" onClose={() => navigate('/')} style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 24px' }}>
        <div className="wb-segmented lg" role="tablist">
          <button type="button" role="tab" aria-pressed={activeTab === 'mine'} onClick={() => setActiveTab('mine')}>my networks ({allNetworks.length})</button>
          <button type="button" role="tab" aria-pressed={activeTab === 'discover'} onClick={openDiscover}>discover</button>
        </div>
        <button
          type="button"
          className="wb-btn small"
          title={canReview ? 'start a new network' : 'request a new network'}
          onClick={openCreate}
        >
          + create
        </button>
      </div>
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 14px' }}>

              {activeTab === 'mine' && (
                <>
                {/* Staff review queue */}
                {canReview && pendingRequests.length > 0 && (
                  <div className="mb-8">
                    <p style={{ fontFamily: "var(--mac-mono)", fontSize: 11, marginBottom: 8 }}>requests to review</p>
                    <div className="space-y-3">
                      {pendingRequests.map((r) => (
                        <div key={r.id} style={{ border: "1px solid #000", padding: 14, background: "#fff" }}>
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-sm font-medium text-black">{r.title}</p>
                            <span className={`text-xs px-1.5 py-0.5 rounded-sm ${r.status === 'needs_changes' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                              {r.status === 'needs_changes' ? 'needs changes' : 'in review'}
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
                            <button type="button" className="wb-btn small" onClick={() => handleReview(r.id, 'approve')}>approve</button>
                            <button type="button" className="wb-btn small" onClick={() => handleReview(r.id, 'needs_changes')}>needs changes</button>
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
                      <div key={r.id} style={{ border: "1px solid #000", padding: 14, background: "#fff" }}>
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-sm font-medium text-black">{r.title}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-sm ${r.status === 'needs_changes' ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                            {r.status === 'needs_changes' ? 'needs changes' : 'in review'}
                          </span>
                        </div>
                        {r.status === 'needs_changes' && r.reviewNote ? (
                          <>
                            <p className="text-xs text-gray-500 mb-1">Index team</p>
                            <p className="text-sm text-gray-700 mb-3 italic">“{r.reviewNote}”</p>
                            <div className="flex gap-2">
                              <button type="button" className="wb-btn small" onClick={() => handleDismissRequest(r.id)}>dismiss</button>
                              <button type="button" className="wb-btn small" onClick={() => { setEditingRequest(r); setRequestModalOpen(true); }}>update</button>
                            </div>
                          </>
                        ) : (
                          <p style={{ fontFamily: "var(--mac-sans)", fontSize: 13 }}>your request is in review.</p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {networksLoading ? (
                  <EmptyState tone="loading" style={{ padding: "48px 12px" }} />
                ) : networksError && allNetworks.length === 0 ? (
                  <EmptyState
                    tone="error"
                    style={{ padding: "48px 12px" }}
                    message="couldn't load your networks."
                    action={{ label: "try again", onClick: () => void refreshNetworks() }}
                  />
                ) : allNetworks.length > 0 ? (
                  <div className="divide-y divide-gray-100">
                    {allNetworks.map((network) => {
                      // Prefer viewer membership `role` from GET /networks; the
                      // network.user.id compare is wrong for multi-owner nets.
                      const viewerRole = (network as { role?: 'owner' | 'member' }).role;
                      const isOwner = viewerRole === 'owner'
                        || (viewerRole !== 'member' && user?.id === network.user?.id);
                      const pendingJoinCount = (network as { pendingJoinCount?: number }).pendingJoinCount ?? 0;
                      return (
                        <div key={network.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #DDD8CC" }}>
                          <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
                          <button type="button" onClick={() => navigate(`/networks/${network.id}`)} style={{ flex: 1, minWidth: 0, textAlign: "left", padding: 0, border: "none", background: "transparent", cursor: "pointer" }}>
                            <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, color: "#000" }}>{network.title}</span>
                            <span style={{ display: "block", marginTop: 2, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>{network._count?.members || 0} members</span>
                          </button>
                          {pendingJoinCount > 0 && <span className="wb-count">{pendingJoinCount}</span>}
                          <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontFamily: "var(--mac-mono)", fontSize: 13 }}>{isOwner ? "owner" : "member"}</span>
                        </div>
                      );
                    })}
                  </div>
                ) : myRequests.length > 0 ? (
                  // The request card above already says it's in review; this only says where the network lands.
                  <EmptyState
                    style={{ padding: "32px 12px" }}
                    message="no networks yet. yours shows up here once it's approved."
                    action={{ label: "discover networks", onClick: openDiscover }}
                  />
                ) : (
                  <EmptyState
                    style={{ padding: "64px 12px" }}
                    message="you're not in any networks yet."
                    action={[
                      { label: "create a network", onClick: openCreate, primary: true },
                      { label: "discover networks", onClick: openDiscover },
                    ]}
                  />
                )}
                </>
              )}

              {activeTab === 'discover' && (
                <>
                {loadingPublic && publicNetworks.length === 0 ? (
                  <EmptyState tone="loading" style={{ padding: "48px 12px" }} message="loading public networks…" />
                ) : publicError && publicNetworks.length === 0 ? (
                  <EmptyState
                    tone="error"
                    style={{ padding: "48px 12px" }}
                    message="couldn't load public networks."
                    action={{ label: "try again", onClick: () => void loadPublicNetworks() }}
                  />
                ) : publicNetworks.length > 0 ? (
                  <div>
                    {publicNetworks.map((network) => (
                      <div key={network.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #DDD8CC" }}>
                        <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, color: "#000" }}>{network.title}</span>
                          <span style={{ display: "block", marginTop: 2, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>{network._count?.members ?? (network as { memberCount?: number }).memberCount ?? 0} members</span>
                        </span>
                        {network.isMember ? (
                          <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontFamily: "var(--mac-mono)", fontSize: 13 }}>member</span>
                        ) : (
                          <button
                            type="button"
                            className="wb-btn small"
                            onClick={() => handleJoinNetwork(network.id)}
                            disabled={joiningNetwork === network.id}
                          >
                            {joiningNetwork === network.id ? 'joining…' : 'join'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState style={{ padding: "64px 12px" }} message="no public networks to discover right now." />
                )}
                </>
              )}

      </div>
      </Window>
      </Stage>

      <CreateNetworkModal
        open={createNetworkModalOpen}
        onOpenChange={setCreateNetworkModalOpen}
        onSubmit={handleCreateNetwork}
        uploadNetworkImage={networksService.uploadNetworkImage}
      />

      {/* Keyed so each open remounts the form with fresh state seeded from
          `initial`, instead of the modal resetting itself in an effect. */}
      <RequestNetworkModal
        key={requestModalOpen ? (editingRequest?.id ?? 'new') : 'closed'}
        open={requestModalOpen}
        onOpenChange={(open) => {
          setRequestModalOpen(open);
          if (!open) setEditingRequest(null);
        }}
        onSubmit={handleRequestSubmit}
        initial={editingRequest}
      />
    </>
  );
}

export const Component = NetworksPage;
