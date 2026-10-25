import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';

import { resolveNetworkImageSrc } from '@/lib/network-image';
import { Stage, Window } from '@/components/workbench/Workbench';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNetworks } from '@/contexts/APIContext';
import { Network } from '@/lib/types';
import { log } from '@/lib/logger';
import { EmptyState } from "@/components/ui/EmptyState";
import { APIError } from "@/lib/api";
import { useCompact } from "@/hooks/useCompact";

const logger = log.page.from('networks/[id]');

function NetworkTile({ id, name, photo, size = 40 }: { id?: string; name?: string; photo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <img src={resolveNetworkImageSrc(photo)} alt="" onError={() => setBroken(true)} style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", borderRadius: 3 }} />
    );
  }
  const initial = String(name || id || "").trim().charAt(0).toUpperCase();
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, borderRadius: 3, background: "#ededea", color: "#555", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 500 }}>
      {initial}
    </span>
  );
}

export type TabValue = 'overview' | 'settings' | 'access';

const URL_TO_TAB: Record<string, TabValue> = {
  settings: 'settings',
  contacts: 'access',
};

const TAB_TO_URL: Record<TabValue, string | undefined> = {
  overview: undefined,
  settings: 'settings',
  access: 'contacts',
};

export interface NetworkDetailProps {
  networkIdOverride?: string;
  basePath?: string;
}

