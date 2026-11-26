import { useEffect, useState } from "react";

import { useNotifications } from "@/contexts/NotificationContext";
import { apiKeysService, type ApiKeyInfo } from "@/services/api-keys";
import { EmptyState } from "@/components/ui/EmptyState";
import { Placeholder } from "@/components/ui/Placeholder";
import { ConfirmButton, SettingsItem } from "@/components/settings/SettingsList";
import { shortDay } from "@/lib/short-day";

function maskKey(start: string): string {
  return start ? `${start}${"•".repeat(8)}` : "unavailable";
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
      <h2 className="st-h">api keys</h2>
      <div className="st-lead">
        <p className="st-note">a key authenticates you in personal agents, CLI clients, and any other client.</p>
        <button type="button" onClick={() => void handleGenerateKey()} disabled={generating} aria-busy={generating} className="wb-btn">
          {generating ? "generating" : "generate key"}
        </button>
      </div>

      {mintedKey && (
        <div className="st-reveal">
          <p>copy this key now. it won&apos;t be shown again.</p>
          <code>{mintedKey}</code>
          <button type="button" onClick={() => setMintedKey(null)} className="pl-plain-btn st-link">dismiss</button>
        </div>
      )}

      {loadError ? (
        <EmptyState
          tone="error"
          align="start"
          style={{ padding: 0 }}
          message="couldn't load api keys."
          action={{ label: "try again", onClick: () => void reload() }}
        />
      ) : keys === null ? (
        <Placeholder.Rows count={2} avatar={false} label="loading api keys" />
      ) : keys.length === 0 ? (
        <p className="st-note">no api keys yet.</p>
      ) : (
        <ul className="st-list">
          {keys.map((key) => (
            <SettingsItem
              key={key.id}
              name={key.name || "api key"}
              detail={`${maskKey(key.start)} · created ${shortDay(key.createdAt)} · ${key.lastUsedAt ? `used ${shortDay(key.lastUsedAt)}` : "never used"}`}
              action={<ConfirmButton label="revoke" disabled={busy || generating} onConfirm={() => void revoke(key.id)} />}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
