import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from 'fs';
import * as path from 'path';

// Intent type based on database schema
interface Intent {
  id: string;
  title: string;
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
  model: "gpt-4",
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

// Combined intent processing node
async function intentProcessor(state: StateType): Promise<Partial<StateType>> {
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent, existingIntents = [] } = intentData;
  const audienceData = loadAudienceData();
  const synergyThreshold = 0.7;
  const convictionThreshold = 0.8;
  
  const systemPrompt = `
You are the ConsensysVibeStaker Network Manager. Analyze the new intent for synergistic matches and make staking decisions.

NEW INTENT:
- ID: ${newIntent.id}
- Title: ${newIntent.title}
- Description: ${newIntent.payload}
- Status: ${newIntent.status}
- User: ${newIntent.user?.name || newIntent.userId}

EXISTING INTENTS:
${existingIntents.map((i: Intent) => `
- ID: ${i.id}
- Title: ${i.title}
- Description: ${i.payload}
- User: ${i.user?.name || i.userId}
`).join('')}

NETWORK CONTEXT:
${JSON.stringify(audienceData, null, 2)}

PROCESS:
1. Analyze for compatible activities and complementary needs
2. Evaluate synergy potential and ecosystem benefits
3. Make staking decisions (synergy ≥ ${synergyThreshold}, conviction ≥ ${convictionThreshold})

OUTPUT FORMAT:
Provide analysis and execution summary. If staking on matches, include:
- Target intent IDs
- Synergy scores
- Conviction levels
- Reasoning
- Stake amounts (1-100 based on conviction)

Focus on increasing network coordination and reducing cold starts.
`;

  try {
    const response = await llm.invoke(systemPrompt);
    const analysis = response.content as string;
    
    const output = `ConsensysVibeStaker Network Manager - Intent Analysis\n\n` +
                  `Intent: "${newIntent.title}" (${newIntent.id})\n\n` +
                  `${analysis}`;
    
    return { output };
  } catch (error) {
    console.error("Intent processing failed:", error);
    return { 
      output: `Error processing intent: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the workflow
export function createNetworkManagerWorkflow() {
  const workflow = new StateGraph(NetworkManagerState)
    .addNode("processor", intentProcessor)
    .addEdge(START, "processor")
    .addEdge("processor", END);
  
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
    title: "Test Intent",
    payload: input,
    status: "active",
    userId: "test-user"
  };
  
  return processIntent(mockIntent, []);
}

export default createNetworkManagerWorkflow; 