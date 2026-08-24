import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { HERMES_CAPABILITIES } from '@/lib/hermes-auth';
import { connectedAgentsService, type ConnectedHermesAgent } from '@/services/connected-agents';

const healthLabels: Record<ConnectedHermesAgent['health'], string> = {
  active: 'Active',
  stale: 'Stale',
  never_seen: 'Never seen',
  expired: 'Expired',
  revoked: 'Revoked',
};

function formatTimestamp(value: string | null): string {
  if (!value) return 'Never';
  return new Date(value).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function ConnectedAgentsPage() {
  const [connections, setConnections] = useState<ConnectedHermesAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyInstallation, setBusyInstallation] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [showReconnectInstructions, setShowReconnectInstructions] = useState(false);

  const refresh = useCallback(async () => {
    const next = await connectedAgentsService.list();
    setConnections(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    connectedAgentsService.list()
      .then((next) => {
        if (!cancelled) setConnections(next);
      })
      .catch(() => {
        if (!cancelled) setError('Connected Hermes agents could not be loaded.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function pause(connection: ConnectedHermesAgent) {
    if (!window.confirm('Pause this Hermes connection and let Index cover negotiations?')) return;
    setBusyInstallation(connection.installationId);
    setError('');
    try {
      await connectedAgentsService.pause(connection.installationId);
      await refresh();
    } catch {
      setError('The Hermes connection could not be paused. Refresh and try again.');
    } finally {
      setBusyInstallation(null);
    }
  }

  async function revoke(connection: ConnectedHermesAgent) {
    if (!window.confirm('Revoke this Hermes connection? Hermes will lose access immediately.')) return;
    setBusyInstallation(connection.installationId);
    setError('');
    try {
      await connectedAgentsService.revoke(connection.installationId);
      await refresh();
    } catch {
      setError('The Hermes connection could not be revoked. Refresh and try again.');
    } finally {
      setBusyInstallation(null);
    }
  }

  return (
    <main className="flex-1 bg-white px-6 py-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Agents</p>
          <h1 className="mt-2 text-2xl font-semibold text-gray-900">Connected Hermes agents</h1>
          <p className="mt-2 text-sm text-gray-600">
            Review runtime health, pause negotiation routing, or revoke an installation.
          </p>
        </div>

        {error ? <p role="alert" className="rounded-sm bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}

        {loading ? <p role="status" className="text-sm text-gray-500">Loading connected agents…</p> : null}

        {!loading && connections.length === 0 ? (
          <div className="rounded-sm border border-gray-200 p-5 text-sm text-gray-600">
            No Hermes installations are connected to this account.
          </div>
        ) : null}

        <div className="space-y-4">
          {connections.map((connection) => {
            const busy = busyInstallation === connection.installationId;
            return (
              <article key={connection.installationId} className="rounded-sm border border-gray-200 p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Installation</p>
                    <p className="mt-1 text-sm font-semibold text-gray-900">{connection.installationName}</p>
                    <code className="mt-1 block break-all text-sm text-gray-800">{connection.installationId}</code>
                  </div>
                  <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold text-gray-700">
                    {healthLabels[connection.health]}
                  </span>
                </div>

                <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-gray-400">Credential status</dt>
                    <dd className="capitalize text-gray-800">Credential {connection.activationState}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Runtime</dt>
                    <dd className="text-gray-800">
                      {connection.indexCovering
                        ? 'Index is covering negotiations'
                        : 'Hermes is handling negotiations'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Last heartbeat</dt>
                    <dd className="text-gray-800">{formatTimestamp(connection.lastHeartbeatAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-gray-400">Expires</dt>
                    <dd className="text-gray-800">{formatTimestamp(connection.expiresAt)}</dd>
                  </div>
                </dl>

                <section className="mt-5" aria-label={`Granted capabilities for ${connection.installationName}`}>
                  <h3 className="text-sm font-semibold text-gray-900">Granted capabilities</h3>
                  <ul className="mt-2 space-y-1 text-sm text-gray-700">
                    {HERMES_CAPABILITIES.filter((capability) => connection.actions.includes(capability.action)).map((capability) => (
                      <li key={capability.action}>{capability.label}</li>
                    ))}
                  </ul>
                </section>

                <div className="mt-5 flex flex-wrap justify-end gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void pause(connection)}
                    disabled={busy || !connection.selected || connection.activationState !== 'active'}
                  >
                    Pause
                  </Button>
                  <Button
                    onClick={() => void revoke(connection)}
                    disabled={busy || connection.activationState === 'revoked'}
                    className="bg-red-600 text-white hover:bg-red-700"
                  >
                    Revoke
                  </Button>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="rounded-sm border border-blue-100 bg-blue-50 p-5">
          <h2 className="font-semibold text-gray-900">Reconnect securely</h2>
          <p className="mt-2 text-sm text-gray-600">
            Reconnecting uses the API key configured in Hermes. It never mints or extends a credential from this page.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => setShowReconnectInstructions(true)}
          >
            Reconnect in Hermes
          </Button>
          {showReconnectInstructions ? (
            <div
              role="dialog"
              aria-labelledby="reconnect-hermes-heading"
              className="mt-4 rounded-sm border border-blue-200 bg-white p-4"
            >
              <h3 id="reconnect-hermes-heading" className="font-semibold text-gray-900">Reconnect Hermes securely</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-gray-700">
                <li>Open the Hermes dashboard.</li>
                <li>Select Index.</li>
                <li>Choose Connect.</li>
              </ol>
              <p className="mt-3 text-sm text-gray-600">
                Hermes reads its API key from the environment. This page makes no authorization request.
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => setShowReconnectInstructions(false)}
              >
                Close instructions
              </Button>
            </div>
          ) : null}
        </aside>
      </div>
    </main>
  );
}

export const Component = ConnectedAgentsPage;
