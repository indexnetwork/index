import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import CopyableBox from "@/components/CopyableBox";
import { useAgents } from "@/contexts/APIContext";

function hasActiveSelection(): boolean {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().length > 0;
}
import { useNotifications } from "@/contexts/NotificationContext";
import { buildMcpConfigs } from "@/lib/mcp-config";
import type { Agent, AgentTokenInfo } from "@/services/agents";

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
          <Tabs.Trigger value="hermes" disabled className={tabTriggerClass}>
            <span className="inline-flex items-center gap-1.5">
              Hermes
              <span className="text-[10px] uppercase tracking-wider bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-sm font-ibm-plex-mono">
                soon
              </span>
            </span>
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

function generateDefaultAgentName(personalAgents: Agent[]): string {
  const names = new Set(personalAgents.map((a) => a.name));
  if (!names.has("Personal")) return "Personal";
  let n = 2;
  while (names.has(`Personal ${n}`)) n += 1;
  return `Personal ${n}`;
}

/** MCP / OpenClaw API keys for the first personal agent (create one if missing). */
export default function AgentApiKeysSection() {
  const agentsService = useAgents();
  const { success, error } = useNotifications();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [expandedSetup, setExpandedSetup] = useState<{ agentId: string; apiKey: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [agentKeys, setAgentKeys] = useState<AgentTokenInfo[]>([]);
  const [revokeTarget, setRevokeTarget] = useState<{ agent: Agent; tokenId: string } | null>(null);
  const [revoking, setRevoking] = useState(false);

  const tokensRequestRef = useRef(0);

  const personalAgents = useMemo(() => agents.filter((a) => a.type === "personal"), [agents]);
  const primaryAgent = personalAgents[0] ?? null;

  // Defensive: clear plaintext API key from memory on unmount.
  useEffect(() => {
    return () => setExpandedSetup(null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    agentsService
      .list()
      .then((result) => {
        if (!cancelled) {
          setAgents(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          error("Failed to load agents", err instanceof Error ? err.message : undefined);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [agentsService, error]);

  const refreshTokens = useCallback(
    async (agentId: string) => {
      const reqId = ++tokensRequestRef.current;
      try {
        const tokens = await agentsService.listTokens(agentId);
        if (tokensRequestRef.current === reqId) {
          setAgentKeys(tokens);
        }
      } catch (err) {
        if (tokensRequestRef.current === reqId) {
          error("Failed to load API keys", err instanceof Error ? err.message : undefined);
        }
      }
    },
    [agentsService, error],
  );

  useEffect(() => {
    if (!primaryAgent) {
      tokensRequestRef.current += 1;
      return;
    }
    const reqId = ++tokensRequestRef.current;
    agentsService
      .listTokens(primaryAgent.id)
      .then((tokens) => {
        if (tokensRequestRef.current === reqId) setAgentKeys(tokens);
      })
      .catch((err) => {
        if (tokensRequestRef.current === reqId) {
          error("Failed to load API keys", err instanceof Error ? err.message : undefined);
        }
      });
  }, [agentsService, primaryAgent, error]);

  async function refreshAgents() {
    const next = await agentsService.list();
    setAgents(next);
  }

  async function handleCreateAgent() {
    setConnecting(true);
    const name = generateDefaultAgentName(personalAgents);
    let createdAgent: Agent | null = null;
    try {
      createdAgent = await agentsService.create(name);
      const token = await agentsService.createToken(createdAgent.id);
      await refreshAgents();
      setExpandedSetup({ agentId: createdAgent.id, apiKey: token.key });
      await refreshTokens(createdAgent.id);
      success("Agent connected");
    } catch (err) {
      // Compensate: if the agent was created but token issuance failed,
      // delete the orphan agent so the user can retry cleanly.
      if (createdAgent) {
        try {
          await agentsService.delete(createdAgent.id);
        } catch {
          /* best-effort cleanup */
        }
      }
      error("Failed to connect agent", err instanceof Error ? err.message : undefined);
    } finally {
      setConnecting(false);
    }
  }

  async function handleGenerateKey(agent: Agent) {
    setGenerating(true);
    try {
      const result = await agentsService.createToken(agent.id);
      setExpandedSetup({ agentId: agent.id, apiKey: result.key });
      await refreshTokens(agent.id);
      success("Agent API key created");
    } catch (err) {
      error("Failed to create agent API key", err instanceof Error ? err.message : undefined);
    } finally {
      setGenerating(false);
    }
  }

  async function performRevoke() {
    if (!revokeTarget) return;
    const { agent, tokenId } = revokeTarget;
    setRevoking(true);
    try {
      await agentsService.revokeToken(agent.id, tokenId);
      setExpandedSetup((cur) => (cur?.agentId === agent.id ? null : cur));
      await refreshTokens(agent.id);
      success("Agent API key revoked");
      setRevokeTarget(null);
    } catch (err) {
      error("Failed to revoke agent API key", err instanceof Error ? err.message : undefined);
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

  const showSetup =
    primaryAgent !== null && expandedSetup?.agentId === primaryAgent.id;

  return (
    <>
      {!primaryAgent ? (
        <div className="space-y-4 max-w-2xl">
          <div className="space-y-3">
            <p className="text-xs text-gray-400 font-ibm-plex-mono">
              Create an agent to generate API keys for MCP (Claude Code, Hermes, OpenClaw).
            </p>
            <Button onClick={handleCreateAgent} disabled={connecting}>
              {connecting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Plus className="w-4 h-4 mr-1" />}
              Create agent
            </Button>
          </div>
          {expandedSetup ? (
            <InlineSetupPanel
              apiKey={expandedSetup.apiKey}
              onDismiss={() => setExpandedSetup(null)}
            />
          ) : null}
        </div>
      ) : (
        <div className="max-w-3xl space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                API Keys
              </p>
              <Button size="sm" onClick={() => handleGenerateKey(primaryAgent)} disabled={generating}>
                {generating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                Generate Key
              </Button>
            </div>

            {agentKeys.length === 0 ? (
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
                    {agentKeys.map((key) => (
                      <tr key={key.id} className="border-b border-gray-100 last:border-b-0">
                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.createdAt)}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{formatDate(key.lastUsedAt)}</td>
                        <td className="px-4 py-2 text-right">
                          <button
                            type="button"
                            onClick={() => setRevokeTarget({ agent: primaryAgent, tokenId: key.id })}
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

          {showSetup && expandedSetup ? (
            <InlineSetupPanel
              apiKey={expandedSetup.apiKey}
              onDismiss={() => setExpandedSetup(null)}
            />
          ) : null}
        </div>
      )}

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
                ? `Revoke API key for "${revokeTarget.agent.name}"? Any client using this key will stop working immediately.`
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
