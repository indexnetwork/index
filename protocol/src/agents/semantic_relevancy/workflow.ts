import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI } from "@langchain/openai";

// Type definitions matching the database schema
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
const SemanticRelevancyState = Annotation.Root({
  intentData: Annotation<string>, // JSON stringified intent data
  output: Annotation<string>
});

type StateType = typeof SemanticRelevancyState.State;

// Initialize OpenAI
const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

// Semantic relevancy analysis node
async function semanticProcessor(state: StateType): Promise<Partial<StateType>> {
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent, existingIntents = [] } = intentData;
  const relevancyThreshold = 0.75;
  const confidenceThreshold = 0.8;
  
  const systemPrompt = `
You are the Semantic Relevancy Staker Agent. Analyze the semantic similarity between the new intent and existing intents to make precise staking decisions based on content relevancy.

NEW INTENT:
- ID: ${newIntent.id}
- Title: ${newIntent.title}
- Description: ${newIntent.payload}
- Status: ${newIntent.status}
- User: ${newIntent.user?.name || newIntent.userId}

EXISTING INTENTS FOR COMPARISON:
${existingIntents.map((i: Intent) => `
- ID: ${i.id}
- Title: ${i.title}
- Description: ${i.payload}
- User: ${i.user?.name || i.userId}
`).join('')}

SEMANTIC ANALYSIS PROCESS:
1. Analyze semantic similarity using natural language understanding
2. Identify intents with high topical overlap, shared keywords, and complementary goals
3. Calculate relevancy scores based on:
   - Topic similarity (shared domains, technologies, concepts)
   - Intent complementarity (can they fulfill each other's needs?)
   - Content depth alignment (similar complexity/scope)
   - Contextual relevance (timing, market conditions, user backgrounds)
4. Evaluate confidence in semantic matches
5. Make staking decisions (relevancy ≥ ${relevancyThreshold}, confidence ≥ ${confidenceThreshold})

SCORING CRITERIA:
- 0.9-1.0: Highly relevant - same domain, strong complementarity
- 0.8-0.89: Very relevant - related domains, good potential synergy
- 0.7-0.79: Relevant - overlapping concepts, moderate alignment
- 0.6-0.69: Somewhat relevant - loose connections, potential value
- <0.6: Low relevance - minimal semantic overlap

OUTPUT FORMAT:
Provide detailed semantic analysis and execution summary. For each potential match:
- Target intent ID and title
- Semantic relevancy score (0.0-1.0)
- Confidence level (0.0-1.0)
- Key semantic connections identified
- Complementarity assessment
- Stake amount (1-100 based on relevancy × confidence)
- Detailed reasoning

Focus on maximizing intent matching precision through semantic understanding.
`;

  try {
    const response = await llm.invoke(systemPrompt);
    const analysis = response.content as string;
    
    const output = `Semantic Relevancy Staker - Intent Analysis\n\n` +
                  `Intent: "${newIntent.title}" (${newIntent.id})\n\n` +
                  `${analysis}`;
    
    return { output };
  } catch (error) {
    console.error("Semantic processing failed:", error);
    return { 
      output: `Error processing intent: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the workflow
export function createSemanticRelevancyWorkflow() {
  const workflow = new StateGraph(SemanticRelevancyState)
    .addNode("semanticProcessor", semanticProcessor)
    .addEdge(START, "semanticProcessor")
    .addEdge("semanticProcessor", END);
  
  return workflow;
}

// Main execution function for processing new intents
export async function processIntent(
  newIntent: Intent, 
  existingIntents: Intent[] = []
): Promise<string> {
  const workflow = createSemanticRelevancyWorkflow();
  const app = workflow.compile();
  
  const intentData = JSON.stringify({ newIntent, existingIntents });
  
  try {
    const result = await app.invoke({ intentData });
    return result.output || "No output generated";
  } catch (error) {
    console.error("Semantic Relevancy workflow error:", error);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Legacy function for backward compatibility
export async function runSemanticRelevancy(input: string): Promise<string> {
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

export default createSemanticRelevancyWorkflow; 