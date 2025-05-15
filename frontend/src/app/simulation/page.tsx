"use client";

import React, { useState, useEffect } from 'react';
import { Search, Users, FileText, Award, BarChart2, Shield, DollarSign, ChevronUp, UserCheck, X, Plus } from 'lucide-react';
import { initializeMarket, calculateStake, updateMarketState, calculateReward, calculatePenalty, type MarketState } from '@/services/lmsr';

interface SearchResult {
  id: string;
  name: string;
  title: string;
  location: string;
  avatar: string;
  mutual: string;
  yesAgents?: Agent[];
  noAgents?: Agent[];
  yesStaked?: number;
  noStaked?: number;
  totalStaked?: number;
  netAmount?: number;
}

interface Agent {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  target: string[];
  budget: number;
  stakedAmount?: number;
  position?: 'YES' | 'NO';
  stakedIn?: string; // ID of the person this agent is staked in
}

const IndexNetworkSimulation = () => {
  // Initial search results
  const initialResults: SearchResult[] = [
    { id: 'res1', name: 'Matthew Mandel', title: 'Investor at USV', location: 'New York, NY', avatar: '👨‍💼', mutual: 'Nick Grossman' },
    { id: 'res2', name: 'Alexa Grabelle', title: 'Investor at Bessemer Venture Partners', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Jack O\'Brien, Sophy Li' },
    { id: 'res3', name: 'Alexander Chen', title: 'Investor at General Catalyst', location: 'New York, NY', avatar: '👨‍💼', mutual: 'Sophy Li' },
    { id: 'res4', name: 'Irene Gendelman', title: 'Investor at Avid Ventures', location: 'New York, NY', avatar: '👩‍💼', mutual: '' },
    { id: 'res5', name: 'Alara Dinc', title: 'Investor @ TIA Ventures', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Aylin Sahin, Samet Ozkale' },
    { id: 'res6', name: 'Allie Molner', title: 'Investor at Torch Capital', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Sophy Li' },
  ];

  // Available agents with their own budgets
  const initialAgents: Agent[] = [
    { id: 'agent1', name: 'Relevancy Agent', description: 'Analyzes past investment patterns', icon: <BarChart2 size={20} />, color: 'bg-blue-100', target: ['res3', 'res5'], budget: 100 },
    { id: 'agent2', name: 'Reputation Agent', description: 'Evaluates professional reputation', icon: <Award size={20} />, color: 'bg-purple-100', target: ['res2', 'res4'], budget: 80 },
    { id: 'agent3', name: 'Due Diligence Agent', description: 'Checks investment thesis alignment', icon: <FileText size={20} />, color: 'bg-green-100', target: ['res1', 'res6'], budget: 120 },
    { id: 'agent4', name: 'Community Agent', description: 'Identifies common network connections', icon: <Users size={20} />, color: 'bg-yellow-100', target: ['res2', 'res5'], budget: 60 },
    { id: 'agent5', name: 'Sales Network Agent', description: 'Finds shared business opportunities', icon: <DollarSign size={20} />, color: 'bg-red-100', target: ['res3', 'res4'], budget: 90 },
    { id: 'agent6', name: 'Value Promoter', description: 'Highlights shared values and missions', icon: <Shield size={20} />, color: 'bg-indigo-100', target: ['res1', 'res6'], budget: 110 },
  ];

  const [searchResults, setSearchResults] = useState<SearchResult[]>(initialResults);
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>(initialAgents);
  const [stakeAmount, setStakeAmount] = useState(100);
  const [searchQuery, setSearchQuery] = useState('investor');
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);

  // Add market state
  const [marketState, setMarketState] = useState<MarketState>(initializeMarket('simulation'));

  const [personMarkets, setPersonMarkets] = useState<Record<string, MarketState>>({});

  const [resolvedPeople, setResolvedPeople] = useState<Record<string, boolean>>({});

  // Initialize market for each person
  useEffect(() => {
    const markets: Record<string, MarketState> = {};
    initialResults.forEach(result => {
      markets[result.id] = initializeMarket(result.id);
    });
    setPersonMarkets(markets);
  }, []);

  const addAgent = (agent: Agent) => {
    // Only add if not already in active agents and have enough budget
    if (!availableAgents.some(a => a.id === agent.id) && agent.budget >= 20) {
      setAvailableAgents([...availableAgents, agent]);
    }
  };

  const removeAgent = (agentId: string) => {
    // Return the agent's stake to their budget when removed
    const agent = availableAgents.find(a => a.id === agentId);
    if (agent) {
      const updatedAgent = {
        ...agent,
        budget: agent.budget + 20 // Return the stake amount
      };
      setAvailableAgents(availableAgents.filter(a => a.id !== agentId));
      // Update the agent in availableAgents
      const agentIndex = availableAgents.findIndex(a => a.id === agentId);
      if (agentIndex !== -1) {
        availableAgents[agentIndex] = updatedAgent;
      }
    }
  };

  // Remove IDX coin and update market info to show YES/NO prices and shares per person
  // Add function to render market info for a person
  const renderPersonMarketInfo = (personId: string) => {
    const market = personMarkets[personId];
    if (!market) return null;
    return (
      <div className="mb-2 p-2 bg-blue-50 rounded border border-blue-200">
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="font-semibold text-gray-700">YES Price:</span>
          <span className="font-bold text-green-700">{(market.price * 100).toFixed(1)}¢</span>
        </div>
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="font-semibold text-gray-700">NO Price:</span>
          <span className="font-bold text-red-700">{((1 - market.price) * 100).toFixed(1)}¢</span>
        </div>
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="font-semibold text-gray-700">Volume:</span>
          <span className="font-bold text-blue-700">{market.volume.toLocaleString()}</span>
        </div>
        <div className="flex justify-between items-center text-xs mb-1">
          <span className="font-semibold text-gray-700">YES Shares:</span>
          <span className="font-bold text-green-700">{market.yesShares}</span>
        </div>
        <div className="flex justify-between items-center text-xs">
          <span className="font-semibold text-gray-700">NO Shares:</span>
          <span className="font-bold text-red-700">{market.noShares}</span>
        </div>
      </div>
    );
  };

  // Add function to toggle agent prediction
  const toggleAgentPrediction = (agentId: string) => {
    setAvailableAgents(prev => prev.map(agent => {
      if (agent.id === agentId) {
        return {
          ...agent,
          position: agent.position === 'YES' ? 'NO' : 'YES'
        };
      }
      return agent;
    }));
  };

  const handleDragStart = (agent: Agent) => {
    setDraggedAgent(agent);
  };

  const handleDragEnd = () => {
    setDraggedAgent(null);
  };

  // Update handleDrop to update the LMSR market for the person
  const handleDrop = (resultId: string, outcome: 'YES' | 'NO') => {
    if (!draggedAgent) return;
    const agent = availableAgents.find(a => a.id === draggedAgent.id);
    if (!agent) return;
    // Calculate stake based on agent's confidence
    const stake = calculateStake(0.8);
    // Only proceed if agent has enough budget
    if (agent.budget < stake) return;
    // Update agent's state
    const updatedAgent = {
      ...agent,
      budget: agent.budget - stake,
      stakedAmount: stake,
      position: outcome,
      stakedIn: resultId
    };
    // Update available agents
    setAvailableAgents(prev => prev.map(a => 
      a.id === agent.id ? updatedAgent : a
    ));
    // Update the LMSR market for this person
    setPersonMarkets(prev => {
      const currentMarket = prev[resultId];
      if (!currentMarket) return prev;
      // Simulate a market action
      const action = {
        type: 'BUY' as const,
        amount: stake,
        agentId: agent.id,
        confidence: 0.8,
        outcome
      };
      const newMarket = updateMarketState(currentMarket, action);
      return { ...prev, [resultId]: newMarket };
    });
    // Update search results (for agent display)
    setSearchResults(prev => {
      const newResults = prev.map(result => {
        if (result.id === resultId) {
          const yesAgents = outcome === 'YES' 
            ? [...(result.yesAgents || []), updatedAgent]
            : (result.yesAgents || []);
          const noAgents = outcome === 'NO'
            ? [...(result.noAgents || []), updatedAgent]
            : (result.noAgents || []);
          const yesStaked = yesAgents.reduce((sum, a) => sum + (a.stakedAmount || 0), 0);
          const noStaked = noAgents.reduce((sum, a) => sum + (a.stakedAmount || 0), 0);
          const totalStaked = yesStaked + noStaked;
          const netAmount = yesStaked - noStaked;
          return {
            ...result,
            yesAgents,
            noAgents,
            yesStaked,
            noStaked,
            totalStaked,
            netAmount
          };
        }
        return result;
      });
      // Sort by net amount (YES - NO)
      return newResults.sort((a, b) => (b.netAmount || 0) - (a.netAmount || 0));
    });
  };

  // Handle connect (resolution)
  const handleConnect = (personId: string) => {
    const market = personMarkets[personId];
    if (!market) return;
    setAvailableAgents(prevAgents => {
      // Find YES and NO agents for this person
      const result = searchResults.find(r => r.id === personId);
      if (!result) return prevAgents;
      const yesAgents = result.yesAgents || [];
      const noAgents = result.noAgents || [];
      // Reward YES agents, penalize NO agents
      return prevAgents.map(agent => {
        // YES
        const yesAgent = yesAgents.find(a => a.id === agent.id);
        if (yesAgent && yesAgent.stakedAmount) {
          const reward = calculateReward(market, yesAgent.stakedAmount, 'YES');
          return { ...agent, budget: agent.budget + reward };
        }
        // NO
        const noAgent = noAgents.find(a => a.id === agent.id);
        if (noAgent && noAgent.stakedAmount) {
          const penalty = calculatePenalty(market, noAgent.stakedAmount, 'NO');
          return { ...agent, budget: agent.budget - penalty };
        }
        return agent;
      });
    });
    setResolvedPeople(prev => ({ ...prev, [personId]: true }));
  };

  return (
    <div className="flex  bg-gray-50">
      {/* Main content */}
      <div className="flex-1 p-4 overflow-y-auto">
        <div className="mb-4">
          <div className="flex items-center p-2 bg-white rounded-lg shadow mb-4">
            <Search className="text-gray-400 mr-2" size={20} />
            <input 
              type="text" 
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 outline-none text-gray-800"
              placeholder="Search..."
            />
            <button className="bg-blue-500 text-white px-3 py-1 rounded-md text-sm">
              Search
            </button>
          </div>
          
          <div className="flex justify-between items-center mb-2">
            <div className="text-gray-800 font-medium">
              Results for "{searchQuery}"
            </div>
            <div className="text-sm text-gray-600">
              {searchResults.length} people found
            </div>
          </div>
        </div>
        
        {/* Search results */}
        <div className="space-y-2">
          {searchResults.map((result, index) => {
            const wasReordered = initialResults.findIndex(r => r.id === result.id) !== index;
            const isResolved = resolvedPeople[result.id];
            return (
              <div 
                key={result.id} 
                className={`p-4 bg-white rounded-lg shadow ${wasReordered ? 'border-l-4 border-green-500' : ''}`}
              >
                <div className="flex items-start">
                  <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-xl mr-3">
                    {result.avatar}
                  </div>
                  <div className="flex-1">
                    <div className="flex justify-between items-center">
                      <h3 className="font-medium text-gray-900">{result.name}</h3>
                      {/* Connect button or Connected state */}
                      {isResolved ? (
                        <span className="ml-2 px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">Connected!</span>
                      ) : (
                        <button
                          className="ml-2 px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                          onClick={() => handleConnect(result.id)}
                        >
                          Connect
                        </button>
                      )}
                    </div>
                    <div className="text-sm text-gray-700">{result.title}</div>
                    <div className="text-sm text-gray-600">{result.location}</div>
                    {result.mutual && (
                      <div className="text-xs text-gray-500 mt-1 flex items-center">
                        <UserCheck size={12} className="mr-1" />
                        {result.mutual}
                      </div>
                    )}
                    {/* Market info for this person */}
                    {renderPersonMarketInfo(result.id)}
                    {/* Yes/No boxes */}
                    <div className="mt-4 flex gap-4">
                      <div 
                        className={`flex-1 p-3 rounded-lg border-2 min-h-[100px] ${
                          draggedAgent ? 'border-green-500 bg-green-50' : 'border-gray-200'
                        } ${isResolved ? 'opacity-50 pointer-events-none' : ''}`}
                        onDragOver={e => !isResolved && e.preventDefault()}
                        onDrop={() => !isResolved && handleDrop(result.id, 'YES')}
                      >
                        <div className="text-center font-medium text-green-700 mb-2">YES</div>
                        <div className="text-center text-sm text-gray-600 mb-2">
                          {result.yesStaked || 0} staked
                        </div>
                        <div className="space-y-2">
                          {result.yesAgents?.map(agent => (
                            <div 
                              key={agent.id}
                              className={`${agent.color} p-2 rounded-lg flex items-center justify-between`}
                            >
                              <div className="flex items-center">
                                <div className="mr-2">{agent.icon}</div>
                                <div>
                                  <div className="text-xs font-medium text-gray-900">{agent.name}</div>
                                  <div className="text-xs text-gray-600">{agent.stakedAmount} </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div 
                        className={`flex-1 p-3 rounded-lg border-2 min-h-[100px] ${
                          draggedAgent ? 'border-red-500 bg-red-50' : 'border-gray-200'
                        } ${isResolved ? 'opacity-50 pointer-events-none' : ''}`}
                        onDragOver={e => !isResolved && e.preventDefault()}
                        onDrop={() => !isResolved && handleDrop(result.id, 'NO')}
                      >
                        <div className="text-center font-medium text-red-700 mb-2">NO</div>
                        <div className="text-center text-sm text-gray-600 mb-2">
                          {result.noStaked || 0} staked
                        </div>
                        <div className="space-y-2">
                          {result.noAgents?.map(agent => (
                            <div 
                              key={agent.id}
                              className={`${agent.color} p-2 rounded-lg flex items-center justify-between`}
                            >
                              <div className="flex items-center">
                                <div className="mr-2">{agent.icon}</div>
                                <div>
                                  <div className="text-xs font-medium text-gray-900">{agent.name}</div>
                                  <div className="text-xs text-gray-600">{agent.stakedAmount} </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {/* Right sidebar */}
      <div className="w-80 bg-white shadow-md p-4 border-l">
        <div className="mb-4">
          <h2 className="font-bold text-lg mb-2 text-gray-900">Available Agents</h2>
          <div className="text-sm text-gray-700 mb-4">
            Drag and drop agents to stake positions
          </div>
        </div>
        
        {/* Available agents */}
        <div className="space-y-2">
          {availableAgents.map((agent) => {
            const stake = calculateStake(0.8);
            const canAfford = agent.budget >= stake;
            
            return (
              <div
                key={agent.id}
                draggable={canAfford}
                onDragStart={() => handleDragStart(agent)}
                onDragEnd={handleDragEnd}
                className={`${agent.color} p-2 rounded-lg ${
                  !canAfford ? 'opacity-50' : 'hover:shadow-md cursor-move'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="mr-2">{agent.icon}</div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{agent.name}</div>
                      <div className="text-xs text-gray-700">{agent.description}</div>
                      <div className="text-xs text-gray-600">Budget: {agent.budget} IDX</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default IndexNetworkSimulation;