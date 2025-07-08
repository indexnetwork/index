import { vibeCheck, type UserData } from '../agents/external/vibe_checker';
import { cache } from './redis';
import crypto from 'crypto';

interface AgentReason {
  agent_name: string;
  agent_id: string;
  reasoning: string;
}

interface UserIntent {
  id: string;
  payload: string;
  reasons: AgentReason[];
}

interface User {
  id: string;
  name: string;
  intro: string;
  intents: UserIntent[];
}

interface SynthesisInput {
  users: User[];
}

// Helper types for generating user synthesis
export interface SynthesisUserData {
  id: string;
  name: string;
  intro?: string;
}

export interface SynthesisIntentData {
  id: string;
  summary?: string | null;
  payload?: string;
}

export interface SynthesisAgentData {
  agent: {
    name: string;
    avatar?: string;
  };
  reasoning?: string;
}

export interface SynthesisUserContext {
  user: SynthesisUserData;
  intents: {
    intent: SynthesisIntentData;
    agents: SynthesisAgentData[];
  }[];
}

// Helper function to convert user context data to synthesis format
export function convertToSynthesisFormat(userContext: SynthesisUserContext): SynthesisInput {
  const synthesisUser = {
    id: userContext.user.id,
    name: userContext.user.name,
    intro: userContext.user.intro || "",
    intents: userContext.intents.map((intentData) => ({
      id: intentData.intent.id,
      payload: intentData.intent.payload || intentData.intent.summary || "",
      reasons: intentData.agents.map((agentData) => ({
        agent_name: agentData.agent.name,
        agent_id: agentData.agent.name, // Using name as ID for now
        reasoning: agentData.reasoning || "",
      }))
    }))
  };

  return { users: [synthesisUser] };
}

// Helper function to generate synthesis for a single user
export async function generateUserSynthesis(userContext: SynthesisUserContext, fallbackMessage?: string): Promise<string> {
  try {
    const synthesisData = convertToSynthesisFormat(userContext);
    return await safe_synthesise(synthesisData);
  } catch (error) {
    console.error('Synthesis error:', error);
    return fallbackMessage || `${userContext.user.name} brings valuable expertise that could complement your work.`;
  }
}

function createCacheHash(userData: UserData): string {
  // Create a stable hash of the input data for caching
  const sortedUserData = {
    ...userData,
    // Sort intents by id for consistent hashing
    intents: [...userData.intents].sort((a, b) => a.id.localeCompare(b.id))
  };
  
  const dataString = JSON.stringify(sortedUserData);
  return crypto.createHash('sha256').update(dataString).digest('hex');
}

export async function safe_synthesise(data: SynthesisInput): Promise<string> {
  if (!data.users || data.users.length === 0) {
    return "No collaboration opportunities identified at this time.";
  }

  const results: string[] = [];

  // Process each user separately with vibe_checker
  for (const user of data.users) {
    if (!user.intents || user.intents.length === 0) {
      results.push(`While ${user.name} seems like an interesting potential collaborator, no specific collaboration opportunities are visible right now.`);
      continue;
    }

    // Convert user to UserData format for vibe_checker
    const userData: UserData = {
      id: user.id,
      name: user.name,
      intro: user.intro,
      intents: user.intents
    };

    // Check cache first using Redis hash
    const hashKey = 'synthesis';
    const fieldKey = createCacheHash(userData);
    const cachedResult = await cache.hget(hashKey, fieldKey);
    
    if (cachedResult) {
      console.log(`✅ Cache hit for user ${user.name}`);
      results.push(cachedResult);
      continue;
    }

    // Cache miss - generate new synthesis
    console.log(`⏳ Cache miss for user ${user.name}, generating synthesis...`);
    const vibeResult = await vibeCheck(userData);
    
    if (vibeResult.success && vibeResult.synthesis) {
      // Cache the result using Redis hash with expiration
      await cache.hset(hashKey, fieldKey, vibeResult.synthesis);
      results.push(vibeResult.synthesis);
    } else {
      const fallback = `Unable to generate collaboration synthesis for ${user.name} at this time.`;
      results.push(fallback);
    }
  }

  return results.join('\n\n---\n\n');
}
