import { useCallback, useEffect, useState } from "react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";
import { EmptyState } from "@/components/ui/EmptyState";
import { Placeholder } from "@/components/ui/Placeholder";
import { ConfirmButton, SettingsItem } from "@/components/settings/SettingsList";
import { shortDay } from "@/lib/short-day";

interface DeviceSession {
  id: string;
  token: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "unknown device";
  if (isMacUserAgent(userAgent)) return "index for mac";
  if (userAgent.startsWith("index-cli")) return "index cli";
  if (isHermesUserAgent(userAgent)) return "hermes agent";
  if (/Chrome|Safari|Firefox|Edg/.test(userAgent)) return "web browser";
  return userAgent.slice(0, 32);
}

/**
 * Every session that can act as this account: browsers and the native clients
 * signed in through the device grant. Revoking one signs that device out.
 */
export default function DevicesSection() {
  const { signOut } = useAuthContext();
  const { error } = useNotifications();

  const [sessions, setSessions] = useState<DeviceSession[] | null>(null);
  const [currentToken, setCurrentToken] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchDevices = useCallback(async () => {
    const [listed, current] = await Promise.all([
      authClient.listSessions(),
      authClient.getSession(),
    ]);
    if (listed.error) throw new Error(listed.error.message ?? "could not load");
    return {
      sessions: (listed.data ?? []) as unknown as DeviceSession[],
      currentToken: current.data?.session.token ?? null,
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const result = await fetchDevices();
      setSessions(result.sessions);
      setCurrentToken(result.currentToken);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "could not load");
    }
  }, [fetchDevices]);

  useEffect(() => {
    let cancelled = false;
    fetchDevices()
      .then((result) => {
        if (cancelled) return;
        setSessions(result.sessions);
        setCurrentToken(result.currentToken);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDevices]);

  async function revoke(session: DeviceSession) {
    if (session.token === currentToken) {
      await signOut();
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.revokeSession({ token: session.token });
      if (result.error) throw new Error(result.error.message ?? "request failed");
      await reload();
    } catch (err) {
      error("Failed to sign out device", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <h2 className="st-h">devices</h2>
      <p className="st-note">
        where you are signed in. the mac app, cli and personal agents each hold their own session, so signing one out here leaves the others alone.
      </p>

      {loadError ? (
        <EmptyState
          tone="error"
          align="start"
          style={{ padding: 0 }}
          message="couldn't load devices."
          action={{ label: "try again", onClick: () => void reload() }}
        />
      ) : sessions === null ? (
        <Placeholder.Rows count={2} avatar={false} label="loading devices" />
      ) : sessions.length === 0 ? (
        <p className="st-note">no active devices.</p>
      ) : (
        <ul className="st-list">
          {sessions.map((session) => (
            <SettingsItem
              key={session.id}
              name={describeDevice(session.userAgent)}
              tag={session.token === currentToken ? "this browser" : undefined}
              detail={`signed in ${shortDay(session.createdAt)} · expires ${shortDay(session.expiresAt)}`}
              action={<ConfirmButton label={session.token === currentToken ? "sign out" : "revoke"} disabled={busy} onConfirm={() => void revoke(session)} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
