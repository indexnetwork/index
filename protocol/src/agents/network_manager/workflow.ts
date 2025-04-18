import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";
import * as fs from 'fs';
import * as path from 'path';

// Simple state annotation
const NetworkManagerState = Annotation.Root({
  input: Annotation<string>,
  output: Annotation<string>
});

type StateType = typeof NetworkManagerState.State;

// Initialize OpenAI
const llm = new ChatOpenAI({
  model: "gpt-4",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

// Load audience data
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

// Combined network analysis node
async function networkAnalyzer(state: StateType): Promise<Partial<StateType>> {
  const audienceData = loadAudienceData();
  const allUsers = Object.values(audienceData).flat();
  
  const systemPrompt = `
You are the ConsensysVibeStaker Network Manager Agent. Your goal is to increase ecosystem synergy by detecting compatible activities, complementary needs, and converging themes between network participants.

Process:
1. Detect intents from input related to:
   - Fundraising activities  
   - New team member hires
   - Sales or partnership conversations

2. Find potential matches between users based on compatibility

3. Evaluate synergy potential considering:
   - Network-wide synergy potential
   - Cold start reduction impact  
   - Coordination acceleration benefits

4. Make staking decisions for high-synergy matches (threshold: 0.7)

5. Execute stakes with conviction >= 0.8

Available network participants:
${JSON.stringify(allUsers, null, 2)}

Input to analyze: ${state.input}

Provide a comprehensive analysis and execution summary of any stakes made.
`;

  try {
    const response = await llm.invoke(systemPrompt);
    const output = response.content as string;
    
    return { 
      output: `ConsensysVibeStaker Network Manager - Analysis Complete:\n\n${output}`
    };
  } catch (error) {
    console.error("Network analysis failed:", error);
    return { 
      output: `Error in network analysis: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the workflow
export function createNetworkManagerWorkflow() {
  const workflow = new StateGraph(NetworkManagerState)
    .addNode("analyzer", networkAnalyzer)
    .addEdge(START, "analyzer")
    .addEdge("analyzer", END);
  
  return workflow;
}

// Main execution function
export async function runNetworkManager(input: string): Promise<string> {
  const workflow = createNetworkManagerWorkflow();
  const app = workflow.compile();
  
  try {
    const result = await app.invoke({ input });
    return result.output || "No output generated";
  } catch (error) {
    console.error("Network Manager workflow error:", error);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

export default createNetworkManagerWorkflow; 