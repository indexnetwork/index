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

// Calculate the reward for a successful match
export function calculateReward(marketState: MarketState, stake: number, outcome: 'YES' | 'NO'): number {
  const successMultiplier = 1.5; // Reward multiplier for successful matches
  const price = outcome === 'YES' ? marketState.price : 1 - marketState.price;
  return stake * successMultiplier * (1 + price);
}

// Calculate the penalty for an unsuccessful match
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