import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHead from "@/components/intents-home/PageHead";
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
import { useCompact } from "@/hooks/useCompact";
import { useBack } from "@/hooks/useBack";
import { useInAppFrame } from "@/components/intents-home/appFrameContext";
import { useContentTranslation } from "@/lib/content-translation";
import TranslatedMark from "@/components/TranslatedMark";
import "@/styles/plain.css";

const logger = log.page.from('networks');

function NetworkTile({ id, name, photo }: { id?: string; name?: string; photo?: string | null }) {
  const [broken, setBroken] = useState(false);
  const size = 28;
  if (photo && !broken) {
    return (
      <img
        src={resolveNetworkImageSrc(photo)}
        alt=""
        onError={() => setBroken(true)}
        style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", borderRadius: 3 }}
      />
    );
  }
  const initial = String(name || id || "").trim().charAt(0).toUpperCase();
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, borderRadius: 3, background: "#ededea", color: "#555", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 500 }}>
      {initial}
    </span>
  );
}

/** A network's picture, or its first letter on one of Home's colors. */
function PlainMark({ id, name, photo, index }: { id?: string; name?: string; photo?: string | null; index: number }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return <img className="pl-net-mark img" src={resolveNetworkImageSrc(photo)} alt="" onError={() => setBroken(true)} />;
  }
  return <span className={`pl-net-mark c${index % 4}`} aria-hidden>{String(name || id || "#").trim().charAt(0).toUpperCase()}</span>;
}

/** Text another person wrote (a requester's purpose, the Index team's note), in the viewer's language. */
function OthersText({ text, quoted = false }: { text: string; quoted?: boolean }) {
  const shown = useContentTranslation(text);
  return (
    <>
      {quoted ? <>&ldquo;{shown.text}&rdquo;</> : shown.text}
      <TranslatedMark state={shown} className="block" />
    </>
  );
}

