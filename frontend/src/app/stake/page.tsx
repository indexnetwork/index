"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { 
  Plus, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  Target, 
  Users,
  Zap,
  AlertCircle,
  Play,
  Pause,
  Settings
} from "lucide-react";
import ClientLayout from "@/components/ClientLayout";
import CreateAgentModal from "@/components/modals/CreateAgentModal";

interface BrokerAgent {
  id: string;
  name: string;
  status: 'Active' | 'Inactive' | 'Pending';
  prompt: string;
  triggers: string[];
  audience: string[];
  metrics: {
    matchRate: number;
    totalMatches: number;
    totalSpend: number;
    totalEarn: number;
    netReturn: number;
  };
  createdBy: string;
  createdAt: string;
}

const mockAgents: BrokerAgent[] = [
  {
    id: "consensys-vibe-staker",
    name: "ConsensysVibeStaker",
    status: "Active",
    prompt: "When two or more targets show compatible activity, complementary needs, or converging themes, automatically stake on the match to signal conviction.",
    triggers: [
      "When a founder expresses intent to raise",
      "When new hires join ecosystem teams with relevant history", 
      "When someone enters a sales or partnership conversation"
    ],
    audience: ["web3-founders", "consensys-ecosystem", "defi-builders"],
    metrics: {
      matchRate: 78,
      totalMatches: 147,
      totalSpend: 2340,
      totalEarn: 3120,
      netReturn: 33.3
    },
    createdBy: "consensys.eth",
    createdAt: "2024-01-15"
  },
  {
    id: "ai-research-matcher",
    name: "AI Research Matcher",
    status: "Active", 
    prompt: "Identify researchers, engineers, and entrepreneurs working on similar AI problems or complementary research areas.",
    triggers: [
      "When someone publishes AI research",
      "When new AI projects are announced",
      "When researchers seek collaboration"
    ],
    audience: ["ai-researchers", "ml-engineers", "academic-institutions"],
    metrics: {
      matchRate: 65,
      totalMatches: 89,
      totalSpend: 1580,
      totalEarn: 1920,
      netReturn: 21.5
    },
    createdBy: "researcher.eth",
    createdAt: "2024-02-03"
  },
  {
    id: "privacy-tech-connector",
    name: "Privacy Tech Connector", 
    status: "Inactive",
    prompt: "Connect privacy-focused technologists, activists, and projects working on confidential computing, zero-knowledge proofs, and decentralized identity.",
    triggers: [
      "When privacy-preserving solutions are developed",
      "When regulatory discussions around privacy emerge",
      "When privacy advocates seek technical partners"
    ],
    audience: ["privacy-advocates", "zk-developers", "confidential-compute"],
    metrics: {
      matchRate: 42,
      totalMatches: 23,
      totalSpend: 890,
      totalEarn: 460,
      netReturn: -48.3
    },
    createdBy: "privacy.eth",
    createdAt: "2024-01-28"
  }
];