export default function NetworkDetailPage({ networkIdOverride, basePath }: NetworkDetailProps = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const compact = useCompact();
  const { user } = useAuthContext();
  const { networks } = useNetworksState();
  const networksService = useNetworks();

  const networkId = networkIdOverride || (params.id as string);
  // Splat route (*) captures the tab segment; avoids remounts between tab navigations
  const tabParam = (params['*'] || undefined) as string | undefined;
  const resolvedBasePath = useMemo(() => basePath || `/networks/${networkId}`, [basePath, networkId]);
  const activeTab = useMemo<TabValue>(() => {
    if (tabParam && URL_TO_TAB[tabParam]) return URL_TO_TAB[tabParam];
    return 'overview';
  }, [tabParam]);

  const handleTabChange = useCallback((value: string) => {
    const segment = TAB_TO_URL[value as TabValue];
    // Replace when leaving the default overview (no tabParam in URL yet);
    // push when switching between explicit tabs so back traverses them.
    navigate(`${resolvedBasePath}${segment ? `/${segment}` : ''}`, { replace: !tabParam });
  }, [navigate, resolvedBasePath, tabParam]);

  const [network, setNetwork] = useState<Network | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [isOwner, setIsOwner] = useState(false);
  const [leaveRequested, setLeaveRequested] = useState(false);
  const isCheckingOwnership = useRef(false);

  const checkOwnership = useCallback(async (networkId: string, networkData?: Network) => {
    try {
      const memberSettings = await networksService.getCurrentUserMemberSettings(networkId);
      return memberSettings.isOwner;
    } catch (err) {
      logger.error('Error loading member settings', { error: err });
      return networkData?.user ? user?.id === networkData.user.id : false;
    }
  }, [networksService, user?.id]);

  useEffect(() => {
    const loadNetwork = async () => {
      const existingNetwork = networks?.find(n => n.id === networkId);
      if (existingNetwork) {
        const ownerStatus = await checkOwnership(networkId, existingNetwork);
        setNetwork(existingNetwork);
        setIsOwner(ownerStatus);
        setLoading(false);
        return;
      }

      setNotFound(false);
      setLoadFailed(false);
      try {
        const fetchedNetwork = await networksService.getNetwork(networkId);
        const ownerStatus = await checkOwnership(networkId, fetchedNetwork);
        setNetwork(fetchedNetwork);
        setIsOwner(ownerStatus);
      } catch (err) {
        logger.error('Error loading network', { error: err });
        // 404 and 403 (not a member) both mean "not yours to see"; a 200 without a network
        // throws a plain Error. Anything else (5xx, offline) is retryable.
        const missing = !(err instanceof APIError) || err.status === 404 || err.status === 403;
        setNotFound(missing);
        setLoadFailed(!missing);
      } finally {
        setLoading(false);
      }
    };

    if (networkId) {
      loadNetwork();
    }
  }, [networkId, networks, networksService, checkOwnership, reloadKey]);

  useEffect(() => {
    const updateNetworkFromContext = async () => {
      if (network && networks && !isCheckingOwnership.current) {
        const updated = networks.find(n => n.id === network.id);
        if (updated && JSON.stringify(updated) !== JSON.stringify(network)) {
          isCheckingOwnership.current = true;
          try {
            let ownerStatus = isOwner;
            if (updated.user && user?.id) {
              ownerStatus = user.id === updated.user.id;
            } else {
              ownerStatus = await checkOwnership(network.id, updated);
            }
            setNetwork(updated);
            setIsOwner(ownerStatus);
          } finally {
            isCheckingOwnership.current = false;
          }
        }
      }
    };
    updateNetworkFromContext();
  }, [networks, network, checkOwnership, user?.id, isOwner]);

  // Redirect invalid tab slugs and non-owner tab access to the base path
  useEffect(() => {
    if (!tabParam || loading) return;
    const invalidSlug = !URL_TO_TAB[tabParam];
    if (invalidSlug || !isOwner) {
      navigate(resolvedBasePath, { replace: true });
    }
  }, [tabParam, loading, isOwner, resolvedBasePath, navigate]);

  const handleDeleted = () => navigate('/networks');
  const handleLeft = () => navigate('/networks');

  const isPublic = network?.permissions?.joinPolicy === 'anyone';

  return (
    <>
      <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title={network?.title?.toLowerCase() || 'networks'} onClose={() => navigate('/networks')} style={{ height: '100%' }}>
      {loading ? (
        <EmptyState tone="loading" style={{ padding: "64px 24px" }} />
      ) : notFound ? (
        <EmptyState
          style={{ padding: "64px 24px" }}
          message="this network doesn't exist, or you don't have access to it."
          action={{ label: "back to networks", to: "/networks" }}
        />
      ) : loadFailed ? (
        <EmptyState
          tone="error"
          style={{ padding: "64px 24px" }}
          message="couldn't load this network."
          action={{ label: "try again", onClick: () => { setLoading(true); setReloadKey((k) => k + 1); } }}
        />
      ) : network ? (
        <Tabs.Root value={isOwner ? activeTab : "overview"} onValueChange={handleTabChange} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: compact ? "12px 16px 0" : "14px 24px 0", borderBottom: "1px solid #e3e3e0" }}>
            <button type="button" onClick={() => navigate('/networks')} style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", fontSize: 12, color: "var(--ink-2)" }}>← back</button>
            <div style={{ marginTop: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)" }}>{network.title}</div>
                <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "#666" }}>
                  <span>{isPublic ? "public" : "private"}</span>
                  {network._count?.members !== undefined && <span>{network._count.members} members</span>}
                  {isOwner && <span>owner</span>}
                </div>
              </div>
              {!isOwner && (
                <button type="button" onClick={() => setLeaveRequested(true)} style={{ flex: "0 0 auto", cursor: "pointer", fontSize: 12, padding: "5px 12px", border: "1px solid #ddd", borderRadius: 3, background: "#fff", color: "var(--ink-warn)" }}>leave</button>
              )}
            </div>
            {isOwner && (
              <Tabs.List style={{ display: "flex", gap: 2 }}>
                {(['overview', 'settings', 'access'] as const).map((tab) => (
                  <Tabs.Trigger key={tab} value={tab} style={{ padding: "8px 14px", border: "none", borderBottom: activeTab === tab ? "1px solid var(--ink)" : "1px solid transparent", marginBottom: -1, background: "transparent", fontSize: 13, fontWeight: activeTab === tab ? 500 : 400, color: activeTab === tab ? "var(--ink)" : "var(--ink-2)", textTransform: "capitalize", cursor: "pointer" }}>{tab}</Tabs.Trigger>
                ))}
              </Tabs.List>
            )}
          </div>
          <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: compact ? "14px 16px 20px" : "14px 24px 20px" }}>
            <Tabs.Content value="overview">
              <NetworkOverviewPanel network={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
            </Tabs.Content>
            {isOwner && (
              <>
                <Tabs.Content value="settings">
                  <NetworkSettingsPanel network={network} onDeleted={handleDeleted} activeTab="settings" />
                </Tabs.Content>
                <Tabs.Content value="access">
                  <NetworkSettingsPanel network={network} onDeleted={handleDeleted} activeTab="access" />
                </Tabs.Content>
              </>
            )}
          </div>
        </Tabs.Root>
      ) : null}
      </Window>
      </Stage>
    </>
  );
}

export const Component = NetworkDetailPage;
