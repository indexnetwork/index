import { useState, useEffect, useCallback, useRef } from 'react';
import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { RotateCw } from 'lucide-react';

import { Network } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuthenticatedAPI } from '@/lib/api';
import { createIntegrationsService, type ComposioConnection } from '@/services/integrations';
import { createIndexesService } from '@/services/networks';
import CopyableBox from '@/components/CopyableBox';
import MasterKeyDialog from '@/components/MasterKeyDialog';
import { log } from '@/lib/logger';

const logger = log.ui.from('IntegrationsTab');

/** Toolkits available for connection. */
const TOOLKITS = ['gmail', 'slack'] as const;

const TOOLKIT_LABELS: Record<string, string> = {
  gmail: 'Gmail',
  slack: 'Slack',
};

const TOOLKIT_DESCRIPTIONS: Record<string, string> = {
  gmail: 'Connect Gmail conversations',
  slack: 'Connect Slack channels',
};

const toolkitLabel = (t: string) => TOOLKIT_LABELS[t] ?? t;

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
  info: _info,
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
  const [isEnablingMasterKey, setIsEnablingMasterKey] = useState(false);
  const [enabledMasterKey, setEnabledMasterKey] = useState<string | null>(null);
  const [masterKeyEnabled, setMasterKeyEnabled] = useState(false);
  // Until the parent refetches the network after enabling, treat the local
  // enable as authoritative.
  const hasMasterKey = network.hasMasterKey || masterKeyEnabled;

  const loadConnections = useCallback(async () => {
    try {
      const integrationsService = createIntegrationsService(api);
      const response = await integrationsService.getConnections(networkId);
      setConnections(response.connections);
    } catch (err) {
      logger.error('Failed to load connections', { error: err });
      setConnections([]);
    } finally {
      setConnectionsLoaded(true);
    }
  }, [api, networkId]);

  useEffect(() => {
    loadConnections(); // eslint-disable-line react-hooks/set-state-in-effect -- load on mount
  }, [loadConnections]);

  const linkToNetwork = async (toolkit: string) => {
    const svc = createIntegrationsService(api);
    try {
      await svc.linkIntegration(toolkit, networkId);
      await loadConnections();
    } catch {
      error(`Failed to link ${toolkitLabel(toolkit)} to this network`);
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
        // Already OAuth'd -- just link to this network
        success(`${toolkitLabel(toolkit)} connected`);
        await linkToNetwork(toolkit);
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
          linkToNetwork(toolkit);
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
      success(`${toolkitLabel(toolkit)} removed from this network`);
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
      const result = await createIndexesService(api).rotateMasterKey(networkId);
      setShowRotateConfirm(false);
      setRotateConfirmationText('');
      setRotatedMasterKey(result.masterKey);
      success('Master key rotated — old key is now invalid');
    } catch (err) {
      logger.error('Master key rotation failed', { error: err });
      error('Failed to rotate master key');
    } finally {
      setIsRotating(false);
    }
  };

  const handleEnableMasterKey = async () => {
    if (isEnablingMasterKey) return;
    setIsEnablingMasterKey(true);
    try {
      const result = await createIndexesService(api).enableMasterKey(networkId);
      setEnabledMasterKey(result.masterKey);
      setMasterKeyEnabled(true);
      success('Master key enabled — copy it now, it will not be shown again');
    } catch (err) {
      logger.error('Master key enable failed', { error: err });
      error('Failed to enable master key');
    } finally {
      setIsEnablingMasterKey(false);
    }
  };

  return (
    <>
      <div className="space-y-4">

        <div className="space-y-2">
          {TOOLKITS.map((toolkit) => {
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

        {/* Master-key signup section */}
        {(
          <div className="pt-2">
            <div className="flex items-start gap-3 p-3 border border-gray-200 rounded-sm">
              <div className="flex-1 min-w-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-black">Master-Key Signup</div>
                    <div className="text-xs text-gray-500">Server-side signup via shared master key</div>
                  </div>
                  {hasMasterKey ? (
                    <Button
                      variant="outline"
                      onClick={() => setShowRotateConfirm(true)}
                      disabled={isRotating}
                    >
                      <RotateCw className="h-3.5 w-3.5 mr-1.5" />
                      Rotate key
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={handleEnableMasterKey}
                      disabled={isEnablingMasterKey}
                    >
                      {isEnablingMasterKey ? 'Enabling...' : 'Enable master key'}
                    </Button>
                  )}
                </div>
                {hasMasterKey ? (
                  <>
                    <div>
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Signup endpoint</div>
                      <CopyableBox value={typeof window !== 'undefined' ? `${window.location.origin}/api/networks/${networkId}/signup` : `/api/networks/${networkId}/signup`} />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-1.5">Master key</div>
                      <CopyableBox value={'•••••••• (shown once at creation — rotate for a new one)'} />
                    </div>
                    <p className="text-xs text-gray-500">
                      Used server-side by external integrators. Never expose in user-facing apps.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-gray-500">
                    Enable a master key to let external integrators sign members up server-side. The key is shown once.
                  </p>
                )}
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
              Rotating issues a new master key and immediately revokes the current one. Any backend using the old key will stop working until you redeploy it with the new key. We will also email the new key to every owner of this network. Type the network name to confirm.
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

      {/* Revealed master key display (enable or rotate) */}
      {(rotatedMasterKey || enabledMasterKey) && (
        <MasterKeyDialog
          open={!!(rotatedMasterKey || enabledMasterKey)}
          masterKey={(rotatedMasterKey ?? enabledMasterKey) as string}
          onClose={() => { setRotatedMasterKey(null); setEnabledMasterKey(null); }}
        />
      )}
    </>
  );
}
