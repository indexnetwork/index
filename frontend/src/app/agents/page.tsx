import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import * as Dialog from '@radix-ui/react-dialog';
import { Bot, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';

import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAgents } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { buildMcpConfigs } from '@/lib/mcp-config';
import type { Agent, AgentTokenInfo } from '@/services/agents';

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function maskKey(start: string): string {
  return start ? `${start}${'*'.repeat(24)}` : 'Unavailable';
}

function permissionLabel(action: string): string {
  switch (action) {
    case 'manage:profile':
      return 'Profile';
    case 'manage:intents':
      return 'Intents';
    case 'manage:networks':
      return 'Networks';
    case 'manage:contacts':
      return 'Contacts';
    case 'manage:opportunities':
      return 'Opportunities';
    case 'manage:negotiations':
      return 'Negotiations';
    default:
      return action;
  }
}

function ClickableCodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label="Copy code block"
      className="relative w-full text-left group bg-gray-50 border border-gray-200 rounded-sm p-3 hover:bg-green-50 hover:border-green-300 transition-colors"
    >
      <span className="block text-xs text-gray-700 font-mono whitespace-pre-wrap break-all pr-16">{code}</span>
      <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
        {copied ? '✓ Copied' : '⧉ Copy'}
      </span>
    </button>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard unavailable (e.g. non-secure context)
        }
      }}
      className="shrink-0 p-1 text-gray-400 hover:text-gray-600 transition-colors"
      title="Copy"
      aria-label="Copy value"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function WizardRow({
  prompt,
  description,
  value,
  copyable,
}: {
  prompt: string;
  description: string;
  value: string;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <>
      <div className="flex flex-col justify-center p-3 border-b border-r border-gray-200 bg-gray-50">
        <span className="text-xs font-medium text-gray-700">{prompt}</span>
        <span className="text-xs text-gray-400 mt-0.5">{description}</span>
      </div>
      {copyable ? (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy ${prompt} value`}
          className="relative group flex items-start p-3 border-b border-gray-200 bg-gray-50 hover:bg-green-50 hover:border-green-300 transition-colors text-left font-mono text-xs text-gray-700 whitespace-pre-wrap break-all"
        >
          <span className="pr-16">{value}</span>
          <span className="absolute top-2 right-2 text-xs text-gray-400 group-hover:text-green-700 transition-colors select-none">
            {copied ? '✓ Copied' : '⧉ Copy'}
          </span>
        </button>
      ) : (
        <div className="flex items-center p-3 border-b border-gray-200 text-xs text-gray-500 italic">
          {value}
        </div>
      )}
    </>
  );
}

function WizardPromptGrid({
  serverUrl,
  agentId,
  apiKey,
}: {
  serverUrl: string;
  agentId: string;
  apiKey: string;
}) {
  return (
    <div className="border border-gray-200 rounded-sm overflow-hidden">
      <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-100 px-3 py-2">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Prompt</span>
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Value</span>
      </div>
      <div className="grid grid-cols-2">
        <WizardRow prompt="URL" description="Index Network URL" value={serverUrl} copyable />
        <WizardRow prompt="Agent ID" description="Your personal agent's unique identifier" value={agentId} copyable />
        <WizardRow prompt="API Key" description="The API key you just generated" value={apiKey} copyable />
        <div className="col-span-2 px-3 py-2 border-b border-gray-200 bg-gray-100">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Optional</span>
        </div>
        <WizardRow
          prompt="Daily digest"
          description="Receive a daily summary of opportunities"
          value="enable / disable"
        />
        <WizardRow
          prompt="Digest time"
          description="Time to send the daily digest (24-hour format)"
          value="08:00 (default)"
        />
        <WizardRow
          prompt="Max per digest"
          description="Maximum number of opportunities included per digest"
          value="20 (default)"
        />
        <WizardRow
          prompt="Main agent tool use during Index Network renders"
          description="Whether the agent may call MCP tools when rendering results"
          value={"1. Disabled — agent renders from provided content only (default)\n2. Enabled — agent may call MCP tools to enrich"}
        />
      </div>
    </div>
  );
}

function SetupInstructions({ apiKey, agentId }: { apiKey?: string; agentId?: string }) {
  const keyValue = apiKey || 'YOUR_API_KEY';
  const agentValue = agentId || 'YOUR_AGENT_ID';
  const baseUrl = window.location.origin;
  const { claudeConfig, hermesConfig } = buildMcpConfigs(keyValue);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Claude Code / OpenCode</p>
        <ClickableCodeBlock code={claudeConfig} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Hermes Agent</p>
        <ClickableCodeBlock code={hermesConfig} />
      </div>
      <WizardPromptGrid serverUrl={baseUrl} agentId={agentValue} apiKey={keyValue} />
    </div>
  );
}

function ApiKeyCreatedModal({
  agentName,
  agentId,
  apiKey,
  onClose,
}: {
  agentName: string;
  agentId: string;
  apiKey: string;
  onClose: () => void;
}) {
  const [copiedKey, setCopiedKey] = useState(false);

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 1500);
    } catch { /* silent */ }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-sm shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-6 focus:outline-none">
          <div>
            <Dialog.Title className="text-lg font-semibold text-gray-900">API Key Created</Dialog.Title>
            <Dialog.Description className="text-sm text-gray-500 mt-1">For: {agentName}</Dialog.Description>
          </div>

          <div className="bg-amber-50 border border-amber-200 rounded-sm p-4 space-y-3">
            <p className="text-sm font-medium text-amber-800">Copy this key now — it won't be shown again</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded-sm px-3 py-2 text-sm font-mono text-gray-900 break-all select-all">
                {apiKey}
              </code>
              <Button variant="outline" size="sm" onClick={handleCopyKey}>
                {copiedKey ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Your Agent ID and API key are pre-filled below. Pick the platform you use.
            </p>
            <SetupInstructions apiKey={apiKey} agentId={agentId} />
          </div>

          <div className="flex justify-end pt-2 border-t border-gray-100">
            <Button onClick={onClose}>Done</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default function AgentsPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuthContext();
  const agentsService = useAgents();
  const { success, error } = useNotifications();

  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState('');
  const [newAgentDescription, setNewAgentDescription] = useState('');
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ agentId: string; key: string } | null>(null);
  const [generatingForAgentId, setGeneratingForAgentId] = useState<string | null>(null);
  const [keysVersion, setKeysVersion] = useState(0);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/');
    }
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

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
          error('Failed to load agents', err instanceof Error ? err.message : undefined);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [agentsService, error, isAuthenticated]);

  const [keysByAgent, setKeysByAgent] = useState<Record<string, AgentTokenInfo[]>>({});

  useEffect(() => {
    if (!isAuthenticated || agents.length === 0) {
      return;
    }

    let cancelled = false;
    const personalIds = agents.filter((a) => a.type === 'personal').map((a) => a.id);

    Promise.all(
      personalIds.map((id) =>
        agentsService.listTokens(id).then((tokens) => [id, tokens] as const).catch(() => [id, [] as AgentTokenInfo[]] as const),
      ),
    ).then((results) => {
      if (cancelled) return;
      const grouped: Record<string, AgentTokenInfo[]> = {};
      for (const [id, tokens] of results) {
        if (tokens.length > 0) grouped[id] = tokens;
      }
      setKeysByAgent(grouped);
    });

    return () => {
      cancelled = true;
    };
  }, [agentsService, agents, isAuthenticated, keysVersion]);
  

  const personalAgents = useMemo(
    () => agents.filter((agent) => agent.type === 'personal'),
    [agents],
  );
  const systemAgents = useMemo(
    () => agents.filter((agent) => agent.type === 'system'),
    [agents],
  );

  const modalAgent = newlyCreatedKey ? agents.find((a) => a.id === newlyCreatedKey.agentId) : null;

  async function refreshAgents() {
    const next = await agentsService.list();
    setAgents(next);
  }

  async function handleCreateAgent() {
    if (!newAgentName.trim()) {
      return;
    }

    setCreating(true);
    try {
      await agentsService.create(newAgentName.trim(), newAgentDescription.trim() || undefined);
      setNewAgentName('');
      setNewAgentDescription('');
      setRegisterOpen(false);
      await refreshAgents();
      success('Agent created');
    } catch (err) {
      error('Failed to create agent', err instanceof Error ? err.message : undefined);
    } finally {
      setCreating(false);
    }
  }

  async function handleDeleteAgent(agent: Agent) {
    if (!window.confirm(`Delete agent "${agent.name}"?`)) {
      return;
    }

    try {
      await agentsService.delete(agent.id);
      await refreshAgents();
      success('Agent deleted');
    } catch (err) {
      error('Failed to delete agent', err instanceof Error ? err.message : undefined);
    }
  }

  async function handleGenerateKey(agent: Agent) {
    setGeneratingForAgentId(agent.id);
    try {
      const result = await agentsService.createToken(agent.id, `${agent.name} API Key`);
      setNewlyCreatedKey({ agentId: agent.id, key: result.key });
      setKeysVersion((value) => value + 1);
      success('Agent API key created');
    } catch (err) {
      error('Failed to create agent API key', err instanceof Error ? err.message : undefined);
    } finally {
      setGeneratingForAgentId(null);
    }
  }

  async function handleRevokeKey(agent: Agent, tokenId: string) {
    if (!window.confirm(`Revoke API key for "${agent.name}"?`)) {
      return;
    }

    try {
      await agentsService.revokeToken(agent.id, tokenId);
      setNewlyCreatedKey((current) => (current?.agentId === agent.id ? null : current));
      setKeysVersion((value) => value + 1);
      success('Agent API key revoked');
    } catch (err) {
      error('Failed to revoke agent API key', err instanceof Error ? err.message : undefined);
    }
  }

  if (authLoading || !isAuthenticated) {
    return (
      <ClientLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        </div>
      </ClientLayout>
    );
  }

  return (
    <ClientLayout>
      <div className="px-6 lg:px-8 py-8">
        <ContentContainer>
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">Agents</h1>
              <p className="text-sm text-gray-500 mt-1">
                Register personal agents, review built-in system agents, and issue agent-linked API keys.
              </p>
            </div>
            <Button onClick={() => setRegisterOpen((open) => !open)}>
              <Plus className="w-4 h-4 mr-1" />
              Register Agent
            </Button>
          </div>

          {registerOpen && (
            <div className="mb-8 p-4 border border-gray-200 rounded-sm bg-gray-50 space-y-3">
              <Input
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                placeholder="Agent name"
                disabled={creating}
              />
              <Input
                value={newAgentDescription}
                onChange={(e) => setNewAgentDescription(e.target.value)}
                placeholder="Description (optional)"
                disabled={creating}
              />
              <div className="flex gap-2">
                <Button onClick={handleCreateAgent} disabled={creating || !newAgentName.trim()}>
                  {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  {creating ? 'Creating...' : 'Create'}
                </Button>
                <Button variant="outline" onClick={() => setRegisterOpen(false)} disabled={creating}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="space-y-8">
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Bot className="w-4 h-4 text-gray-500" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">System Agents</h2>
                </div>
                <div className="space-y-3">
                  {systemAgents.map((agent) => (
                    <Link key={agent.id} to={`/agents/${agent.id}`} className="block border border-gray-200 rounded-sm p-4 bg-white hover:bg-gray-50 transition-colors cursor-pointer">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-gray-900">{agent.name}</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">system</span>
                      </div>
                      {agent.description ? <p className="text-sm text-gray-500">{agent.description}</p> : null}
                      <div className="flex flex-wrap gap-1 mt-3">
                        {[...new Set(agent.permissions.flatMap((permission) => permission.actions))].map((action) => (
                          <span key={action} className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-600">
                            {permissionLabel(action)}
                          </span>
                        ))}
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section>
                <div className="flex items-center gap-2 mb-3">
                  <KeyRound className="w-4 h-4 text-gray-500" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">Personal Agents</h2>
                </div>

                {personalAgents.length === 0 ? (
                  <div className="text-center py-10 border border-dashed border-gray-200 rounded-sm">
                    <p className="text-sm text-gray-500">No personal agents yet.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {personalAgents.map((agent) => {
                      const agentKeys = keysByAgent[agent.id] ?? [];

                      return (
                        <div key={agent.id} className="border border-gray-200 rounded-sm p-4 bg-white space-y-4">
                          <div className="flex items-start justify-between gap-4">
                            <Link to={`/agents/${agent.id}`} className="group flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h3 className="font-medium text-gray-900 group-hover:underline">{agent.name}</h3>
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  agent.status === 'active' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                                }`}>
                                  {agent.status}
                                </span>
                              </div>
                              {agent.description ? <p className="text-sm text-gray-500 mt-1">{agent.description}</p> : null}
                            </Link>
                            <div className="flex items-center gap-2">
                              <Button variant="outline" onClick={() => handleDeleteAgent(agent)}>
                                <Trash2 className="w-4 h-4 mr-1" />
                                Delete
                              </Button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500 shrink-0">Agent ID</span>
                            <code className="text-xs bg-gray-100 border border-gray-200 rounded px-2 py-0.5 font-mono text-gray-600 flex-1 min-w-0 break-all">{agent.id}</code>
                            <CopyButton text={agent.id} />
                          </div>

                          <div>
                            <div className="flex items-center justify-between gap-4 mb-2">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">API Keys</p>
                              <Button
                                size="sm"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleGenerateKey(agent); }}
                                disabled={generatingForAgentId === agent.id}
                              >
                                {generatingForAgentId === agent.id ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                                Generate Key
                              </Button>
                            </div>

                            {agentKeys.length === 0 ? (
                              <p className="text-sm text-gray-400">No agent-linked API keys yet.</p>
                            ) : (
                              <div className="border border-gray-200 rounded-sm overflow-hidden">
                                <table className="w-full text-sm">
                                  <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                      <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Name</th>
                                      <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Key</th>
                                      <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Created</th>
                                      <th className="text-left px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Last Used</th>
                                      <th className="text-right px-4 py-2 font-medium text-gray-500 text-xs uppercase tracking-wider">Actions</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {agentKeys.map((key) => (
                                      <tr key={key.id} className="border-b border-gray-100 last:border-b-0">
                                        <td className="px-4 py-2 text-gray-900">{key.name || 'Unnamed'}</td>
                                        <td className="px-4 py-2 font-mono text-xs text-gray-500">{maskKey(key.start)}</td>
                                        <td className="px-4 py-2 text-gray-500">{formatDate(key.createdAt)}</td>
                                        <td className="px-4 py-2 text-gray-500">{formatDate(key.lastUsedAt)}</td>
                                        <td className="px-4 py-2 text-right">
                                          <button
                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRevokeKey(agent, key.id); }}
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              <hr className="border-gray-200" />
              <section>
                <div className="mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-1">Setup Instructions</h2>
                  <p className="text-sm text-gray-500">
                    Connect a personal agent to Index Network using any platform below. Copy your Agent ID from the card above, then generate and copy an API key.
                  </p>
                </div>
                <SetupInstructions />
              </section>
            </div>
          )}
        </ContentContainer>
      </div>

      {newlyCreatedKey ? (
        <ApiKeyCreatedModal
          agentName={modalAgent?.name ?? 'Agent'}
          agentId={newlyCreatedKey.agentId}
          apiKey={newlyCreatedKey.key}
          onClose={() => setNewlyCreatedKey(null)}
        />
      ) : null}
    </ClientLayout>
  );
}

export const Component = AgentsPage;
