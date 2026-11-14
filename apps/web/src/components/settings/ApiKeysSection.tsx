import { useEffect, useState, type CSSProperties } from "react";

import { useNotifications } from "@/contexts/NotificationContext";
import { apiKeysService, type ApiKeyInfo } from "@/services/api-keys";
import { EmptyState } from "@/components/ui/EmptyState";

const th: CSSProperties = {
  textAlign: "left", padding: "0 12px 6px 0", borderBottom: "1px solid #e6e6e6",
  fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 11, fontWeight: 400,
  letterSpacing: "0.5px", color: "#8a8578",
};
const td: CSSProperties = {
  padding: "12px 12px 12px 0", borderBottom: "1px solid #e6e6e6",
  fontFamily: "var(--mac-sans)", fontSize: 14, color: "#000", whiteSpace: "nowrap",
};
const note: CSSProperties = {
  margin: "0 0 10px", maxWidth: 560,
  fontFamily: "var(--mac-sans)", fontSize: 13, lineHeight: 1.5, color: "#5a5548",
};

function accessDay(value: string | null): string {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "never"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function maskKey(start: string): string {
  return start ? `${start}${"*".repeat(24)}` : "unavailable";
}

function RevokeButton({ onConfirm, busy }: { onConfirm: () => void; busy: boolean }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      type="button"
      onClick={() => { if (armed) { onConfirm(); setArmed(false); } else setArmed(true); }}
      onBlur={() => setArmed(false)}
      disabled={busy}
      className={`wb-btn danger${armed ? " on" : ""}`}
    >{armed ? "sure?" : "revoke"}</button>
  );
}

function generateDefaultKeyName(keys: ApiKeyInfo[]): string {
  const names = new Set(keys.map((key) => key.name));
  if (!names.has("Personal")) return "Personal";
  let n = 2;
  while (names.has(`Personal ${n}`)) n += 1;
  return `Personal ${n}`;
}

/** The account's API keys. A key authenticates its owner, not an agent. */
export default function ApiKeysSection() {
  const { error } = useNotifications();

  const [keys, setKeys] = useState<ApiKeyInfo[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => setMintedKey(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiKeysService
      .list()
      .then((result) => {
        if (!cancelled) setKeys(result);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "could not load");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function reload() {
    try {
      setKeys(await apiKeysService.list());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "could not load");
    }
  }

  async function handleGenerateKey() {
    setGenerating(true);
    try {
      const created = await apiKeysService.create(generateDefaultKeyName(keys ?? []));
      setMintedKey(created.key);
      await reload();
    } catch (err) {
      error("Failed to create API key", err instanceof Error ? err.message : undefined);
    } finally {
      setGenerating(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await apiKeysService.revoke(id);
      await reload();
    } catch (err) {
      error("Failed to revoke API key", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 8 }}>
        <h2 className="st-h" style={{ flex: 1, margin: 0 }}>api keys</h2>
        <button
          type="button"
          onClick={() => void handleGenerateKey()}
          disabled={generating}
          className="wb-btn primary"
        >generate key</button>
      </div>

      <p style={note}>
        a key authenticates you in personal agents, CLI clients, and any other client.
      </p>

      {loadError ? (
        <EmptyState
          tone="error"
          align="start"
          style={{ padding: 0, margin: "0 0 10px" }}
          message="couldn't load api keys."
          action={{ label: "try again", onClick: () => void reload() }}
        />
      ) : keys === null ? (
        <p style={note}>loading…</p>
      ) : keys.length === 0 ? (
        <EmptyState
          align="start"
          style={{ maxWidth: 520, margin: "0 0 10px" }}
          message="no api keys yet."
          action={{ label: generating ? "generating…" : "generate key", onClick: () => { if (!generating) void handleGenerateKey(); } }}
        />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", border: "none" }}>
            <thead>
              <tr>
                <th style={th}>key</th>
                <th style={th}>created</th>
                <th style={th}>last used</th>
                <th style={{ ...th, textAlign: "right", paddingRight: 0 }} aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key.id}>
                  <td style={{ ...td, fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12, color: "#5a5548" }}>{maskKey(key.start)}</td>
                  <td style={td}>{accessDay(key.createdAt)}</td>
                  <td style={td}>{accessDay(key.lastUsedAt)}</td>
                  <td style={{ ...td, textAlign: "right", paddingRight: 0 }}>
                    <RevokeButton busy={busy || generating} onConfirm={() => void revoke(key.id)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {mintedKey && (
        <div style={{ marginTop: 10, borderRadius: 2, background: "#f7f7f5", padding: "12px 14px" }}>
          <p style={{ margin: "0 0 6px", fontFamily: "var(--mac-sans)", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>copy this key now. it won&apos;t be shown again.</p>
          <code style={{ display: "block", fontFamily: "var(--wb-code)", fontSize: 12, wordBreak: "break-all", userSelect: "text" }}>{mintedKey}</code>
          <button type="button" onClick={() => setMintedKey(null)} className="pl-plain-btn st-link" style={{ marginTop: 8 }}>dismiss</button>
        </div>
      )}
    </div>
  );
}
