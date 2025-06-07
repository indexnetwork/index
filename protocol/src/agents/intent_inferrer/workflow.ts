import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { UnstructuredDirectoryLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { Document } from "@langchain/core/documents";
import { llm } from "../../lib/agents";
import * as fs from 'fs';

// Type definitions
export interface InferredIntent {
  payload: string;
  confidence: number;
}
// State annotation for the workflow
const IntentInferrerState = Annotation.Root({
  folderPath: Annotation<string>,
  documents: Annotation<Document[]>,
  processedContent: Annotation<string>,
  intents: Annotation<InferredIntent[]>,
  output: Annotation<string>
});

type StateType = typeof IntentInferrerState.State;

// Node 1: Load documents using UnstructuredDirectoryLoader
async function loadDocuments(state: StateType): Promise<Partial<StateType>> {
  const folderPath = state.folderPath;
  
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { 
      documents: [],
      output: `Error: Folder path "${folderPath}" does not exist or is not accessible.`
    };
  }

  try {
    console.log(`🔍 Loading documents from: ${folderPath}`);
    
    // Configure UnstructuredDirectoryLoader with options
    const loaderOptions: any = {
      // Skip common build/dependency directories
      recursive: true,
      unknownHandling: "ignore", // Skip unknown file types gracefully
    };

    // Set up Unstructured API configuration if available
    if (process.env.UNSTRUCTURED_API_KEY) {
      loaderOptions.apiKey = process.env.UNSTRUCTURED_API_KEY;
      loaderOptions.apiUrl = process.env.UNSTRUCTURED_API_URL || "https://api.unstructured.io";
      console.log("📡 Using Unstructured API for advanced document parsing");
    } else if (process.env.UNSTRUCTURED_SERVER_URL) {
      loaderOptions.apiUrl = process.env.UNSTRUCTURED_SERVER_URL;
      console.log("🐳 Using local Unstructured server");
    } else {
      console.log("⚠️  No Unstructured API key or server URL found. Some document types may not be parsed optimally.");
    }

    const directoryLoader = new UnstructuredDirectoryLoader(folderPath, loaderOptions);
    
    
    // Load all documents
    
    const documents = await directoryLoader.load();
    
    console.log(`📄 Loaded ${documents.length} documents successfully`);
    
    // Filter out documents from unwanted directories
    const filteredDocuments = documents.filter(doc => {
      const source = doc.metadata.source || '';
      const unwantedPaths = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', '.pytest_cache', '.venv', 'venv'];
      return !unwantedPaths.some(path => source.includes(path));
    });

    console.log(`📋 Filtered to ${filteredDocuments.length} relevant documents`);

    return { documents: filteredDocuments };
  } catch (error) {
    console.error("❌ Error loading documents:", error);
    return { 
      documents: [],
      output: `Error loading documents: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Node 2: Process documents into structured content
async function processDocuments(state: StateType): Promise<Partial<StateType>> {
  const documents = state.documents || [];
  
  if (documents.length === 0) {
    return { 
      processedContent: "",
      output: "No documents to process."
    };
  }

  console.log(`📝 Processing ${documents.length} documents into structured content`);
  
  try {
    // Simply concatenate all document content
    const processedContent = documents
      .map(doc => doc.pageContent?.trim())
      .filter(content => content && content.length > 0)
      .join('\n');
    
    console.log(`✅ Processed content successfully (${processedContent.length} characters)`);
    
    return { processedContent };
  } catch (error) {
    console.error("❌ Error processing documents:", error);
    return { 
      processedContent: `Error processing documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
      output: `Error processing documents: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Node 3: Generate intents using advanced LLM analysis
async function generateIntents(state: StateType): Promise<Partial<StateType>> {
  const processedContent = state.processedContent;
  const documents = state.documents || [];
  
  if (!processedContent || documents.length === 0) {
    return { 
      intents: [],
      output: "No content available for intent generation."
    };
  }

  const systemPrompt = `
You are an expert document analyst and intent inference engine. Based on the comprehensive document analysis provided, generate high-quality, actionable intents that users might have when working with this document collection.

DOCUMENT COLLECTION ANALYSIS:
${processedContent}

Generate actionable intents based on document analysis. Consider learning, analysis, implementation, troubleshooting, documentation, integration, optimization, and compliance use cases.

OUTPUT REQUIREMENTS:
Return a JSON array of 8-15 intent objects with this exact structure:
[{
  "payload": "Clear, specific intent describing what the user wants to accomplish, referencing actual document content and patterns found",
  "confidence": 0.85
}]

Generate evidence-based intents with valid JSON format. Reference actual content and use appropriate confidence scores.
`;
  try {
    const response = await llm.invoke(systemPrompt);
    const content = response.content as string;
    
    // Extract JSON from the response
    let jsonStr = content;
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      jsonStr = jsonMatch[0];
    }
    
    // Parse the JSON response
    const rawIntents: any[] = JSON.parse(jsonStr);
    
    // Validate and enhance intents with document metadata
    const validIntents: InferredIntent[] = rawIntents
      .filter(intent => 
        intent.payload && 
        typeof intent.confidence === 'number' &&
        intent.confidence >= 0.3
      )
      .map(intent => ({
        payload: intent.payload,
        confidence: Math.min(intent.confidence, 1.0)
      }));

    console.log(`🎯 Generated ${validIntents.length} high-quality intents`);

    return { intents: validIntents };
  } catch (error) {
    console.error("Intent generation failed:", error);
  
    return { 
      intents: [],
      output: `Intent generation partially failed, using intelligent fallback intents. Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}



// Create the enhanced workflow
export function createIntentInferrerWorkflow() {
  // Initialize memory for state persistence
  const checkpointer = new MemorySaver();
  
  const workflow = new StateGraph(IntentInferrerState)
  .addNode("loadDocuments", loadDocuments)
  .addNode("processDocuments", processDocuments)
  .addNode("generateIntents", generateIntents)
  .addEdge(START, "loadDocuments")
  .addEdge("loadDocuments", "processDocuments")
  .addEdge("processDocuments", "generateIntents")
  .addEdge("generateIntents", END);

  return workflow.compile({ 
    checkpointer,
  });
}

// Main execution function
export async function processFolder(folderPath: string): Promise<{ intents: InferredIntent[], output: string}> {
  const workflow = createIntentInferrerWorkflow();
  
  try {
    console.log(`🚀 Starting intent inference for: ${folderPath}`);
    const result = await workflow.invoke(
      { folderPath },
      { configurable: { thread_id: `intent_inference_${Date.now()}` } }
    );
    
    return {
      intents: result.intents || [],
      output: result.output || "No output generated",
    };
  } catch (error) {
    console.error("Intent inferrer workflow error:", error);
    return {
      intents: [],
      output: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Utility function to get just the intents array
export async function inferIntentsFromFolder(folderPath: string): Promise<InferredIntent[]> {
  const result = await processFolder(folderPath);
  return result.intents;
} 