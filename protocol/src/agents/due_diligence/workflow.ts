import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import prisma from "../../lib/db";
import { llm, createBacking, parseAgentDecisions } from "../../lib/agents";

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

interface DueDiligenceResult {
  intentId: string;
  vcFounderMatch: boolean;
  confidence: number;
  dueDiligenceReport: string;
  webResearchFindings: string[];
  riskAssessment: string;
  recommendation: string;
}

// State annotation for ProofLayer workflow
const ProofLayerState = Annotation.Root({
  intentData: Annotation<string>, // JSON stringified intent data
  vcFounderMatches: Annotation<Intent[]>, // Filtered VC-Founder matching intents
  dueDiligenceResults: Annotation<DueDiligenceResult[]>,
  output: Annotation<string>
});

type StateType = typeof ProofLayerState.State;

// Initialize OpenAI and Tavily
const embeddings = new OpenAIEmbeddings({
  apiKey: process.env.OPENAI_API_KEY,
  model: "text-embedding-3-small"
});

const tavilySearch = new TavilySearchResults({ 
  maxResults: 5,
  apiKey: process.env.TAVILY_API_KEY
});

const dueDiligenceLLM = new ChatOpenAI({
  model: "gpt-4o",  // Using more powerful model for complex due diligence
  temperature: 0.2,
  apiKey: process.env.OPENAI_API_KEY
});

