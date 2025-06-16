// LMSR market parameters
const B = 1000; // Liquidity parameter
const FEE_RATE = 0.02; // 2% fee on trades

export interface MarketState {
  intentPairId: string;
  q: number; // Quantity of shares
  price: number; // Current price
  liquidity: number; // Current liquidity
  volume: number; // Total trading volume
  yesShares: number; // Total YES shares
  noShares: number; // Total NO shares
}

export interface MarketAction {
  type: 'BUY' | 'SELL';
  amount: number;
  agentId: string;
  confidence: number;
  outcome: 'YES' | 'NO'; // Which outcome to buy/sell
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
  target: string[];
  budget: number;
  stakedAmount?: number;
  position?: 'YES' | 'NO';
  stakedIn?: string;
  triggers?: {
    type: string;
    condition: (result: SearchResult) => boolean;
  }[];
  audience?: string[];
}

export interface SearchResult {
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

// Calculate the cost function for LMSR
function costFunction(q: number): number {
  return B * Math.log(Math.exp(q / B));
}

// Calculate the price function for LMSR
function priceFunction(q: number): number {
  return Math.exp(q / B) / (1 + Math.exp(q / B));
}

// Calculate the cost of a trade
export function calculateTradeCost(currentState: MarketState, action: MarketAction): number {
  const newQ = action.type === 'BUY' ? currentState.q + action.amount : currentState.q - action.amount;
  const cost = costFunction(newQ) - costFunction(currentState.q);
  const fee = Math.abs(cost) * FEE_RATE;
  return action.type === 'BUY' ? cost + fee : -cost + fee;
}

// Update market state after a trade
export function updateMarketState(currentState: MarketState, action: MarketAction): MarketState {
  const newQ = action.type === 'BUY' ? currentState.q + action.amount : currentState.q - action.amount;
  const newPrice = priceFunction(newQ);
  
  // Calculate trade cost based on the agent's stake
  const tradeCost = calculateTradeCost(currentState, action);
  
  // Update liquidity based on the trade cost and agent's stake
  const newLiquidity = action.type === 'BUY' 
    ? currentState.liquidity + action.amount  // Add agent's stake to liquidity
    : currentState.liquidity - action.amount; // Remove agent's stake from liquidity

  // Update shares based on the outcome
  const newYesShares = action.outcome === 'YES' 
    ? (action.type === 'BUY' ? currentState.yesShares + action.amount : currentState.yesShares - action.amount)
    : currentState.yesShares;
  
  const newNoShares = action.outcome === 'NO'
    ? (action.type === 'BUY' ? currentState.noShares + action.amount : currentState.noShares - action.amount)
    : currentState.noShares;

  return {
    intentPairId: currentState.intentPairId,
    q: newQ,
    price: newPrice,
    liquidity: newLiquidity,
    volume: currentState.volume + Math.abs(tradeCost),
    yesShares: newYesShares,
    noShares: newNoShares
  };
}

// Calculate the confidence-weighted stake for an agent
export function calculateStake(confidence: number, baseStake: number = 20): number {
  return Math.floor(baseStake * confidence);
}

// Calculate payouts for market resolution (zero-sum)
export function calculateMarketPayouts(
  marketState: MarketState, 
  yesStakes: { agentId: string; stake: number }[],
  noStakes: { agentId: string; stake: number }[],
  outcome: 'YES' | 'NO'
): { agentId: string; payout: number }[] {
  const totalYesStake = yesStakes.reduce((sum, s) => sum + s.stake, 0);
  const totalNoStake = noStakes.reduce((sum, s) => sum + s.stake, 0);
  const totalStake = totalYesStake + totalNoStake;
  
  if (totalStake === 0) return [];
  
  const payouts: { agentId: string; payout: number }[] = [];
  
  if (outcome === 'YES') {
    // YES holders split all the money proportionally to their stakes
    yesStakes.forEach(yesStake => {
      const proportion = yesStake.stake / totalYesStake;
      const payout = totalStake * proportion;
      payouts.push({ agentId: yesStake.agentId, payout });
    });
    // NO holders get nothing (they lose their stakes)
    noStakes.forEach(noStake => {
      payouts.push({ agentId: noStake.agentId, payout: 0 });
    });
  } else {
    // NO holders split all the money proportionally to their stakes
    noStakes.forEach(noStake => {
      const proportion = noStake.stake / totalNoStake;
      const payout = totalStake * proportion;
      payouts.push({ agentId: noStake.agentId, payout });
    });
    // YES holders get nothing (they lose their stakes)
    yesStakes.forEach(yesStake => {
      payouts.push({ agentId: yesStake.agentId, payout: 0 });
    });
  }
  
  return payouts;
}

// Calculate the reward for a successful match (DEPRECATED - use calculateMarketPayouts instead)
export function calculateReward(marketState: MarketState, stake: number, outcome: 'YES' | 'NO'): number {
  const successMultiplier = 1.5; // Reward multiplier for successful matches
  const price = outcome === 'YES' ? marketState.price : 1 - marketState.price;
  return stake * successMultiplier * (1 + price);
}

// Calculate the penalty for an unsuccessful match (DEPRECATED - use calculateMarketPayouts instead)
export function calculatePenalty(marketState: MarketState, stake: number, outcome: 'YES' | 'NO'): number {
  const penaltyMultiplier = 0.5; // Penalty multiplier for unsuccessful matches
  const price = outcome === 'YES' ? marketState.price : 1 - marketState.price;
  return stake * penaltyMultiplier * (1 - price);
}

// Initialize a new market for an intent pair
export function initializeMarket(intentPairId: string): MarketState {
  return {
    intentPairId,
    q: 0,
    price: 0.5, // Start at 50% probability
    liquidity: B,
    volume: 0,
    yesShares: 0,
    noShares: 0
  };
}

// New business logic functions

export interface AgentDropResult {
  updatedAgents: Agent[];
  updatedMarkets: Record<string, MarketState>;
  updatedResults: SearchResult[];
}

export function processAgentDrop(
  draggedAgent: Agent,
  resultId: string,
  outcome: 'YES' | 'NO',
  availableAgents: Agent[],
  personMarkets: Record<string, MarketState>,
  searchResults: SearchResult[]
): AgentDropResult | null {
  const agent = availableAgents.find(a => a.id === draggedAgent.id);
  if (!agent) return null;
  
  // Calculate stake based on agent's confidence
  const stake = calculateStake(0.8);
  
  // Only proceed if agent has enough budget
  if (agent.budget < stake) return null;
  
  // Update agent's state
  const updatedAgent = {
    ...agent,
    budget: agent.budget - stake,
    stakedAmount: stake,
    position: outcome,
    stakedIn: resultId
  };
  
  // Update available agents
  const updatedAgents = availableAgents.map(a => 
    a.id === agent.id ? updatedAgent : a
  );
  
  // Update the LMSR market for this person
  const currentMarket = personMarkets[resultId];
  if (!currentMarket) return null;
  
  const action = {
    type: 'BUY' as const,
    amount: stake,
    agentId: agent.id,
    confidence: 0.8,
    outcome
  };
  
  const newMarket = updateMarketState(currentMarket, action);
  const updatedMarkets = { ...personMarkets, [resultId]: newMarket };
  
  // Update search results
  const newResults = searchResults.map(result => {
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
  const updatedResults = sortSearchResults(newResults);
  
  return {
    updatedAgents,
    updatedMarkets,
    updatedResults
  };
}

export interface AutoStakingResult {
  updatedAgents: Agent[];
  updatedMarkets: Record<string, MarketState>;
  updatedResults: SearchResult[];
}

export function processAutoStaking(
  result: SearchResult,
  availableAgents: Agent[],
  personMarkets: Record<string, MarketState>,
  searchResults: SearchResult[]
): AutoStakingResult {
  let updatedAgents = [...availableAgents];
  let updatedMarkets = { ...personMarkets };
  let updatedResults = [...searchResults];
  
  availableAgents.forEach(agent => {
    if (!agent.triggers) return;
    
    // Check if any trigger conditions are met
    const triggered = agent.triggers.some(trigger => trigger.condition(result));
    
    if (triggered) {
      // Calculate stake based on agent's confidence
      const stake = calculateStake(0.8);
      
      // Only proceed if agent has enough budget and not already staked in this result
      if (agent.budget >= stake && agent.stakedIn !== result.id) {
        // Update agent's state
        const updatedAgent: Agent = {
          ...agent,
          budget: agent.budget - stake,
          stakedAmount: stake,
          position: 'YES' as const,
          stakedIn: result.id
        };
        
        // Update available agents
        updatedAgents = updatedAgents.map(a => 
          a.id === agent.id ? updatedAgent : a
        );
        
        // Update the LMSR market for this person
        const currentMarket = updatedMarkets[result.id];
        if (currentMarket) {
          const action = {
            type: 'BUY' as const,
            amount: stake,
            agentId: agent.id,
            confidence: 0.8,
            outcome: 'YES' as const
          };
          
          const newMarket = updateMarketState(currentMarket, action);
          updatedMarkets = { ...updatedMarkets, [result.id]: newMarket };
        }
        
        // Update search results
        updatedResults = updatedResults.map(r => {
          if (r.id === result.id) {
            const yesAgents = [...(r.yesAgents || []), updatedAgent];
            const yesStaked = yesAgents.reduce((sum, a) => sum + (a.stakedAmount || 0), 0);
            const noStaked = (r.noStaked || 0);
            const totalStaked = yesStaked + noStaked;
            const netAmount = yesStaked - noStaked;
            
            return {
              ...r,
              yesAgents,
              yesStaked,
              totalStaked,
              netAmount
            };
          }
          return r;
        });
      }
    }
  });
  
  // Sort results after auto-staking
  updatedResults = sortSearchResults(updatedResults);
  
  return {
    updatedAgents,
    updatedMarkets,
    updatedResults
  };
}

export interface MarketResolutionResult {
  updatedAgents: Agent[];
}

export function processMarketResolution(
  personId: string,
  personMarkets: Record<string, MarketState>,
  searchResults: SearchResult[],
  availableAgents: Agent[]
): MarketResolutionResult | null {
  const market = personMarkets[personId];
  if (!market) return null;
  
  // Get current stakes from search results
  const result = searchResults.find(r => r.id === personId);
  if (!result) return null;
  
  const yesStakes = (result.yesAgents || []).map(agent => ({
    agentId: agent.id,
    stake: agent.stakedAmount || 0
  }));
  
  const noStakes = (result.noAgents || []).map(agent => ({
    agentId: agent.id,
    stake: agent.stakedAmount || 0
  }));
  
  // Calculate zero-sum payouts (assuming connection = YES outcome)
  const payouts = calculateMarketPayouts(market, yesStakes, noStakes, 'YES');
  
  // Update agent budgets based on payouts
  const updatedAgents = availableAgents.map(agent => {
    const payout = payouts.find(p => p.agentId === agent.id);
    if (payout) {
      // Agent gets their payout (which could be 0 if they lost)
      return { ...agent, budget: agent.budget + payout.payout };
    }
    return agent;
  });
  
  return {
    updatedAgents
  };
}

export function sortSearchResults(results: SearchResult[]): SearchResult[] {
  return results.sort((a, b) => (b.netAmount || 0) - (a.netAmount || 0));
}

export function initializeMarketsForResults(results: SearchResult[]): Record<string, MarketState> {
  const markets: Record<string, MarketState> = {};
  results.forEach(result => {
    markets[result.id] = initializeMarket(result.id);
  });
  return markets;
} 