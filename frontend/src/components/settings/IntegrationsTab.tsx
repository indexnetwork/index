import { useState, useEffect, useCallback, useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { RotateCw } from 'lucide-react';

import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIntegrationsService, type ComposioConnection } from '@/services/integrations';
import CopyableBox from '@/components/CopyableBox';
import MasterKeyDialog from '@/components/MasterKeyDialog';

/** Toolkits available for connection, keyed by network type. */
const COMMUNITY_TOOLKITS = ['gmail', 'slack'] as const;
const EVENT_TOOLKITS = ['gmail', 'slack', 'google_calendar'] as const;

const TOOLKIT_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
  google_calendar: 'Google Calendar',
};

const TOOLKIT_DESCRIPTIONS: Record<string, string> = {
  gmail: 'Import contacts and monitor conversations',
  slack: 'Import contacts and monitor channels',
  google_calendar: 'Sync event schedule and sessions',
};

const toolkitLabel = (t: string) => TOOLKIT_LABELS[t] ?? t;

/** Format a date string as relative time (e.g. "2 minutes ago"). */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (!Number.isFinite(then)) return 'Unknown';
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format a millisecond interval to a human label. */
function formatInterval(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

interface IntegrationsTabProps {
  network: Network;
  networkId: string;
  success: (msg: string, detail?: string) => void;
  error: (msg: string) => void;
  info: (msg: string, detail?: string, duration?: number) => void;
}

export default function IntegrationsTab({
  network,
  networkId,
  success,
  error,
  info,
}: IntegrationsTabProps) {
  const api = useAuthenticatedAPI();

  const [connections, setConnections] = useState<ComposioConnection[]>([]);
  const [connectionsLoaded, setConnectionsLoaded] = useState(false);
  const [pendingToolkit, setPendingToolkit] = useState<string | null>(null);
  const oauthCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => { oauthCleanupRef.current?.(); }, []);

  const [showRotateConfirm, setShowRotateConfirm] = useState(false);
  const [rotateConfirmationText, setRotateConfirmationText] = useState('');
  const [isRotating, setIsRotating] = useState(false);
  const [rotatedMasterKey, setRotatedMasterKey] = useState<string | null>(null);

  const availableToolkits = network.type === 'event'
    ? EVENT_TOOLKITS
    : COMMUNITY_TOOLKITS;

  const loadConnections = useCallback(async () => {
    try {
      const integrationsService = createIntegrationsService(api);
      const response = await integrationsService.getConnections(networkId);
      setConnections(response.connections);
    } catch (err) {
      console.error('Failed to load connections:', err);
      setConnections([]);
    } finally {
      setConnectionsLoaded(true);
    }
  }, [api, networkId]);

  useEffect(() => {
    loadConnections(); // eslint-disable-line react-hooks/set-state-in-effect -- load on mount
  }, [loadConnections]);

  const autoImportContacts = async (toolkit: string) => {
    // google_calendar syncs events, not contacts
    if (toolkit === 'google_calendar') return;

    const svc = createIntegrationsService(api);
    info(`Importing contacts from ${toolkitLabel(toolkit)}...`, undefined, 30000);
    try {
      const result = await svc.importContacts(toolkit, networkId);
      const label = network.isPersonal ? 'contacts' : 'members';
      success(`Imported ${result.imported} ${label}`, `${result.newContacts} new, ${result.existingContacts} already in your network`);
    } catch {
      error(`Failed to import ${toolkitLabel(toolkit)} contacts`);
    }
  };

  const linkAndImport = async (toolkit: string) => {
    const svc = createIntegrationsService(api);
    try {
      await svc.linkIntegration(toolkit, networkId);
      await loadConnections();
      autoImportContacts(toolkit);
    } catch {
      error(`Failed to link ${toolkitLabel(toolkit)} to this index`);
    }
  };

  const handleConnect = async (toolkit: string) => {
    const integrationsService = createIntegrationsService(api);
    setPendingToolkit(toolkit);

    // Check if user already has a Composio connection for this toolkit (user-level)
    try {
      const allConns = await integrationsService.getConnections();
      const existingConn = allConns.connections.find(c => c.toolkit === toolkit);
      if (existingConn) {
        // Already OAuth'd -- just link to this index
        success(`${toolkitLabel(toolkit)} connected`);
        await linkAndImport(toolkit);
        setPendingToolkit(null);
        return;
      }
    } catch {
      // Fall through to OAuth flow
    }

    try {
      const response = await integrationsService.connect(toolkit);
      const width = 600, height = 700;
      const left = window.screen.width / 2 - width / 2;
      const top = window.screen.height / 2 - height / 2;
      const popup = window.open(response.redirectUrl, 'oauth', `width=${width},height=${height},left=${left},top=${top}`);

      if (!popup) {
        error('Popup blocked. Please allow popups and try again.');
        setPendingToolkit(null);
        return;
      }

      let oauthSucceeded = false;

      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'oauth_callback' && event.data?.status === 'success') {
          oauthSucceeded = true;
          window.removeEventListener('message', onMessage);
          popup?.close();
          success(`${toolkitLabel(toolkit)} connected`);
          setPendingToolkit(null);
          linkAndImport(toolkit);
        } else if (event.data?.type === 'oauth_callback') {
          window.removeEventListener('message', onMessage);
          popup?.close();
          error(`Failed to connect ${toolkitLabel(toolkit)}`);
          setPendingToolkit(null);
        }
      };
      window.addEventListener('message', onMessage);

      const checkClosed = setInterval(() => {
        if (popup?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', onMessage);
          oauthCleanupRef.current = null;
          if (!oauthSucceeded) {
            loadConnections();
            setPendingToolkit(null);
          }
        }
      }, 1000);

      oauthCleanupRef.current = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(checkClosed);
        popup?.close();
      };
    } catch {
      error(`Failed to connect ${toolkitLabel(toolkit)}`);
      setPendingToolkit(null);
    }
  };

  const handleUnlink = async (toolkit: string) => {
    const integrationsService = createIntegrationsService(api);
    setPendingToolkit(toolkit);
    try {
      await integrationsService.unlinkIntegration(toolkit, networkId);
      success(`${toolkitLabel(toolkit)} removed from this index`);
      await loadConnections();
    } catch {
      error(`Failed to remove ${toolkitLabel(toolkit)}`);
    } finally {
      setPendingToolkit(null);
    }
  };

  const handleConfirmRotate = async () => {
    if (isRotating) return;
    if (rotateConfirmationText !== network.title) return;
    setIsRotating(true);
    try {
      // rotateMasterKey is on the network service, but we call it via a simple API call here
      const result = await api.post<{ masterKey: string }>(`/networks/${networkId}/rotate-master-key`, {});
      setShowRotateConfirm(false);
      setRotateConfirmationText('');
      setRotatedMasterKey(result.masterKey);
      success('Master key rotated — old key is now invalid');
    } catch (err) {
      console.error('Master key rotation failed', err);
      error('Failed to rotate master key');
    } finally {
      setIsRotating(false);
    }
  };

  // Calendar sync status from the google_calendar connection
  const calendarConn = connections.find(c => c.toolkit === 'google_calendar');
  const syncConfig = calendarConn?.syncConfig;

  return (
    <>
      <div className="space-y-4">

        <div className="space-y-2">
          {availableToolkits.map((toolkit) => {
            const conn = connections.find((c) => c.toolkit === toolkit);
            const isConnected = !!conn;
            const isPending = pendingToolkit === toolkit;
            return (
              <div key={toolkit} className="flex items-center gap-3 p-3 border border-gray-200 rounded-sm hover:border-gray-300 transition-colors">
                <img src={`/integrations/${toolkit}.png`} width={24} height={24} alt={toolkit} className="flex-shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-black">{toolkitLabel(toolkit)}</div>
                  <div className="text-xs text-gray-500">
                    {!connectionsLoaded
                      ? 'Loading...'
                      : isConnected
                        ? 'Connected'
                        : TOOLKIT_DESCRIPTIONS[toolkit] ?? 'Not connected'}
                  </div>
                </div>
                {!connectionsLoaded ? (
                  <div className="w-11 h-6 bg-gray-100 rounded-full animate-pulse" />
                ) : (
                  <button
                    onClick={() => isConnected ? handleUnlink(toolkit) : handleConnect(toolkit)}
                    disabled={isPending}
                    className={`relative h-6 w-11 rounded-full transition-colors ${isConnected ? 'bg-[#006D4B]' : 'bg-gray-300'} ${isPending ? 'opacity-70' : ''}`}
                  >
                    <span className={`absolute top-[1px] left-[1px] h-[22px] w-[22px] rounded-full bg-white transition-transform shadow-sm ${isConnected ? 'translate-x-5' : ''}`} />
                    {isPending && (
                      <span className="absolute inset-0 grid place-items-center">
                        <span className="h-3 w-3 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      </span>
                    )}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Calendar Sync Status */}
        {calendarConn && syncConfig && (
          <div className="bg-gray-50 border border-gray-200 rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">Calendar Sync Status</p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-500">Status</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${syncConfig.status === 'active' ? 'bg-green-500' : syncConfig.status === 'error' ? 'bg-red-500' : 'bg-gray-400'}`} />
                  <span className={`capitalize ${syncConfig.status === 'error' ? 'text-red-600' : 'text-black'}`}>{syncConfig.status}</span>
                </div>
              </div>
              <div>
                <span className="text-gray-500">Calendar ID</span>
                <p className="text-black truncate mt-0.5">{syncConfig.calendarId || 'primary'}</p>
              </div>
              <div>
                <span className="text-gray-500">Sync interval</span>
                <p className="text-black mt-0.5">{syncConfig.intervalMs ? formatInterval(syncConfig.intervalMs) : '15 min'}</p>
              </div>
              <div>
                <span className="text-gray-500">Last synced</span>
                <p className="text-black mt-0.5">{syncConfig.lastSyncAt ? formatRelativeTime(syncConfig.lastSyncAt) : 'Never'}</p>
              </div>
            </div>
          </div>
        )}

        {/* EdgeClaw section for experiment networks */}
        {network.isExperiment && (
          <div className="pt-2">
            <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-sm">
              <img
                src="/integrations/edgeclaw.png"
                width={24}
                height={24}
                alt="EdgeClaw"
                className="flex-shrink-0 mt-0.5"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-black">EdgeClaw</div>
                    <div className="text-xs text-gray-500">Server-side signup for experiment attendees</div>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => setShowRotateConfirm(true)}
                    disabled={isRotating}
                  >
                    <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                    Rotate key
                  </Button>
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Signup endpoint</div>
                  <CopyableBox value={typeof window !== 'undefined' ? `${window.location.origin}/api/networks/${networkId}/signup` : `/api/networks/${networkId}/signup`} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Master key</div>
                  <CopyableBox value={'•••••••• (shown once at creation — rotate for a new one)'} />
                </div>
                <p className="text-xs text-gray-500">
                  Used server-side by InstaClaw and EdgeOS. Never expose in user-facing apps.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Rotate key confirmation dialog */}
      <AlertDialog.Root open={showRotateConfirm} onOpenChange={(open) => { if (!open) { setShowRotateConfirm(false); setRotateConfirmationText(''); } }}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Rotate master key</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              Rotating issues a new master key and immediately revokes the current one. Any backend using the old key (InstaClaw, EdgeOS) will stop working until you redeploy it with the new key. We will also email the new key to every owner of this network. Type the network name to confirm.
            </AlertDialog.Description>
            <Input
              value={rotateConfirmationText}
              onChange={(e) => setRotateConfirmationText(e.target.value)}
              placeholder={network.title}
              className="mb-4"
            />
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={isRotating}>Cancel</Button>
              </AlertDialog.Cancel>
              <Button
                onClick={handleConfirmRotate}
                disabled={isRotating || rotateConfirmationText !== network.title}
              >
                {isRotating ? 'Rotating...' : 'Rotate'}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {/* Rotated master key display */}
      {rotatedMasterKey && (
        <MasterKeyDialog
          open={!!rotatedMasterKey}
          masterKey={rotatedMasterKey}
          onClose={() => setRotatedMasterKey(null)}
        />
      )}
    </>
  );
}
