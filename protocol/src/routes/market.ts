import { PrismaClient } from '@prisma/client';
import { updateMarketState, calculateReward, calculatePenalty, type MarketState as LMSRMarketState } from './lmsr';

const prisma = new PrismaClient();

export interface MarketAction {
  type: 'BUY' | 'SELL';
  amount: number;
  agentId: string;
  confidence: number;
  outcome: 'YES' | 'NO'; // Which outcome to buy/sell
}

export async function initializeIntentPairMarket(intentPairId: string) {
  const marketState = await prisma.marketState.create({
    data: {
      intentPairId,
      q: 0,
      price: 0.5,
      liquidity: 1000 // Initial liquidity parameter
    }
  });

  return marketState;
}

export async function executeMarketAction(intentPairId: string, action: MarketAction) {
  // Get current market state
  const currentMarketState = await prisma.marketState.findFirst({
    where: { intentPairId }
  });

  if (!currentMarketState) {
    throw new Error('Market state not found for intent pair');
  }

  // Convert to LMSR market state format
  const lmsrState: LMSRMarketState = {
    intentPairId: currentMarketState.intentPairId,
    q: currentMarketState.q,
    price: currentMarketState.price,
    liquidity: currentMarketState.liquidity,
    volume: 0, // TODO: Track volume in database
    yesShares: 0, // TODO: Track YES shares in database
    noShares: 0 // TODO: Track NO shares in database
  };

  // Calculate new market state
  const newLmsrState = updateMarketState(lmsrState, action);

  // Update market state in database
  const updatedMarketState = await prisma.marketState.update({
    where: { id: currentMarketState.id },
    data: {
      q: newLmsrState.q,
      price: newLmsrState.price,
      liquidity: newLmsrState.liquidity
    }
  });

  // Record market action
  await prisma.marketAction.create({
    data: {
      type: action.type,
      amount: action.amount,
      agentId: action.agentId,
      confidence: action.confidence,
      marketStateId: updatedMarketState.id
    }
  });

  // Update agent's stake
  await prisma.agent.update({
    where: { id: action.agentId },
    data: {
      stake: {
        increment: action.type === 'BUY' ? action.amount : -action.amount
      }
    }
  });

  return updatedMarketState;
}

export async function processMatchOutcome(intentPairId: string, isSuccessful: boolean) {
  const marketState = await prisma.marketState.findFirst({
    where: { intentPairId },
    include: {
      marketActions: {
        include: {
          agent: true
        }
      }
    }
  });

  if (!marketState) {
    throw new Error('Market state not found for intent pair');
  }

  // Process each agent's stake
  for (const action of marketState.marketActions) {
    // Convert to LMSR market state format for reward/penalty calculation
    const lmsrMarketState: LMSRMarketState = {
      intentPairId: marketState.intentPairId,
      q: marketState.q,
      price: marketState.price,
      liquidity: marketState.liquidity,
      volume: 0, // TODO: Track volume in database
      yesShares: 0, // TODO: Track YES shares in database
      noShares: 0 // TODO: Track NO shares in database
    };

    // For now, assume outcome is 'YES' - this should be determined by the action's outcome property
    // when the database schema is updated to include the outcome field
    const outcome: 'YES' | 'NO' = 'YES'; // TODO: Get from action.outcome when database schema is updated
    
    const reward = isSuccessful
      ? calculateReward(lmsrMarketState, action.amount, outcome)
      : calculatePenalty(lmsrMarketState, action.amount, outcome);

    // Update agent's stake
    await prisma.agent.update({
      where: { id: action.agentId },
      data: {
        stake: {
          increment: reward
        }
      }
    });
  }

  return marketState;
}

export async function getMarketState(intentPairId: string) {
  return prisma.marketState.findFirst({
    where: { intentPairId },
    include: {
      marketActions: {
        include: {
          agent: true
        }
      }
    }
  });
} 