import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bot, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react';

import ClientLayout from '@/components/ClientLayout';
import { ContentContainer } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  const systemAgents = useMemo(
    () => agents.filter((agent) => agent.type === 'system'),
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
          <div className="flex items-start justify-between gap-4 mb-8">
            <div>
              <h1 className="text-2xl font-bold text-black font-ibm-plex-mono">Agents</h1>
              <p className="text-sm text-gray-500 mt-1">
                Register personal agents and pick which one handles negotiations. API keys live in{' '}
                <Link to="/settings" className="underline hover:text-gray-900">Settings</Link>.
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
                    {personalAgents.map((agent) => (
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
                              {agent.handleNegotiations ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">negotiator</span>
                              ) : null}
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
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </ContentContainer>
      </div>
    </ClientLayout>
  );
}

export const Component = AgentsPage;
