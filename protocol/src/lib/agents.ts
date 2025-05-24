import { PrismaClient } from '@prisma/client';
import { ChatOpenAI } from '@langchain/openai';

const prisma = new PrismaClient();

// Simple OpenAI client for agent decisions
export const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

// Helper to ensure agent exists in database
export async function ensureAgent(name: string, avatar: string) {
  let agent = await prisma.agent.findFirst({
    where: { name }
  });

  if (!agent) {
    agent = await prisma.agent.create({
      data: {
        name,
        role: "SYSTEM",
        avatar
      }
    });
  }

  return agent;
}

// Helper to create backing decision
export async function createBacking(
  intentId1: string, 
  intentId2: string, 
  agentName: string, 
  confidence: number
) {
  try {
    // Create intent pair
    const intentPair = await prisma.intentPair.create({
      data: {
        intents: {
          connect: [
            { id: intentId1 },
            { id: intentId2 }
          ]
        }
      }
    });

    // Get agent with appropriate avatar
    let avatar = "🌐"; // default
    if (agentName === "semantic_relevancy") {
      avatar = "🧠";
    } else if (agentName === "proof_layer") {
      avatar = "🔍";
    }
    
    const agent = await ensureAgent(agentName, avatar);

    // Create backing record
    await prisma.backer.create({
      data: {
        confidence,
        agentId: agent.id,
        intentPairId: intentPair.id
      }
    });

    return true;
  } catch (error) {
    console.error("Error creating backing:", error);
    return false;
  }
}

// Parse OpenAI JSON response safely
export function parseAgentDecisions(content: string): Array<{intentId: string, confidence: number, shouldBack: boolean}> {
  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch (error) {
    console.error("Failed to parse agent decisions:", error);
  }
  return [];
}

export default prisma; 