export default function NetworksPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const compact = useCompact();
  const plain = useInAppFrame();
  const back = useBack("/");
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
      error(t('Failed to dismiss request'));
    }
  }, [networkRequestsService, error, t]);

  const handleReview = useCallback(async (id: string, decision: 'approve' | 'needs_changes' | 'skip') => {
    try {
      let reviewNote: string | undefined;
      if (decision === 'needs_changes') {
        reviewNote = window.prompt(t('What context is missing? This is sent to the requester.')) || undefined;
        if (!reviewNote) return;
      }
      await networkRequestsService.review(id, decision, reviewNote);
      success(decision === 'approve' ? t('Network approved') : decision === 'skip' ? t('Skipped') : t('Sent back for changes'));
      await loadRequests();
    } catch (err) {
      logger.error('Error reviewing request', { error: err });
      error(t('Failed to review request'));
    }
  }, [networkRequestsService, loadRequests, success, error, t]);

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
        success(t('You are already a member of this network'));
      } else {
        addNetwork(result.network);
        success(t('joined network'));
      }
      await loadPublicNetworks();
    } catch (err) {
      logger.error('Error joining network', { error: err });
      error(t('Failed to join network'));
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
      success(t('{{name}} is live. send the link to let people in.', { name: networkData.name }));
    } catch (err) {
      logger.error('Error creating network', { error: err });
      error(t('Failed to create network'));
    }
  }, [networksService, addNetwork, navigate, success, error, t]);

  const openCreate = () => {
    if (canReview) {
      setCreateNetworkModalOpen(true);
    } else {
      setEditingRequest(null);
      setRequestModalOpen(true);
    }
  };
  const openDiscover = () => { setActiveTab('discover'); void loadPublicNetworks(); };

  const modals = (
    <>
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

  // Signed in on desktop: the plain page, like Home, Intents and profiles.
  if (plain) {
    const requestStatus = (r: NetworkRequest) => (r.status === 'needs_changes' ? t('needs changes') : t('in review'));
    return (
      <div className="ih-view pl">
        <div className="pl-col">
        {/* A title line like Home's and the intents page, with the way to start another. */}
        <PageHead title={t("networks")} centered>
          <button type="button" className="go" title={canReview ? t('start a new network') : t('request a new network')} onClick={openCreate}>{t('+ new network')}</button>
        </PageHead>
        <div className="pl-page pl-netlist">
          <div className="pl-tabbar">
            <div className="pl-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={activeTab === 'mine'} className={activeTab === 'mine' ? 'on' : undefined} onClick={() => setActiveTab('mine')}>{t('my networks ({{count}})', { count: allNetworks.length })}</button>
              <button type="button" role="tab" aria-selected={activeTab === 'discover'} className={activeTab === 'discover' ? 'on' : undefined} onClick={openDiscover}>{t('discover')}</button>
            </div>
          </div>

          {activeTab === 'mine' && (
            <>
              {canReview && pendingRequests.length > 0 && (
                <>
                  <h2>{t('requests to review ({{count}})', { count: pendingRequests.length })}</h2>
                  <ul className="pl-cards">
                    {pendingRequests.map((r) => (
                      <li key={r.id} className="pl-card">
                        <div className="pl-card-body">
                          <div className="pl-card-head">
                            <b>{r.title}</b>
                            <span className={`pl-status ${r.status === 'needs_changes' ? 'waiting' : 'talks'}`}>{requestStatus(r)}</span>
                          </div>
                          {r.requestedBy && <div className="pl-dim">{r.requestedBy.name}{r.requestedBy.email ? ` · ${r.requestedBy.email}` : ''}</div>}
                          {r.purpose && <div className="pl-blurb"><OthersText text={r.purpose} /></div>}
                          {(r.audience || r.expectedSize) && <div className="pl-dim">{[r.audience, r.expectedSize].filter(Boolean).join(' · ')}</div>}
                          {r.notes && <div className="pl-dim">{r.notes}</div>}
                          <div className="pl-actions">
                            <button type="button" className="go" onClick={() => handleReview(r.id, 'approve')}>{t('approve')}</button>
                            <button type="button" onClick={() => handleReview(r.id, 'needs_changes')}>{t('needs changes')}</button>
                            <button type="button" onClick={() => handleReview(r.id, 'skip')}>{t('skip')}</button>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {myRequests.length > 0 && (
                <>
                  <h2>{t('your requests')}</h2>
                  <ul className="pl-cards">
                    {myRequests.map((r) => (
                      <li key={r.id} className={r.status === 'needs_changes' ? 'pl-card' : 'pl-card talks'}>
                        <div className="pl-card-body">
                          <div className="pl-card-head">
                            <b>{r.title}</b>
                            <span className={`pl-status ${r.status === 'needs_changes' ? 'waiting' : 'talks'}`}>{requestStatus(r)}</span>
                          </div>
                          {r.status === 'needs_changes' && r.reviewNote ? (
                            <>
                              <div className="pl-blurb">{t('the index team says:')} <OthersText text={r.reviewNote} quoted /></div>
                              <div className="pl-actions">
                                <button type="button" className="go" onClick={() => { setEditingRequest(r); setRequestModalOpen(true); }}>{t('update')}</button>
                                <button type="button" onClick={() => handleDismissRequest(r.id)}>{t('dismiss')}</button>
                              </div>
                            </>
                          ) : (
                            <div className="pl-blurb">{t('your request is in review.')}</div>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {networksLoading ? (
                <p className="pl-dim">{t('loading')}<span className="pl-blink">_</span></p>
              ) : networksError && allNetworks.length === 0 ? (
                <div className="pl-profile-empty">
                  <p>{t("couldn't load your networks.")}</p>
                  <button type="button" onClick={() => void refreshNetworks()}>{t('try again')}</button>
                </div>
              ) : allNetworks.length > 0 ? (
                <ul className="pl-nets big">
                  {allNetworks.map((network, index) => {
                    const viewerRole = (network as { role?: 'owner' | 'member' }).role;
                    const isOwner = viewerRole === 'owner' || (viewerRole !== 'member' && user?.id === network.user?.id);
                    const pendingJoinCount = (network as { pendingJoinCount?: number }).pendingJoinCount ?? 0;
                    return (
                      <li key={network.id}>
                        <a href={`/networks/${network.id}`} className="pl-net" onClick={(event) => { event.preventDefault(); navigate(`/networks/${network.id}`); }}>
                          <PlainMark id={network.id} name={network.title} photo={network.imageUrl} index={index} />
                          <span className="pl-net-text">
                            <span className="pl-net-name" title={network.title}>{network.title}</span>
                            <span className="pl-net-n">{t('{{count}} people', { count: network._count?.members || 0 })} · {isOwner ? t('owner') : t('member')}</span>
                          </span>
                          {pendingJoinCount > 0 && <span className="ih-badge" title={t('{{count}} waiting to join', { count: pendingJoinCount })}>{pendingJoinCount}</span>}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="pl-profile-empty">
                  <p>{myRequests.length > 0 ? t("no networks yet. yours shows up here once it's approved.") : t("you're not in any networks yet.")}</p>
                  <div className="pl-actions">
                    {myRequests.length === 0 && <button type="button" className="go" onClick={openCreate}>{t('+ new network')}</button>}
                    <button type="button" onClick={openDiscover}>{t('discover networks')}</button>
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === 'discover' && (
            <>
              {loadingPublic && publicNetworks.length === 0 ? (
                <p className="pl-dim">{t('loading')}<span className="pl-blink">_</span></p>
              ) : publicError && publicNetworks.length === 0 ? (
                <div className="pl-profile-empty">
                  <p>{t("couldn't load public networks.")}</p>
                  <button type="button" onClick={() => void loadPublicNetworks()}>{t('try again')}</button>
                </div>
              ) : publicNetworks.length > 0 ? (
                <ul className="pl-nets big">
                  {publicNetworks.map((network, index) => (
                    <li key={network.id}>
                      <div className="pl-net">
                        <PlainMark id={network.id} name={network.title} photo={network.imageUrl} index={index} />
                        <span className="pl-net-text">
                          <span className="pl-net-name" title={network.title}>{network.title}</span>
                          <span className="pl-net-n">{t('{{count}} people', { count: network._count?.members ?? (network as { memberCount?: number }).memberCount ?? 0 })}</span>
                        </span>
                        {network.isMember ? (
                          <span className="pl-net-n">{t('member')}</span>
                        ) : (
                          <button type="button" className="go" onClick={() => handleJoinNetwork(network.id)} disabled={joiningNetwork === network.id}>
                            {joiningNetwork === network.id ? t('joining…') : t('join')}
                          </button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="pl-dim">{t('no public networks to discover right now.')}</p>
              )}
            </>
          )}
        </div>
        </div>
        {modals}
      </div>
    );
  }

  return (
    <>
      <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title={t("networks")} onClose={compact ? back : () => navigate('/')} style={{ height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: compact ? '12px 12px' : '14px 24px' }}>
        <div className={compact ? "wb-segmented" : "wb-segmented lg"} role="tablist">
          <button type="button" role="tab" aria-pressed={activeTab === 'mine'} onClick={() => setActiveTab('mine')}>{t('my networks ({{count}})', { count: allNetworks.length })}</button>
          <button type="button" role="tab" aria-pressed={activeTab === 'discover'} onClick={openDiscover}>{t('discover')}</button>
        </div>
        <button
          type="button"
          className="wb-btn small"
          title={canReview ? t('start a new network') : t('request a new network')}
          onClick={openCreate}
        >
          {t('+ create')}
        </button>
      </div>
      <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 12px 14px' }}>

              {activeTab === 'mine' && (
                <>
                {/* Staff review queue */}
                {canReview && pendingRequests.length > 0 && (
                  <div className="mb-8">
                    <p style={{ fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", color: "#555", marginBottom: 8 }}>{t('requests to review')}</p>
                    <div className="space-y-3">
                      {pendingRequests.map((r) => (
                        <div key={r.id} style={{ border: "1px solid #e3e3e0", borderRadius: 3, padding: 14, background: "#fff" }}>
                          <div className="flex items-center justify-between mb-1">
                            <p style={{ fontSize: 13, fontWeight: 500, color: "#141414" }}>{r.title}</p>
                            <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 2, background: "#f0f0ed", color: r.status === 'needs_changes' ? "#141414" : "#666" }}>
                              {r.status === 'needs_changes' ? t('needs changes') : t('in review')}
                            </span>
                          </div>
                          {r.requestedBy && (
                            <p className="mb-2" style={{ fontSize: 12, color: "#777" }}>{r.requestedBy.name}{r.requestedBy.email ? ` · ${r.requestedBy.email}` : ''}</p>
                          )}
                          {r.purpose && <p className="mb-2" style={{ fontSize: 13, color: "#555" }}><OthersText text={r.purpose} /></p>}
                          {(r.audience || r.expectedSize) && (
                            <p className="mb-2" style={{ fontSize: 12, color: "#666" }}>
                              {[r.audience, r.expectedSize].filter(Boolean).join(' · ')}
                            </p>
                          )}
                          {r.notes && <p className="mb-3" style={{ fontSize: 12, color: "#666" }}>{r.notes}</p>}
                          <div className="flex gap-2">
                            <button type="button" className="wb-btn small" onClick={() => handleReview(r.id, 'approve')}>{t('approve')}</button>
                            <button type="button" className="wb-btn small" onClick={() => handleReview(r.id, 'needs_changes')}>{t('needs changes')}</button>
                            <button type="button" className="wb-btn small" onClick={() => handleReview(r.id, 'skip')}>{t('skip')}</button>
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
                      <div key={r.id} style={{ border: "1px solid #e3e3e0", borderRadius: 3, padding: 14, background: "#fff" }}>
                        <div className="flex items-center justify-between mb-1">
                          <p style={{ fontSize: 13, fontWeight: 500, color: "#141414" }}>{r.title}</p>
                          <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 2, background: "#f0f0ed", color: r.status === 'needs_changes' ? "#141414" : "#666" }}>
                            {r.status === 'needs_changes' ? t('needs changes') : t('in review')}
                          </span>
                        </div>
                        {r.status === 'needs_changes' && r.reviewNote ? (
                          <>
                            <p className="mb-1" style={{ fontSize: 12, color: "#666" }}>{t('Index team')}</p>
                            <p className="mb-3 italic" style={{ fontSize: 13, color: "#555" }}><OthersText text={r.reviewNote} quoted /></p>
                            <div className="flex gap-2">
                              <button type="button" className="wb-btn small" onClick={() => handleDismissRequest(r.id)}>{t('dismiss')}</button>
                              <button type="button" className="wb-btn small" onClick={() => { setEditingRequest(r); setRequestModalOpen(true); }}>{t('update')}</button>
                            </div>
                          </>
                        ) : (
                          <p style={{ fontSize: 13, color: "#555" }}>{t('your request is in review.')}</p>
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
                    message={t("couldn't load your networks.")}
                    action={{ label: t("try again"), onClick: () => void refreshNetworks() }}
                  />
                ) : allNetworks.length > 0 ? (
                  <div>
                    {allNetworks.map((network) => {
                      // Prefer viewer membership `role` from GET /networks; the
                      // network.user.id compare is wrong for multi-owner nets.
                      const viewerRole = (network as { role?: 'owner' | 'member' }).role;
                      const isOwner = viewerRole === 'owner'
                        || (viewerRole !== 'member' && user?.id === network.user?.id);
                      const pendingJoinCount = (network as { pendingJoinCount?: number }).pendingJoinCount ?? 0;
                      return (
                        <button key={network.id} type="button" className="wb-link-row" onClick={() => navigate(`/networks/${network.id}`)} style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "10px 12px", textAlign: "left", border: "none", borderBottom: "1px solid #DDD8CC", font: "inherit" }}>
                          <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: "block", fontFamily: "var(--mac-mono)", fontSize: 15, fontWeight: 700, color: "inherit" }}>{network.title}</span>
                            <span style={{ display: "block", marginTop: 2, fontFamily: "var(--mac-sans)", fontSize: 13, color: "var(--ink-2)" }}>{t('{{count}} members', { count: network._count?.members || 0 })}</span>
                          </span>
                          {pendingJoinCount > 0 && <span className="wb-count">{pendingJoinCount}</span>}
                          <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontFamily: "var(--mac-mono)", fontSize: 13 }}>{isOwner ? t("owner") : t("member")}</span>
                          <span aria-hidden="true" className="wb-row-chevron">›</span>
                        </button>
                      );
                    })}
                  </div>
                ) : myRequests.length > 0 ? (
                  // The request card above already says it's in review; this only says where the network lands.
                  <EmptyState
                    style={{ padding: "32px 12px" }}
                    message={t("no networks yet. yours shows up here once it's approved.")}
                    action={{ label: t("discover networks"), onClick: openDiscover }}
                  />
                ) : (
                  <EmptyState
                    style={{ padding: "64px 12px" }}
                    message={t("you're not in any networks yet.")}
                    action={[
                      { label: t("create a network"), onClick: openCreate, primary: true },
                      { label: t("discover networks"), onClick: openDiscover },
                    ]}
                  />
                )}
                </>
              )}

              {activeTab === 'discover' && (
                <>
                {loadingPublic && publicNetworks.length === 0 ? (
                  <EmptyState tone="loading" style={{ padding: "48px 12px" }} message={t("loading public networks…")} />
                ) : publicError && publicNetworks.length === 0 ? (
                  <EmptyState
                    tone="error"
                    style={{ padding: "48px 12px" }}
                    message={t("couldn't load public networks.")}
                    action={{ label: t("try again"), onClick: () => void loadPublicNetworks() }}
                  />
                ) : publicNetworks.length > 0 ? (
                  <div>
                    {publicNetworks.map((network) => (
                      <div key={network.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderBottom: "1px solid #eeeeec" }}>
                        <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
                        <span style={{ minWidth: 0, flex: 1 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{network.title}</span>
                          <span style={{ display: "block", marginTop: 1, fontSize: 12, color: "#666" }}>{t('{{count}} members', { count: network._count?.members ?? (network as { memberCount?: number }).memberCount ?? 0 })}</span>
                        </span>
                        {network.isMember ? (
                          <span style={{ flex: "0 0 auto", color: "var(--ink-3)", fontSize: 12 }}>{t('member')}</span>
                        ) : (
                          <button
                            type="button"
                            className="wb-btn small"
                            onClick={() => handleJoinNetwork(network.id)}
                            disabled={joiningNetwork === network.id}
                          >
                            {joiningNetwork === network.id ? t('joining…') : t('join')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState style={{ padding: "64px 12px" }} message={t("no public networks to discover right now.")} />
                )}
                </>
              )}

      </div>
      </Window>
      </Stage>

      {modals}
    </>
  );
}

export const Component = NetworksPage;
