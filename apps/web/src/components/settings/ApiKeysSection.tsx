import { useEffect, useState } from "react";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmWindow } from "@/components/workbench/Workbench";
import CopyableBox from "@/components/CopyableBox";
import { useNotifications } from "@/contexts/NotificationContext";
import { buildCliSetup } from "@/lib/cli-config";
import { apiKeysService, type ApiKeyInfo } from "@/services/api-keys";

function hasActiveSelection(): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function maskKey(start: string): string {
  return start ? `${start}${"*".repeat(24)}` : "Unavailable";
}

function InlineSetupPanel({
  apiKey,
  onDismiss,
}: {
  apiKey: string;
  onDismiss: () => void;
}) {
  const cliSetup = buildCliSetup(apiKey);
  const [keyCopied, setKeyCopied] = useState(false);

  async function copyKey() {
    if (hasActiveSelection()) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 800);
    } catch {
      /* silent */
    }
  }


  return (
    <div className="mt-4 border border-amber-200 rounded-sm bg-amber-50/50 p-4 space-y-4">
      <div className="space-y-2">
        <p className="text-sm font-medium text-amber-900 font-ibm-plex-mono">
          Copy this key now — it won&apos;t be shown again
        </p>
        <button
          type="button"
          onClick={copyKey}
          aria-label="Copy API key"
          className={`relative w-full text-left group rounded-sm border p-3 transition-colors duration-300 ${
            keyCopied
              ? "bg-amber-200 border-amber-400"
              : "bg-white border-amber-200 hover:bg-amber-100"
          }`}
        >
          <code className="block text-xs text-gray-900 font-ibm-plex-mono whitespace-pre-wrap break-all pr-16 select-text">
            {apiKey}
          </code>
          <span
            className={`absolute top-2 right-2 inline-flex items-center gap-1 text-xs transition-colors select-none ${
              keyCopied ? "text-amber-900" : "text-gray-400 group-hover:text-amber-900"
            }`}
          >
            {keyCopied ? (
              <>
                <Check className="w-3 h-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                Copy
              </>
            )}
          </span>
        </button>
      </div>

      <div className="space-y-3">
        <CopyableBox value={cliSetup} />
        <p className="text-xs text-gray-400 font-ibm-plex-mono">
          Configure your agent's environment with this API key. Use only one of INDEX_API_KEY or INDEX_SESSION_TOKEN.
        </p>
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="text-xs text-gray-400 font-ibm-plex-mono hover:text-black transition-colors duration-150 underline"
      >
        Dismiss
      </button>
    </div>
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
  const { success, error } = useNotifications();

  const [keys, setKeys] = useState<ApiKeyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [mintedKey, setMintedKey] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyInfo | null>(null);
  const [revoking, setRevoking] = useState(false);

  // Defensive: clear the plaintext secret from memory on unmount.
  useEffect(() => {
    return () => setMintedKey(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    apiKeysService
      .list()
      .then((result) => {
        if (!cancelled) {
          setKeys(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          error("Failed to load API keys", err instanceof Error ? err.message : undefined);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [error]);

  async function handleGenerateKey() {
    setGenerating(true);
    try {
      const created = await apiKeysService.create(generateDefaultKeyName(keys));
      setMintedKey(created.key);
      setKeys(await apiKeysService.list());
      success("API key created");
    } catch (err) {
      error("Failed to create API key", err instanceof Error ? err.message : undefined);
    } finally {
      setGenerating(false);
    }
  }

  async function performRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await apiKeysService.revoke(revokeTarget.id);
      setKeys(await apiKeysService.list());
      success("API key revoked");
      setRevokeTarget(null);
    } catch (err) {
      error("Failed to revoke API key", err instanceof Error ? err.message : undefined);
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
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
              api keys
            </p>
            <Button size="sm" onClick={handleGenerateKey} disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              generate key
            </Button>
          </div>

          <p className="text-xs text-gray-400 font-ibm-plex-mono">
            A key authenticates you in personal agents, CLI clients, and any other client.
          </p>

          {keys.length === 0 ? (
            <p style={{ fontFamily: "var(--mac-mono)", fontSize: 12 }}>no api keys yet.</p>
          ) : (
            <div style={{ border: "1px solid #000", overflow: "hidden" }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: "1px solid #000" }}>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Key
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Created
                    </th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Last used
                    </th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id} style={{ borderBottom: "1px solid #000" }}>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.createdAt)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.lastUsedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(key)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1"
                          title="revoke"
                          aria-label="revoke"
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

        {mintedKey ? (
          <InlineSetupPanel apiKey={mintedKey} onDismiss={() => setMintedKey(null)} />
        ) : null}
      </div>

      {revokeTarget && (
        <ConfirmWindow
          title="revoke"
          body={`revoke ${revokeTarget.name ?? maskKey(revokeTarget.start)}? any client using this key will stop working.`}
          confirmLabel="revoke"
          busy={revoking}
          onCancel={() => { if (!revoking) setRevokeTarget(null); }}
          onConfirm={() => void performRevoke()}
        />
      )}
    </>
  );
}
