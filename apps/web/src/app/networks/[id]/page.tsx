import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import * as Tabs from '@radix-ui/react-tabs';

import ClientLayout from '@/components/ClientLayout';
import { resolveNetworkImageSrc } from '@/lib/network-image';
import { Stage, Window } from '@/components/workbench/Workbench';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNetworks } from '@/contexts/APIContext';
import { Network } from '@/lib/types';
import { log } from '@/lib/logger';

const logger = log.page.from('networks/[id]');

const TILE = ["#FF8A00", "#0055AA", "#C64B8C", "#3E8E7E", "#E8C547", "#7B5EA7"];

function NetworkTile({ id, name, photo, size = 48 }: { id?: string; name?: string; photo?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <img src={resolveNetworkImageSrc(photo)} alt="" onError={() => setBroken(true)} style={{ flex: "0 0 auto", width: size, height: size, objectFit: "cover", display: "block", border: "1px solid #000", filter: "grayscale(1) contrast(1.05)" }} />
    );
  }
  const seed = String(name || id || "");
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const cells = [0, 1, 2, 3].map((i) => TILE[(h >>> (i * 3)) % TILE.length]);
  return (
    <span style={{ flex: "0 0 auto", width: size, height: size, border: "1px solid #000", display: "grid", gridTemplateColumns: "1fr 1fr" }}>
      {cells.map((color, i) => <span key={i} style={{ background: color }} />)}
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

      try {
        const fetchedNetwork = await networksService.getNetwork(networkId);
        const ownerStatus = await checkOwnership(networkId, fetchedNetwork);
        setNetwork(fetchedNetwork);
        setIsOwner(ownerStatus);
      } catch (err) {
        logger.error('Error loading network', { error: err });
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    if (networkId) {
      loadNetwork();
    }
  }, [networkId, networks, networksService, checkOwnership]);

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
    <ClientLayout>
      <Stage width={860} height="min(660px, calc(100vh - 112px))">
      <Window title={network?.title?.toLowerCase() || 'networks'} onClose={() => navigate('/networks')} style={{ height: '100%' }}>
      {loading ? (
        <p style={{ padding: 24, fontFamily: "var(--mac-mono)", fontSize: 12 }}>loading…</p>
      ) : notFound ? (
        <div style={{ padding: 24 }}>
          <p style={{ fontFamily: 'var(--mac-mono)', fontSize: 12 }}>network not found</p>
          <button type="button" className="wb-btn small" onClick={() => navigate('/networks')}>back</button>
        </div>
      ) : network ? (
        <Tabs.Root value={isOwner ? activeTab : "overview"} onValueChange={handleTabChange} style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 24px 0", borderBottom: "2px solid #000" }}>
            <button type="button" onClick={() => navigate('/networks')} style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>← back</button>
            <div style={{ marginTop: 12, marginBottom: 14, display: "flex", alignItems: "center", gap: 14 }}>
              <NetworkTile id={network.id} name={network.title} photo={network.imageUrl} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "var(--mac-mono)", fontSize: 19, fontWeight: 700 }}>{network.title}</div>
                <div style={{ marginTop: 5, display: "flex", flexWrap: "wrap", gap: "4px 16px", fontFamily: "var(--mac-mono)", fontSize: 12, color: "var(--ink-2)" }}>
                  <span>{isPublic ? "public" : "🔒 private"}</span>
                  {network._count?.members !== undefined && <span>👤 {network._count.members} members</span>}
                  {isOwner && <span>★ owner</span>}
                </div>
              </div>
              {!isOwner && (
                <button type="button" onClick={() => setLeaveRequested(true)} style={{ flex: "0 0 auto", cursor: "pointer", fontFamily: "var(--mac-mono)", fontSize: 13, padding: "7px 15px", border: "1px solid var(--ink-warn)", background: "#fff", color: "var(--ink-warn)", boxShadow: "1px 1px 0 rgba(138,0,0,0.3)" }}>leave</button>
              )}
            </div>
            {isOwner && (
              <Tabs.List style={{ display: "flex", gap: 2 }}>
                {(['overview', 'settings', 'access'] as const).map((tab) => (
                  <Tabs.Trigger key={tab} value={tab} style={{ padding: "8px 14px 10px", border: "none", borderBottom: activeTab === tab ? "2px solid #000" : "2px solid transparent", background: "transparent", fontFamily: "var(--mac-mono)", fontSize: 13, fontWeight: activeTab === tab ? 700 : 400, color: activeTab === tab ? "#000" : "var(--ink-2)", textTransform: "capitalize", cursor: "pointer" }}>{tab}</Tabs.Trigger>
                ))}
              </Tabs.List>
            )}
          </div>
          <div className="mac-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 24px 20px" }}>
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
    </ClientLayout>
  );
}

export const Component = NetworkDetailPage;
