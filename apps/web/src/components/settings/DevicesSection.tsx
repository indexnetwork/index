import { useCallback, useEffect, useState, type CSSProperties } from "react";

import { useAuthContext } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { authClient } from "@/lib/auth-client";
import { isHermesUserAgent, isMacUserAgent } from "@/lib/devices";

const th: CSSProperties = {
  textAlign: "left", padding: "6px 10px", borderBottom: "1px solid #000",
  fontFamily: "var(--mac-mono)", fontSize: 9, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: 0.5, color: "var(--ink-2)",
};
const td: CSSProperties = {
  padding: "7px 10px", borderBottom: "1px solid rgba(0,0,0,0.12)",
  fontFamily: "var(--mac-mono)", fontSize: 11, color: "#000", whiteSpace: "nowrap",
};
const note: CSSProperties = {
  margin: "0 0 10px", maxWidth: 520,
  fontFamily: "var(--mac-sans)", fontSize: 12, lineHeight: 1.5, color: "var(--ink-2)",
};
const heading: CSSProperties = {
  margin: 0, fontFamily: "var(--mac-mono)", fontSize: 10, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: 0.6, color: "var(--ink-2)",
};

interface DeviceSession {
  id: string;
  token: string;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

function accessDay(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "never"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return "unknown device";
  if (isMacUserAgent(userAgent)) return "index for mac";
  if (userAgent.startsWith("index-cli")) return "index cli";
  if (isHermesUserAgent(userAgent)) return "hermes agent";
  if (/Chrome|Safari|Firefox|Edg/.test(userAgent)) return "web browser";
  return userAgent.slice(0, 32);
}

function RevokeButton({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}
      onBlur={() => setArmed(false)}
      disabled={busy}
      style={{
        fontFamily: "var(--mac-mono)", fontSize: 11, padding: "3px 10px",
        border: "1px solid #000", background: armed ? "var(--ink-warn)" : "#fff",
        color: armed ? "#fff" : "var(--ink-warn)",
        boxShadow: "1px 1px 0 rgba(0,0,0,0.2)", cursor: busy ? "default" : "pointer",
      }}
    >{armed ? "sure?" : "revoke"}</button>
  );
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
      <p style={{ ...heading, marginBottom: 8 }}>devices</p>
      <p style={note}>
        where you are signed in. the mac app, cli and personal agents each hold their own session, so signing one out here leaves the others alone.
      </p>

      {loadError ? (
        <p style={note}>{loadError} · <button type="button" onClick={() => void reload()} style={{ fontFamily: "var(--mac-sans)", fontSize: 12, border: "none", background: "none", color: "var(--ink-2)", textDecoration: "underline", cursor: "pointer", padding: 0 }}>retry</button></p>
      ) : sessions === null ? (
        <p style={note}>loading…</p>
      ) : sessions.length === 0 ? (
        <p style={note}>no active devices.</p>
      ) : (
        <div style={{ border: "1px solid #000", background: "#fff", boxShadow: "2px 2px 0 rgba(0,0,0,0.22)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>device</th>
                <th style={th}>signed in</th>
                <th style={th}>expires</th>
                <th style={{ ...th, textAlign: "right" }}>actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td style={td}>
                    {describeDevice(session.userAgent)}
                    {session.token === currentToken && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "var(--ink-2)" }}>this browser</span>
                    )}
                  </td>
                  <td style={td}>{accessDay(session.createdAt)}</td>
                  <td style={td}>{accessDay(session.expiresAt)}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    <RevokeButton busy={busy} onConfirm={() => void revoke(session)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
