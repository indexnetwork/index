import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import db from "../../../lib/db";
import { agents, intentStakes } from "../../../lib/schema";
import { eq } from "drizzle-orm";
import * as fs from 'fs';
import * as path from 'path';

// Intent type based on database schema
interface Intent {
  id: string;
  payload: string;
  status: string;
  userId: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
  indexes?: Array<{
    id: string;
    name: string;
  }>;
}

// Simplified state annotation
const NetworkManagerState = Annotation.Root({
  intentData: Annotation<string>, // JSON stringified intent data
  output: Annotation<string>
});

type StateType = typeof NetworkManagerState.State;

// Initialize OpenAI
const llm = new ChatOpenAI({
  model: "gpt-4o-mini",  // Using cheaper model for simple decisions
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

// Load audience data for context
function loadAudienceData(): { [key: string]: any[] } {
  const dataDir = path.join(__dirname, 'data');
  const audiences = ['consensys_employees', 'portfolio_companies', 'alumni_network'];
  const audienceData: { [key: string]: any[] } = {};
  
  audiences.forEach(audience => {
    const filePath = path.join(dataDir, `${audience}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      audienceData[audience] = data;
    } catch (error) {
      console.warn(`Could not load ${audience} data:`, error);
      audienceData[audience] = [];
    }
  });
  
  return audienceData;
}

// Simplified network backing decision node
async function makeNetworkBackingDecision(state: StateType): Promise<Partial<StateType>> {
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent, existingIntents = [] } = intentData;
  
  // Simple OpenAI call for network synergy decisions
  const prompt = `
You are a network manager agent that identifies synergistic intent pairs for backing.

NEW INTENT: ${newIntent.payload}

EXISTING INTENTS:
${existingIntents.map((i: Intent, idx: number) => `${idx + 1}. ${i.payload}`).join('\n')}

Identify intents that could create network synergies or collaborations with the new intent.
Return ONLY a JSON array with format:
[{"intentId": "intent_id", "confidence": 0.85, "shouldBack": true}, ...]

Only include intents you would back (shouldBack: true). Confidence should be 0.7-1.0.
Focus on potential collaborations, complementary skills, or ecosystem benefits.
`;

  try {
    const response = await llm.invoke(prompt);
    const content = response.content as string;
    
    // Parse OpenAI response
    let decisions = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        decisions = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse OpenAI response:", parseError);
      decisions = [];
    }

    // Store backing decisions in database
    let backedCount = 0;
    for (const decision of decisions) {
      if (decision.shouldBack && decision.confidence >= 0.7) {
        try {
          // Get network manager agent
          let agent = await db.select().from(agents).where(eq(agents.name, "network_manager")).limit(1);

          if (!agent.length) {
            const newAgent = await db.insert(agents).values({
              name: "network_manager",
              description: "Network synergy manager",
              avatar: "🌐"
            }).returning();
            agent = newAgent;
          }

          // Create intent stake record with pair
          const pairKey = [newIntent.id, decision.intentId].sort().join('-');
          await db.insert(intentStakes).values({
            pair: pairKey,
            stake: BigInt(Math.round(decision.confidence * 100)), // Convert confidence to integer stake
            reasoning: `Network synergy backing with confidence ${decision.confidence}`,
            agentId: agent[0].id
          });

          backedCount++;
        } catch (dbError) {
          console.error("Database error creating backing:", dbError);
        }
      }
    }

    const output = `Network Manager Agent backed ${backedCount} intent pairs for "${newIntent.title}"`;
    return { output };

  } catch (error) {
    console.error("Network backing decision failed:", error);
    return { 
      output: `Error making backing decisions: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the workflow
export function createNetworkManagerWorkflow() {
  const workflow = new StateGraph(NetworkManagerState)
    .addNode("networkBacking", makeNetworkBackingDecision)
    .addEdge(START, "networkBacking")
    .addEdge("networkBacking", END);
  
  return workflow;
}

// Main execution function for processing new intents
export async function processIntent(
  newIntent: Intent, 
  existingIntents: Intent[] = []
): Promise<string> {
  const workflow = createNetworkManagerWorkflow();
  const app = workflow.compile();
  
  const intentData = JSON.stringify({ newIntent, existingIntents });
  
  try {
    const result = await app.invoke({ intentData });
    return result.output || "No output generated";
  } catch (error) {
    console.error("Network Manager workflow error:", error);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Legacy function for backward compatibility
export async function runNetworkManager(input: string): Promise<string> {
  // Create a mock intent from string input for testing
  const mockIntent: Intent = {
    id: "mock-" + Date.now(),
    payload: input,
    status: "active",
    userId: "test-user"
  };
  
  return processIntent(mockIntent, []);
}

export default createNetworkManagerWorkflow; 