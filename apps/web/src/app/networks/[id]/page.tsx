import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { Loader2, Globe, Lock, Users, LogOut } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';

import NetworkAvatar from '@/components/NetworkAvatar';
import ClientLayout from '@/components/ClientLayout';
import { Stage, Window } from '@/components/workbench/Workbench';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/NetworksContext';
import { useNetworks } from '@/contexts/APIContext';
import { Network } from '@/lib/types';
import { log } from '@/lib/logger';

const logger = log.page.from('networks/[id]');

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
      <div className="mac-scroll" style={{ flex: 1, overflowY: 'auto', padding: '18px 24px 22px' }}>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : notFound ? (
            <div className="py-16 text-center">
              <p style={{ fontFamily: 'var(--mac-mono)', fontSize: 12 }}>network not found</p>
              <button type="button" className="wb-btn small" onClick={() => navigate('/networks')}>back</button>
            </div>
          ) : network ? (
            <>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
                <div>
                  <h1 style={{ margin: 0, fontFamily: "var(--mac-mono)", fontSize: 18, fontWeight: 700 }}>{network.title.toLowerCase()}</h1>
                  <p style={{ margin: "6px 0 0", fontFamily: "var(--mac-mono)", fontSize: 11, color: "var(--ink-2)" }}>
                    {isPublic ? "public" : "private"}
                    {network._count?.members !== undefined ? ` · ${network._count.members} members` : ""}
                    {isOwner ? " · owner" : ""}
                  </p>
                </div>
                {!isOwner && (
                  <button type="button" className="wb-btn small" onClick={() => setLeaveRequested(true)}>leave</button>
                )}
              </div>

              {isOwner ? (
                <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
                  <div className="wb-segmented lg" style={{ marginBottom: 16 }}>
                    {(['overview', 'settings', 'access'] as const).map((tab) => (
                      <Tabs.Trigger key={tab} value={tab}>{tab}</Tabs.Trigger>
                    ))}
                  </div>

                  <Tabs.Content value="overview">
                    <NetworkOverviewPanel network={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
                  </Tabs.Content>
                  <Tabs.Content value="settings">
                    <NetworkSettingsPanel network={network} onDeleted={handleDeleted} activeTab="settings" />
                  </Tabs.Content>
                  <Tabs.Content value="access">
                    <NetworkSettingsPanel network={network} onDeleted={handleDeleted} activeTab="access" />
                  </Tabs.Content>
                </Tabs.Root>
              ) : (
                <NetworkOverviewPanel network={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
              )}
            </>
          ) : null}

      </div>
      </Window>
      </Stage>
    </ClientLayout>
  );
}

export const Component = NetworkDetailPage;