// VC-Founder matching filter using embeddings
async function filterVCFounderMatches(state: StateType): Promise<Partial<StateType>> {
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent, existingIntents = [] } = intentData;
  
  // Keywords that indicate VC or Founder related content
  const vcKeywords = [
    "venture capital", "VC", "investment", "funding", "investor", "seed", "series A", "series B",
    "startup funding", "angel investor", "pitch deck", "portfolio", "due diligence", "valuation"
  ];
  
  const founderKeywords = [
    "founder", "entrepreneur", "startup", "company", "business", "CEO", "CTO", "co-founder",
    "founding team", "startup idea", "business plan", "product launch", "MVP", "market validation"
  ];
  
  try {
    // Check if new intent is VC or Founder related
    const newIntentText = `${newIntent.title} ${newIntent.payload}`.toLowerCase();
    const isVCRelated = vcKeywords.some(keyword => newIntentText.includes(keyword.toLowerCase()));
    const isFounderRelated = founderKeywords.some(keyword => newIntentText.includes(keyword.toLowerCase()));
    
    if (!isVCRelated && !isFounderRelated) {
      return { 
        vcFounderMatches: [],
        output: "Intent not related to VC-Founder ecosystem. Skipping due diligence."
      };
    }
    
    // Generate embeddings for semantic comparison
    const newIntentEmbedding = await embeddings.embedQuery(`${newIntent.title}: ${newIntent.payload}`);
    
    const vcFounderMatches: Intent[] = [];
    
    for (const intent of existingIntents) {
      const intentText = `${intent.title} ${intent.payload}`.toLowerCase();
      const isIntentVCRelated = vcKeywords.some(keyword => intentText.includes(keyword.toLowerCase()));
      const isIntentFounderRelated = founderKeywords.some(keyword => intentText.includes(keyword.toLowerCase()));
      
      // Only consider intents that are VC or Founder related
      if (isIntentVCRelated || isIntentFounderRelated) {
        const intentEmbedding = await embeddings.embedQuery(`${intent.title}: ${intent.payload}`);
        
        // Calculate cosine similarity
        const similarity = cosineSimilarity(newIntentEmbedding, intentEmbedding);
        
        // Include if similarity is above threshold (0.7) and represents a VC-Founder match
        if (similarity > 0.7) {
          const isComplementaryMatch = (isVCRelated && isIntentFounderRelated) || 
                                     (isFounderRelated && isIntentVCRelated);
          
          if (isComplementaryMatch) {
            vcFounderMatches.push(intent);
          }
        }
      }
    }
    
    return { 
      vcFounderMatches,
      output: `Found ${vcFounderMatches.length} VC-Founder matching intents for due diligence analysis.`
    };
    
  } catch (error) {
    console.error("VC-Founder matching failed:", error);
    return { 
      vcFounderMatches: [],
      output: `Error in VC-Founder matching: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Cosine similarity calculation helper
function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

// Web research and due diligence node
async function conductDueDiligence(state: StateType): Promise<Partial<StateType>> {
  if (!state.vcFounderMatches || state.vcFounderMatches.length === 0) {
    return { 
      dueDiligenceResults: [],
      output: "No VC-Founder matches found. Skipping due diligence research."
    };
  }
  
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent } = intentData;
  const dueDiligenceResults: DueDiligenceResult[] = [];
  
  try {
    for (const matchedIntent of state.vcFounderMatches) {
      // Conduct web research using Tavily
      const researchQueries = [
        `${newIntent.title} ${matchedIntent.title} startup funding investment`,
        `"${newIntent.user?.name}" "${matchedIntent.user?.name}" venture capital due diligence`,
        `${newIntent.title} market validation business model`,
        `${matchedIntent.title} investor portfolio track record`
      ];
      
      const webResearchFindings: string[] = [];
      
      for (const query of researchQueries) {
        try {
          const searchResult = await tavilySearch.invoke(query);
          if (typeof searchResult === 'string') {
            webResearchFindings.push(searchResult);
          }
        } catch (searchError) {
          console.error("Tavily search failed for query:", query, searchError);
          webResearchFindings.push(`Search failed for: ${query}`);
        }
      }
      
      // Generate comprehensive due diligence report
      const dueDiligencePrompt = `
You are ProofLayer, an expert due diligence analyst specializing in VC-Founder matching and investment risk assessment.

INTENT PAIR ANALYSIS:
New Intent (${newIntent.user?.name || 'Unknown'}): ${newIntent.title}
Description: ${newIntent.payload}

Matched Intent (${matchedIntent.user?.name || 'Unknown'}): ${matchedIntent.title}
Description: ${matchedIntent.payload}

WEB RESEARCH FINDINGS:
${webResearchFindings.join('\n\n')}

COMPREHENSIVE DUE DILIGENCE ANALYSIS:
1. Business Model Validation
   - Evaluate market opportunity and scalability
   - Assess product-market fit indicators
   - Analyze competitive landscape

2. Team & Founder Assessment
   - Background verification and track record
   - Team composition and expertise evaluation
   - Leadership capability assessment

3. Financial Risk Analysis
   - Funding history and burn rate analysis
   - Revenue model sustainability
   - Investment terms and valuation assessment

4. Market & Industry Analysis
   - Market size and growth potential
   - Industry trends and disruption factors
   - Regulatory and compliance considerations

5. Technology & IP Evaluation
   - Technical feasibility and innovation
   - Intellectual property protection
   - Scalability and technical debt assessment

DELIVERABLES:
- Risk Assessment Score (1-10, where 10 is highest risk)
- Key Risk Factors identified
- Investment Recommendation (INVEST/INVESTIGATE/AVOID)
- Confidence Level (0.0-1.0)
- Detailed reasoning and evidence

Provide a comprehensive, professional due diligence report with actionable insights.
`;

      const response = await dueDiligenceLLM.invoke(dueDiligencePrompt);
      const dueDiligenceReport = response.content as string;
      
      // Extract risk assessment and recommendation
      const riskMatch = dueDiligenceReport.match(/Risk Assessment Score.*?(\d+)/i);
      const recommendationMatch = dueDiligenceReport.match(/Investment Recommendation.*?(INVEST|INVESTIGATE|AVOID)/i);
      const confidenceMatch = dueDiligenceReport.match(/Confidence Level.*?(0?\.\d+|1\.0)/i);
      
      const riskScore = riskMatch ? parseInt(riskMatch[1]) : 5;
      const recommendation = recommendationMatch ? recommendationMatch[1] : 'INVESTIGATE';
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;
      
      dueDiligenceResults.push({
        intentId: matchedIntent.id,
        vcFounderMatch: true,
        confidence,
        dueDiligenceReport,
        webResearchFindings,
        riskAssessment: `Risk Score: ${riskScore}/10`,
        recommendation
      });
    }
    
    return { 
      dueDiligenceResults,
      output: `Completed due diligence analysis for ${dueDiligenceResults.length} VC-Founder matches.`
    };
    
  } catch (error) {
    console.error("Due diligence analysis failed:", error);
    return { 
      dueDiligenceResults: [],
      output: `Error conducting due diligence: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Investment decision and backing node
async function makeInvestmentDecision(state: StateType): Promise<Partial<StateType>> {
  if (!state.dueDiligenceResults || state.dueDiligenceResults.length === 0) {
    return { output: "No due diligence results available for investment decisions." };
  }
  
  let intentData;
  try {
    intentData = JSON.parse(state.intentData);
  } catch (error) {
    return { output: "Error: Invalid intent data format" };
  }
  
  const { newIntent } = intentData;
  let backedCount = 0;
  let investmentSummary = [];
  
  try {
    for (const result of state.dueDiligenceResults) {
      // Only back investments with INVEST recommendation and high confidence
      if (result.recommendation === 'INVEST' && result.confidence >= 0.75) {
        const success = await createBacking(
          newIntent.id,
          result.intentId,
          "proof_layer",
          result.confidence
        );
        
        if (success) {
          backedCount++;
          investmentSummary.push(
            `✓ BACKED: Intent ${result.intentId} (Confidence: ${result.confidence.toFixed(2)})`
          );
        }
      } else {
        investmentSummary.push(
          `⚠ PASSED: Intent ${result.intentId} (${result.recommendation}, Confidence: ${result.confidence.toFixed(2)})`
        );
      }
    }
    
    const output = `ProofLayer Due Diligence Complete\n\n` +
                  `Intent: "${newIntent.title}" (${newIntent.id})\n` +
                  `Analyzed: ${state.dueDiligenceResults.length} VC-Founder matches\n` +
                  `Backed: ${backedCount} high-confidence investments\n\n` +
                  `Investment Decisions:\n${investmentSummary.join('\n')}\n\n` +
                  `Due diligence reports available for detailed analysis.`;
    
    return { output };
    
  } catch (error) {
    console.error("Investment decision failed:", error);
    return { 
      output: `Error making investment decisions: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the ProofLayer workflow
export function createProofLayerWorkflow() {
  const workflow = new StateGraph(ProofLayerState)
    .addNode("vcFounderFilter", filterVCFounderMatches)
    .addNode("dueDiligence", conductDueDiligence)
    .addNode("investmentDecision", makeInvestmentDecision)
    .addEdge(START, "vcFounderFilter")
    .addEdge("vcFounderFilter", "dueDiligence")
    .addEdge("dueDiligence", "investmentDecision")
    .addEdge("investmentDecision", END);
  
  return workflow;
}

// Main execution function for processing VC-Founder intent matches
export async function processVCFounderIntent(
  newIntent: Intent,
  existingIntents: Intent[] = []
): Promise<string> {
  const workflow = createProofLayerWorkflow();
  const app = workflow.compile();
  
  const intentData = JSON.stringify({ newIntent, existingIntents });
  
  try {
    const result = await app.invoke({ intentData });
    return result.output || "No output generated";
  } catch (error) {
    console.error("ProofLayer workflow error:", error);
    return `Error: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

// Get detailed due diligence results
export async function getDueDiligenceResults(
  newIntent: Intent,
  existingIntents: Intent[] = []
): Promise<DueDiligenceResult[]> {
  const workflow = createProofLayerWorkflow();
  const app = workflow.compile();
  
  const intentData = JSON.stringify({ newIntent, existingIntents });
  
  try {
    const result = await app.invoke({ intentData });
    return result.dueDiligenceResults || [];
  } catch (error) {
    console.error("ProofLayer workflow error:", error);
    return [];
  }
}

// Legacy function for backward compatibility
export async function runProofLayer(input: string): Promise<string> {
  // Create a mock VC/Founder intent from string input for testing
  const mockIntent: Intent = {
    id: "mock-" + Date.now(),
    title: "Test VC Investment",
    payload: input,
    status: "active",
    userId: "test-user"
  };
  
  return processVCFounderIntent(mockIntent, []);
}

export default createProofLayerWorkflow; 