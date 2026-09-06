import { useEffect, useMemo, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, Copy, Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import CopyableBox from "@/components/CopyableBox";
import { useNotifications } from "@/contexts/NotificationContext";
import { buildMcpConfigs } from "@/lib/mcp-config";
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
  const { claudeConfig } = useMemo(() => buildMcpConfigs(apiKey), [apiKey]);
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

  const tabTriggerClass =
    "px-4 py-2 text-sm text-gray-600 border-b-2 border-transparent -mb-px data-[state=active]:border-black data-[state=active]:text-black data-[state=active]:font-bold outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-gray-400 disabled:hover:text-gray-400";

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

      <Tabs.Root defaultValue="claude" className="w-full">
        <Tabs.List className="flex w-full gap-0 border-b border-amber-200 mb-4">
          <Tabs.Trigger value="claude" className={tabTriggerClass}>
            MCP
          </Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="claude" className="space-y-3">
          <CopyableBox value={claudeConfig} />
          <p className="text-xs text-gray-400 font-ibm-plex-mono">
            Add to ~/.claude/settings.json (global) or .mcp.json (per-project)
          </p>
        </Tabs.Content>
      </Tabs.Root>

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
              API Keys
            </p>
            <Button size="sm" onClick={handleGenerateKey} disabled={generating}>
              {generating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
              Generate Key
            </Button>
          </div>

          <p className="text-xs text-gray-400 font-ibm-plex-mono">
            A key authenticates you in MCP clients (Claude Code and OpenClaw). It carries your
            whole account, not a single agent.
          </p>

          {keys.length === 0 ? (
            <p className="text-xs text-gray-400 font-ibm-plex-mono">No API keys yet.</p>
          ) : (
            <div className="border border-gray-200 rounded-sm overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
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
                    <tr key={key.id} className="border-b border-gray-100 last:border-b-0">
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.createdAt)}</td>
                      <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.lastUsedAt)}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => setRevokeTarget(key)}
                          className="text-gray-400 hover:text-red-500 transition-colors p-1"
                          title="Revoke key"
                          aria-label="Revoke key"
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

      <AlertDialog.Root
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !revoking) setRevokeTarget(null);
        }}
      >
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 bg-black/50 z-[100]" />
          <AlertDialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-sm shadow-lg p-6 w-full max-w-md z-[100] focus:outline-none">
            <AlertDialog.Title className="text-lg font-bold text-gray-900 mb-4">Revoke API key</AlertDialog.Title>
            <AlertDialog.Description className="text-sm text-gray-600 mb-4">
              {revokeTarget
                ? `Revoke "${revokeTarget.name ?? maskKey(revokeTarget.start)}"? Any client using this key will stop working immediately.`
                : ""}
            </AlertDialog.Description>
            <div className="flex justify-end gap-3">
              <AlertDialog.Cancel asChild>
                <Button variant="outline" disabled={revoking}>
                  Cancel
                </Button>
              </AlertDialog.Cancel>
              <Button
                onClick={performRevoke}
                disabled={revoking}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                {revoking ? "Revoking..." : "Revoke"}
              </Button>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </>
  );
}
