import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react';

import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import SettingsTabs from '@/components/settings/SettingsTabs';
import { useAgents } from '@/contexts/APIContext';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import type { Agent } from '@/services/agents';

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
  const [selecting, setSelecting] = useState<string | null>(null);

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

  const personalAgents = useMemo(
    () => agents.filter((agent) => agent.type === 'external'),
    [agents],
  );

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

  async function handleSelectNegotiator(agent: Agent) {
    const next = !agent.handleNegotiations;
    setSelecting(agent.id);
    try {
      await agentsService.update(agent.id, { handleNegotiations: next });
      await refreshAgents();
      success(next ? `${agent.name} handles negotiations` : 'No agent handles negotiations');
    } catch (err) {
      error('Failed to set the negotiator', err instanceof Error ? err.message : undefined);
    } finally {
      setSelecting(null);
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
          <h1 className="text-2xl font-bold text-black font-ibm-plex-mono mb-8">Settings</h1>

          <SettingsTabs />

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <div className="max-w-3xl space-y-10">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                    Agents
                  </p>
                  <Button size="sm" onClick={() => setRegisterOpen((open) => !open)}>
                    <Plus className="w-4 h-4 mr-1" />
                    Register Agent
                  </Button>
                </div>

                <p className="text-xs text-gray-400 font-ibm-plex-mono">
                  Pick the one agent that handles your negotiations.
                </p>

                {registerOpen && (
                  <div className="border border-gray-200 rounded-sm bg-gray-50 p-4 space-y-3">
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
                      <Button size="sm" onClick={handleCreateAgent} disabled={creating || !newAgentName.trim()}>
                        {creating ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                        {creating ? 'Creating...' : 'Create'}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setRegisterOpen(false)} disabled={creating}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                <div className="border border-gray-200 rounded-sm overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                          Negotiator
                        </th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                          Agent
                        </th>
                        <th className="text-left px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                          Agent ID
                        </th>
                        <th className="text-right px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-gray-100 last:border-b-0">
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={false}
                            disabled
                            aria-label="Index Negotiator handles negotiations"
                            className="w-4 h-4 accent-black"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <span className="text-sm text-gray-700">Index Negotiator</span>
                          <span className="ml-2 text-xs text-gray-400 font-ibm-plex-mono">not yet active</span>
                          <p className="text-xs text-gray-400 font-ibm-plex-mono mt-0.5">
                            Hosted by Index. It does not run yet, so negotiations wait for your own agent.
                          </p>
                        </td>
                        <td className="px-4 py-2 text-xs text-gray-400 font-ibm-plex-mono">—</td>
                        <td className="px-4 py-2" />
                      </tr>

                      {personalAgents.map((agent) => (
                        <tr key={agent.id} className="border-b border-gray-100 last:border-b-0">
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={agent.handleNegotiations}
                              onChange={() => handleSelectNegotiator(agent)}
                              disabled={selecting !== null}
                              aria-label={`${agent.name} handles negotiations`}
                              className="w-4 h-4 accent-black disabled:cursor-not-allowed"
                            />
                          </td>
                          <td className="px-4 py-2">
                            <Link to={`/agents/${agent.id}`} className="text-sm text-gray-700 hover:underline">
                              {agent.name}
                            </Link>
                            <span className="ml-2 text-xs text-gray-400 font-ibm-plex-mono">{agent.status}</span>
                            {agent.description ? (
                              <p className="text-xs text-gray-400 font-ibm-plex-mono mt-0.5">{agent.description}</p>
                            ) : null}
                          </td>
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-1">
                              <code className="font-mono text-xs text-gray-500">{agent.id}</code>
                              <CopyButton text={agent.id} />
                            </div>
                          </td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => handleDeleteAgent(agent)}
                              className="text-gray-400 hover:text-red-500 transition-colors p-1"
                              title="Delete agent"
                              aria-label="Delete agent"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {personalAgents.length === 0 ? (
                  <p className="text-xs text-gray-400 font-ibm-plex-mono">No personal agents yet.</p>
                ) : null}
              </div>
            </div>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = AgentsPage;
