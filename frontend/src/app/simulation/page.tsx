"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Search, Users, FileText, Shield, UserCheck } from 'lucide-react';
import { 
  initializeMarketsForResults, 
  calculateStake, 
  processAgentDrop, 
  processAutoStaking, 
  processMarketResolution, 
  type MarketState, 
  type Agent, 
  type SearchResult 
} from '@/services/lmsr';

const IndexNetworkSimulation = () => {
  // Initial search results
  const initialResults: SearchResult[] = useMemo(() => [
    { id: 'res1', name: 'Matthew Mandel', title: 'Investor at USV', location: 'New York, NY', avatar: '👨‍💼', mutual: 'Nick Grossman' },
    { id: 'res2', name: 'Alexa Grabelle', title: 'Investor at Bessemer Venture Partners', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Jack O\'Brien, Sophy Li' },
    { id: 'res3', name: 'Alexander Chen', title: 'Investor at General Catalyst', location: 'New York, NY', avatar: '👨‍💼', mutual: 'Sophy Li' },
    { id: 'res4', name: 'Irene Gendelman', title: 'Investor at Avid Ventures', location: 'New York, NY', avatar: '👩‍💼', mutual: '' },
    { id: 'res5', name: 'Alara Dinc', title: 'Investor @ TIA Ventures', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Aylin Sahin, Samet Ozkale' },
    { id: 'res6', name: 'Allie Molner', title: 'Investor at Torch Capital', location: 'New York, NY', avatar: '👩‍💼', mutual: 'Sophy Li' },
  ], []);

  // Available agents with their own budgets
  const initialAgents: Agent[] = [
    { 
      id: 'agent1', 
      name: 'Consensys Network Manager', 
      description: 'Identifies compatible activity and complementary needs', 
      icon: <Users size={20} />, 
      color: 'bg-blue-100', 
      target: ['res1', 'res3', 'res5'], 
      budget: 150,
      triggers: [
        {
          type: 'fundraising',
          condition: (result) => result.title.toLowerCase().includes('raising') || result.title.toLowerCase().includes('funding')
        },
        {
          type: 'hiring',
          condition: (result) => result.title.toLowerCase().includes('hiring') || result.title.toLowerCase().includes('joining')
        },
        {
          type: 'partnership',
          condition: (result) => result.title.toLowerCase().includes('partnership') || result.title.toLowerCase().includes('collaboration')
        }
      ],
      audience: ['Consensys Employees', 'Portfolio Companies', 'Alumni Network']
    },
    { 
      id: 'agent2', 
      name: 'BuilderCred', 
      description: 'Evaluates technical contributions and open-source work', 
      icon: <FileText size={20} />, 
      color: 'bg-purple-100', 
      target: ['res2', 'res4'], 
      budget: 120,
      triggers: [
        {
          type: 'developer_search',
          condition: (result) => result.title.toLowerCase().includes('developer') || result.title.toLowerCase().includes('engineer')
        },
        {
          type: 'technical_partnership',
          condition: (result) => result.title.toLowerCase().includes('technical') || result.title.toLowerCase().includes('integration')
        }
      ],
      audience: ['Everyone']
    },
    { 
      id: 'agent3', 
      name: 'Tethics & Chill', 
      description: 'Identifies alignment with privacy and ethical AI', 
      icon: <Shield size={20} />, 
      color: 'bg-green-100', 
      target: ['res1', 'res6'], 
      budget: 100,
      triggers: [
        {
          type: 'privacy_tech',
          condition: (result) => result.title.toLowerCase().includes('privacy') || result.title.toLowerCase().includes('decentralization')
        },
        {
          type: 'ethical_ai',
          condition: (result) => result.title.toLowerCase().includes('ai') || result.title.toLowerCase().includes('ethics')
        }
      ],
      audience: ['Tethics & Chill Members']
    }
  ];

  const [searchResults, setSearchResults] = useState<SearchResult[]>(initialResults);
  const [draggedAgent, setDraggedAgent] = useState<Agent | null>(null);
  const [availableAgents, setAvailableAgents] = useState<Agent[]>(initialAgents);
  const [searchQuery, setSearchQuery] = useState('investor');
  const [personMarkets, setPersonMarkets] = useState<Record<string, MarketState>>({});
  const [resolvedPeople, setResolvedPeople] = useState<Record<string, boolean>>({});
  const [processedAutoStakes, setProcessedAutoStakes] = useState<Set<string>>(new Set());

  // Initialize market for each person
  useEffect(() => {
    const markets = initializeMarketsForResults(initialResults);
    setPersonMarkets(markets);
  }, [initialResults]);

  // Render market info for a person
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

  const handleDragStart = (agent: Agent) => {
    setDraggedAgent(agent);
  };

  const handleDragEnd = () => {
    setDraggedAgent(null);
  };

  // Handle agent drop using service function
  const handleDrop = (resultId: string, outcome: 'YES' | 'NO') => {
    if (!draggedAgent) return;
    
    const dropResult = processAgentDrop(
      draggedAgent,
      resultId,
      outcome,
      availableAgents,
      personMarkets,
      searchResults
    );
    
    if (dropResult) {
      setAvailableAgents(dropResult.updatedAgents);
      setPersonMarkets(dropResult.updatedMarkets);
      setSearchResults(dropResult.updatedResults);
    }
  };

  // Handle connect using service function
  const handleConnect = (personId: string) => {
    const resolutionResult = processMarketResolution(
      personId,
      personMarkets,
      searchResults,
      availableAgents
    );
    
    if (resolutionResult) {
      setAvailableAgents(resolutionResult.updatedAgents);
      setResolvedPeople(prev => ({ ...prev, [personId]: true }));
    }
  };

  // Auto-staking using service function - run only once per result
  useEffect(() => {
    searchResults.forEach(result => {
      // Create unique key for each agent-result combination that could be auto-staked
      availableAgents.forEach(agent => {
        const autoStakeKey = `${agent.id}-${result.id}`;
        
        // Skip if already processed this combination
        if (processedAutoStakes.has(autoStakeKey)) return;
        
        // Check if agent has triggers and meets conditions
        if (!agent.triggers) return;
        const triggered = agent.triggers.some(trigger => trigger.condition(result));
        
        if (triggered && agent.budget >= calculateStake(0.8) && agent.stakedIn !== result.id) {
          // Mark this combination as processed
          setProcessedAutoStakes(prev => new Set(prev).add(autoStakeKey));
          
          // Process the auto-staking
          const autoStakingResult = processAutoStaking(
            result,
            availableAgents,
            personMarkets,
            searchResults
          );
          
          setAvailableAgents(autoStakingResult.updatedAgents);
          setPersonMarkets(autoStakingResult.updatedMarkets);
          setSearchResults(autoStakingResult.updatedResults);
        }
      });
    });
  }, [initialResults]); // Only run once when component mounts

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
              Results for &ldquo;{searchQuery}&rdquo;
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