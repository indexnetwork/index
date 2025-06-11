import db from './db';
import { agents } from './schema';
import { eq } from 'drizzle-orm';
import { ChatOpenAI } from '@langchain/openai';

// Simple OpenAI client for agent decisions
export const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

// Helper to ensure agent exists in database
export async function ensureAgent(name: string, avatar: string) {
  const existingAgents = await db.select().from(agents).where(eq(agents.name, name)).limit(1);
}

// Helper to create backing decision - DISABLED (requires intentPair and backer tables)
export async function createBacking(
  intentId1: string, 
  intentId2: string, 
  agentName: string, 
  confidence: number
) {
  console.warn("createBacking is disabled - requires intentPair and backer tables that don't exist in current schema");
  return false;
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

export default db; 