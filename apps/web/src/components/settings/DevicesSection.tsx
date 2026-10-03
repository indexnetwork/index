import { useCallback, useEffect, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import { ConfirmWindow } from "@/components/workbench/Workbench";
import { useNotifications } from "@/contexts/NotificationContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";

interface DeviceSession {
  id: string;
  token: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * Name a session from its user agent. The device grant records whatever the
 * client sent, so this reads the few clients we ship and otherwise falls back
 * to the raw value rather than inventing a label.
 */
function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "Unknown device";
  if (isMacUserAgent(userAgent)) return "Index for Mac";
  if (userAgent.startsWith("index-cli")) return "Index CLI";
  if (isHermesUserAgent(userAgent)) return "Hermes agent";
  if (/Chrome|Safari|Firefox|Edg/.test(userAgent)) return "Web browser";
  return userAgent.slice(0, 48);
}

/**
 * Every session that can act as this account: browsers and the native clients
 * signed in through the device grant. Revoking one signs that device out.
 */
export default function DevicesSection() {
  const { success, error } = useNotifications();

  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<DeviceSession | null>(null);
  const [revoking, setRevoking] = useState(false);

  const fetchDevices = useCallback(async () => {
    const [listed, current] = await Promise.all([
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (listed.error) throw new Error(listed.error.message ?? "Could not load devices");
    return {
      sessions: (listed.data ?? []) as unknown as DeviceSession[],
      currentToken: current.data?.session.token ?? null,
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchDevices()
      .then((result) => {
        if (cancelled) return;
        setSessions(result.sessions);
        setCurrentToken(result.currentToken);
      })
      .catch((err) => {
        if (!cancelled) error("Failed to load devices", err instanceof Error ? err.message : undefined);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDevices, error]);

  async function performRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const result = await authClient.revokeSession({ token: revokeTarget.token });
      if (result.error) throw new Error(result.error.message ?? "Could not revoke device");
      const refreshed = await fetchDevices();
      setSessions(refreshed.sessions);
      setCurrentToken(refreshed.currentToken);
      success("Device signed out");
      setRevokeTarget(null);
    } catch (err) {
      error("Failed to sign out device", err instanceof Error ? err.message : undefined);
    } finally {
      setRevoking(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl space-y-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
            devices
          </p>

          <p className="text-xs text-gray-400 font-ibm-plex-mono">
            Where you are signed in. The Mac app, CLI and personal agents each hold their own
            session, so signing one out here leaves the others alone.
          </p>

          {sessions.length === 0 ? (
            <p className="text-xs text-gray-400 font-ibm-plex-mono">No active devices.</p>
          ) : (
            <div style={{ border: "1px solid #000", overflow: "hidden" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Device
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Signed in
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Expires
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} style={{ borderBottom: "1px solid #000" }}>
                      <td className="px-4 py-2 text-sm text-gray-700">
                        {describeDevice(session.userAgent)}
                        {session.token === currentToken ? (
                          <span className="ml-2 text-xs text-gray-400 font-ibm-plex-mono">this browser</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(session.createdAt)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(session.expiresAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(session)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1"
                          title="sign out"
                          aria-label="sign out"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {revokeTarget && (
        <ConfirmWindow
          title="sign out"
          body={revokeTarget.token === currentToken
            ? "this is the browser you are using. signing it out ends this session."
            : `sign out ${describeDevice(revokeTarget.userAgent)}? it will have to sign in again.`}
          confirmLabel="sign out"
          busy={revoking}
          onCancel={() => { if (!revoking) setRevokeTarget(null); }}
          onConfirm={() => void performRevoke()}
        />
      )}
    </>
  );
}