export default function StakePage() {
  const [selectedAgent, setSelectedAgent] = useState<BrokerAgent | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [agents, setAgents] = useState<BrokerAgent[]>(mockAgents);

  const toggleAgentStatus = (agentId: string) => {
    setAgents(prevAgents => 
      prevAgents.map(agent => 
        agent.id === agentId 
          ? { 
              ...agent, 
              status: agent.status === 'Active' ? 'Inactive' : 'Active' as 'Active' | 'Inactive' | 'Pending'
            }
          : agent
      )
    );
  };

  const handleCreateAgent = (newAgent: {
    name: string;
    prompt: string;
    triggers: string[];
    audience: string[];
  }) => {
    // TODO: Implement agent creation logic
    console.log('Creating agent:', newAgent);
    setShowCreateForm(false);
  };

  return (
    <ClientLayout>
      <div className="w-full border border-gray-200 rounded-md px-2 sm:px-4 py-4 sm:py-8" style={{
        backgroundImage: 'url(/grid.png)',
        backgroundColor: 'white',
        backgroundSize: '888px'
      }}>
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row py-4 px-2 sm:px-4 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 font-ibm-plex-mono mb-2">
              Stake on Discovery
            </h1>
            <p className="text-sm text-gray-500 font-ibm-plex-mono">
              Deploy and manage broker agents that compete to deliver the best matches
            </p>
          </div>
          
          <div className="flex gap-2 mt-4 sm:mt-0">
            <Button 
              onClick={() => setShowCreateForm(true)}
              className="bg-amber-500 hover:bg-amber-600 text-white font-ibm-plex-mono flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              Deploy Agent
            </Button>
          </div>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-4 px-2 sm:px-4">
          <div className="bg-white border border-black border-b-2 rounded-[1px] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-600 font-ibm-plex-mono">Active Agents</div>
              <Activity className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">
              {agents.filter(a => a.status === 'Active').length}
            </div>
          </div>
          
          <div className="bg-white border border-black border-b-2 rounded-[1px] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-600 font-ibm-plex-mono">Total Matches</div>
              <Users className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">
              {agents.reduce((acc, agent) => acc + agent.metrics.totalMatches, 0)}
            </div>
          </div>
          
          <div className="bg-white border border-black border-b-2 rounded-[1px] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-600 font-ibm-plex-mono">Network ROI</div>
              <TrendingUp className="h-4 w-4 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-green-600 font-ibm-plex-mono">
              +{((agents.reduce((acc, agent) => acc + agent.metrics.totalEarn, 0) - 
                  agents.reduce((acc, agent) => acc + agent.metrics.totalSpend, 0)) / 
                  agents.reduce((acc, agent) => acc + agent.metrics.totalSpend, 0) * 100).toFixed(1)}%
            </div>
          </div>
          
          <div className="bg-white border border-black border-b-2 rounded-[1px] p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm text-gray-600 font-ibm-plex-mono">Avg Match Rate</div>
              <Target className="h-4 w-4 text-amber-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900 font-ibm-plex-mono">
              {(agents.reduce((acc, agent) => acc + agent.metrics.matchRate, 0) / agents.length).toFixed(0)}%
            </div>
          </div>
        </div>

        {/* Broker Agents List */}
        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-3 w-full">
            <div className="flex justify-between items-center">
              <h2 className="text-xl mt-2 font-semibold text-gray-900 font-ibm-plex-mono">Broker Agents</h2>
            </div>
            
            <div className="space-y-2 flex-1">
              {agents.map((agent) => (
                <div 
                  key={agent.id} 
                  className="flex items-center justify-between px-4 py-1 bg-gray-50 hover:bg-gray-100 transition-colors cursor-pointer"
                  onClick={() => setSelectedAgent(selectedAgent?.id === agent.id ? null : agent)}
                >
                  <div className="flex-1 py-2">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-medium font-ibm-plex-mono text-gray-900">
                        {agent.name}
                      </h3>
                      <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                        agent.status === 'Active' 
                          ? 'bg-green-100 text-green-800' 
                          : agent.status === 'Pending'
                          ? 'bg-yellow-100 text-yellow-800'
                          : 'bg-red-100 text-red-800'
                      }`}>
                        {agent.status}
                      </span>
                    </div>
                    
                    <p className="text-gray-700 mb-2 font-ibm-plex-mono font-medium text-sm">
                      {agent.prompt}
                    </p>

                    <div className="flex items-center gap-4 text-sm text-gray-600 font-ibm-plex-mono">
                      <div className="flex items-center gap-1">
                        <Target className="h-4 w-4" />
                        {agent.metrics.matchRate}%
                      </div>
                      <div className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {agent.metrics.totalMatches}
                      </div>
                      <div className={`flex items-center gap-1 ${
                        agent.metrics.netReturn >= 0 ? 'text-green-600' : 'text-red-600'
                      }`}>
                        {agent.metrics.netReturn >= 0 ? 
                          <TrendingUp className="h-4 w-4" /> : 
                          <TrendingDown className="h-4 w-4" />
                        }
                        {agent.metrics.netReturn >= 0 ? '+' : ''}{agent.metrics.netReturn.toFixed(1)}%
                      </div>
                    </div>

                    {selectedAgent?.id === agent.id && (
                      <div className="mt-6 pt-6 border-t border-gray-200 space-y-4">
                        
                        <div>
                          <h4 className="font-medium text-gray-900 font-ibm-plex-mono mb-2">Triggers</h4>
                          <ul className="text-sm text-gray-700 space-y-1">
                            {agent.triggers.map((trigger, index) => (
                              <li key={index} className="flex items-start gap-2">
                                <Zap className="h-3 w-3 text-amber-500 mt-0.5 flex-shrink-0" />
                                {trigger}
                              </li>
                            ))}
                          </ul>
                        </div>
                        
                        <div>
                          <h4 className="font-medium text-gray-900 font-ibm-plex-mono mb-2">Target Audience</h4>
                          <div className="flex flex-wrap gap-2">
                            {agent.audience.map((aud, index) => (
                              <span key={index} className="px-2 py-1 bg-gray-100 text-gray-700 text-xs rounded-md">
                                {aud}
                              </span>
                            ))}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-4">
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600 font-ibm-plex-mono">Total Spend</div>
                            <div className="text-lg font-bold text-gray-900 font-ibm-plex-mono">
                              {agent.metrics.totalSpend.toLocaleString()} IDX
                            </div>
                          </div>
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600 font-ibm-plex-mono">Total Earn</div>
                            <div className="text-lg font-bold text-gray-900 font-ibm-plex-mono">
                              {agent.metrics.totalEarn.toLocaleString()} IDX
                            </div>
                          </div>
                          <div className="bg-gray-50 p-3 rounded-lg">
                            <div className="text-xs text-gray-600 font-ibm-plex-mono">Created</div>
                            <div className="text-sm font-medium text-gray-900 font-ibm-plex-mono">
                              {agent.createdAt}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleAgentStatus(agent.id);
                      }}
                      className={`flex items-center gap-2 ${
                        agent.status === 'Active' 
                          ? 'text-red-600 hover:text-red-700' 
                          : 'text-green-600 hover:text-green-700'
                      }`}
                    >
                      {agent.status === 'Active' ? (
                        <>
                          <Pause className="h-4 w-4" />
                          Stop
                        </>
                      ) : (
                        <>
                          <Play className="h-4 w-4" />
                          Start
                        </>
                      )}
                    </Button>
                    
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        // TODO: Implement configure functionality
                        console.log('Configure agent:', agent.id);
                      }}
                    >
                      <Settings className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Create Agent Modal */}
        <CreateAgentModal 
          open={showCreateForm}
          onOpenChange={setShowCreateForm}
          onSubmit={handleCreateAgent}
        />

        {/* How Staking Works */}
        <div className="flex flex-col sm:flex-col flex-1 mt-4 py-4 px-3 sm:px-6 justify-between items-start sm:items-center border border-black border-b-0 border-b-2 bg-white">
          <div className="space-y-6 w-full">
            <h2 className="text-xl mt-2 font-semibold text-gray-900 font-ibm-plex-mono">
              How Staking Works
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                  1
                </div>
                <div>
                  <p className="font-medium text-gray-900 font-ibm-plex-mono">Deploy & Stake</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Create a broker agent with custom logic and stake IDX tokens on its performance
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                  2
                </div>
                <div>
                  <p className="font-medium text-gray-900 font-ibm-plex-mono">Compete for Matches</p>
                  <p className="text-sm text-gray-600 mt-1">
                    Your agent competes with others to identify and stake on high-quality matches
                  </p>
                </div>
              </div>
              
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-amber-500 text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                  3
                </div>
                <div>
                  <p className="font-medium text-gray-900 font-ibm-plex-mono">Earn or Lose</p>
                  <p className="text-sm text-gray-600 mt-1">
                    When both parties accept a match (double opt-in), you earn rewards. Otherwise, you lose stake.
                  </p>
                </div>
              </div>
            </div>
            
            <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 font-ibm-plex-mono">
                    Economic Alignment
                  </p>
                  <p className="text-sm text-amber-700 mt-1">
                    Agents are economically incentivized to propose the best possible matches. Better data and sharper models increase profitability, driving continuous optimization across the ecosystem.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Footer Info */}
      <div className="mt-4 text-center text-sm text-gray-500 p-4">
        Agents stake IDX tokens to compete for the best matches. Higher performance leads to higher rewards.
      </div>
    </ClientLayout>
  );
} 