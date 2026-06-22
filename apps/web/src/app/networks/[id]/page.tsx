import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ChevronLeft, Loader2, Globe, Lock, Users, LogOut, Calendar } from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';

import NetworkAvatar from '@/components/IndexAvatar';
import ClientLayout from '@/components/ClientLayout';
import NetworkSettingsPanel from '@/components/NetworkSettingsPanel';
import NetworkOverviewPanel from '@/components/NetworkOverviewPanel';
import { ContentContainer } from '@/components/layout';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksState } from '@/contexts/IndexesContext';
import { useNetworks } from '@/contexts/APIContext';
import { Network } from '@/lib/types';

export type TabValue = 'overview' | 'settings' | 'access' | 'integrations';

export const URL_TO_TAB: Record<string, TabValue> = {
  settings: 'settings',
  contacts: 'access',
  integrations: 'integrations',
};

export const TAB_TO_URL: Record<TabValue, string | undefined> = {
  overview: undefined,
  settings: 'settings',
  access: 'contacts',
  integrations: 'integrations',
};

export interface NetworkDetailProps {
  networkIdOverride?: string;
  basePath?: string;
}

export default function NetworkDetailPage({ networkIdOverride, basePath }: NetworkDetailProps = {}) {
  const params = useParams();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { indexes } = useNetworksState();
  const indexesService = useNetworks();

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
      const memberSettings = await indexesService.getCurrentUserMemberSettings(networkId);
      return memberSettings.isOwner;
    } catch (err) {
      console.error('Error loading member settings:', err);
      return networkData?.user ? user?.id === networkData.user.id : false;
    }
  }, [indexesService, user?.id]);

  useEffect(() => {
    const loadNetwork = async () => {
      const existingNetwork = indexes?.find(idx => idx.id === networkId);
      if (existingNetwork) {
        const ownerStatus = await checkOwnership(networkId, existingNetwork);
        setNetwork(existingNetwork);
        setIsOwner(ownerStatus);
        setLoading(false);
        return;
      }

      try {
        const fetchedNetwork = await indexesService.getNetwork(networkId);
        const ownerStatus = await checkOwnership(networkId, fetchedNetwork);
        setNetwork(fetchedNetwork);
        setIsOwner(ownerStatus);
      } catch (err) {
        console.error('Error loading network:', err);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    if (networkId) {
      loadNetwork();
    }
  }, [networkId, indexes, indexesService, checkOwnership]);

  useEffect(() => {
    const updateNetworkFromContext = async () => {
      if (network && indexes && !isCheckingOwnership.current) {
        const updated = indexes.find(idx => idx.id === network.id);
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
  }, [indexes, network, checkOwnership, user?.id, isOwner]);

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
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>

          {/* Back */}
          <button
            type="button"
            onClick={() => navigate('/networks')}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-black transition-colors mb-6"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Networks
          </button>

          {loading ? (
            <div className="flex justify-center py-16">
              <Loader2 className="w-5 h-5 animate-spin text-gray-300" />
            </div>
          ) : notFound ? (
            <div className="py-16 text-center">
              <p className="text-sm font-medium text-gray-700 mb-1">Network not found</p>
              <button onClick={() => navigate('/networks')} className="text-xs text-gray-400 hover:text-black transition-colors">
                Back to Networks
              </button>
            </div>
          ) : network ? (
            <>
              {/* Header */}
              <div className="flex items-start justify-between mb-8">
                <div className="flex items-start gap-4">
                  <div className="w-16 h-16 rounded-full overflow-hidden shrink-0">
                    <NetworkAvatar id={network.id} title={network.title} imageUrl={network.imageUrl} size={64} rounded="full" />
                  </div>
                  <div>
                  <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-3">
                    {network.title}
                  </h1>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1.5 text-xs text-gray-500">
                      {isPublic
                        ? <Globe className="w-3.5 h-3.5" />
                        : <Lock className="w-3.5 h-3.5" />}
                      {isPublic ? 'Public' : network.isExperiment ? 'Experiment' : 'Private'}
                    </span>
                    {network.type === 'event' && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Calendar className="w-3.5 h-3.5" />
                        Event
                      </span>
                    )}
                    {network._count?.members !== undefined && (
                      <span className="flex items-center gap-1.5 text-xs text-gray-500">
                        <Users className="w-3.5 h-3.5" />
                        {network._count.members} member{network._count.members !== 1 ? 's' : ''}
                      </span>
                    )}
                    {isOwner && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-900 text-white rounded-sm font-medium">
                        Owner
                      </span>
                    )}
                  </div>
                  </div>
                </div>
                {!isOwner && (
                  <button
                    onClick={() => setLeaveRequested(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-sm hover:bg-red-50 hover:border-red-300 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Leave
                  </button>
                )}
              </div>

              {isOwner ? (
                <Tabs.Root value={activeTab} onValueChange={handleTabChange}>
                  <Tabs.List className="flex border-b border-gray-200 mb-8">
                    {(['overview', 'settings', 'access', 'integrations'] as const).map((tab) => (
                      <Tabs.Trigger
                        key={tab}
                        value={tab}
                        className="px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold capitalize"
                      >
                        {tab === 'access' && network?.isPersonal ? 'contacts' : tab}
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>

                  <Tabs.Content value="overview">
                    <NetworkOverviewPanel index={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
                  </Tabs.Content>
                  <Tabs.Content value="settings">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="settings" />
                  </Tabs.Content>
                  <Tabs.Content value="access">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="access" />
                  </Tabs.Content>
                  <Tabs.Content value="integrations">
                    <NetworkSettingsPanel index={network} onDeleted={handleDeleted} activeTab="integrations" />
                  </Tabs.Content>
                </Tabs.Root>
              ) : (
                <NetworkOverviewPanel index={network} isOwner={isOwner} onLeft={handleLeft} onLeaveRequest={leaveRequested} onLeaveRequestHandled={() => setLeaveRequested(false)} />
              )}
            </>
          ) : null}

        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = NetworkDetailPage;
