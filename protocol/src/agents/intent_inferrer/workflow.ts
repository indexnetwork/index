import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { UnstructuredDirectoryLoader, UnstructuredDirectoryLoaderOptions } from "@langchain/community/document_loaders/fs/unstructured";
import { Document } from "@langchain/core/documents";
import { llm } from "../../lib/agents";
import * as fs from 'fs';

// Type definitions
export interface InferredIntent {
  payload: string;
  confidence: number;
}

export interface DocumentIntents {
  fileName: string;
  intents: InferredIntent[];
}

// State annotation for the workflow
const IntentInferrerState = Annotation.Root({
  folderPath: Annotation<string>,
  documents: Annotation<Document[]>,
  documentIntents: Annotation<DocumentIntents[]>,
  finalIntents: Annotation<InferredIntent[]>,
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
    const loaderOptions: UnstructuredDirectoryLoaderOptions = {
      recursive: true,
      strategy: "fast"
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

// Node 2: Generate 3 intents for each document in parallel
async function generateDocumentIntents(state: StateType): Promise<Partial<StateType>> {
  const documents = state.documents || [];
  
  if (documents.length === 0) {
    return { 
      documentIntents: [],
      output: "No documents to process for intent generation."
    };
  }

  console.log(`📝 Generating 3 intents for each of ${documents.length} documents in parallel`);
  
  try {
    // Process each document in parallel to generate 3 intents per document
    const documentIntentsPromises = documents.map(async (doc, index) => {
      const fileName = doc.metadata.source || `document_${index}`;
      const content = doc.pageContent?.trim() || '';
      
      if (!content || content.length < 50) {
        return {
          fileName,
          intents: []
        };
      }

      const systemPrompt = `
You are an expert document analyst. Analyze the following document content and generate exactly 3 specific search intents that represent what users might be looking for or seeking to understand from this document.

DOCUMENT: ${fileName}
CONTENT:
${content.substring(0, 4000)} ${content.length > 4000 ? '...[truncated]' : ''}

Generate exactly 3 intents that represent:
1. Information or knowledge users might be seeking from this document
2. Questions users might have that this document could answer
3. Topics or concepts users might be searching for

Focus on what users are looking for rather than what they want to do.

OUTPUT REQUIREMENTS:
Return a JSON array of exactly 3 intent objects with this structure:
[{
  "payload": "Specific intent describing what information or knowledge the user is looking for",
  "confidence": 0.85
}]

Ensure valid JSON format and confidence scores between 0.5 and 1.0.
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
        
        // Validate intents
        const validIntents: InferredIntent[] = rawIntents
          .filter(intent => 
            intent.payload && 
            typeof intent.confidence === 'number' &&
            intent.confidence >= 0.5
          )
          .slice(0, 3) // Ensure max 3 intents
          .map(intent => ({
            payload: intent.payload,
            confidence: Math.min(intent.confidence, 1.0)
          }));

        return {
          fileName,
          intents: validIntents
        };
      } catch (error) {
        console.error(`❌ Error generating intents for ${fileName}:`, error);
        return {
          fileName,
          intents: []
        };
      }
    });

    // Wait for all document intents to be generated
    const documentIntents = await Promise.all(documentIntentsPromises);
    
    const totalIntents = documentIntents.reduce((sum, doc) => sum + doc.intents.length, 0);
    console.log(`✅ Generated ${totalIntents} intents across ${documentIntents.length} documents`);
    
    return { documentIntents };
  } catch (error) {
    console.error("❌ Error generating document intents:", error);
    return { 
      documentIntents: [],
      output: `Error generating document intents: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Node 3: Consolidate all document intents into final intents using LLM
async function consolidateIntents(state: StateType): Promise<Partial<StateType>> {
  const documentIntents = state.documentIntents || [];
  
  if (documentIntents.length === 0) {
    return { 
      finalIntents: [],
      output: "No document intents available for consolidation."
    };
  }

  console.log(`🎯 Consolidating intents from ${documentIntents.length} documents`);
  
  try {
    // Prepare all intents for consolidation
    const allIntents = documentIntents.flatMap(doc => 
      doc.intents.map(intent => ({
        ...intent,
        source: doc.fileName
      }))
    );

    const intentsText = documentIntents.map(doc => 
      `Document: ${doc.fileName}
Intents:
${doc.intents.map(intent => `- ${intent.payload} (confidence: ${intent.confidence})`).join('\n')}
`
    ).join('\n');

    const systemPrompt = `
You are an expert intent consolidation engine. You have been given search intents generated from individual documents in a codebase/project. Your task is to analyze these intents and create a consolidated set of 8-15 high-quality, diverse intents that best represent what users might be looking for or seeking to understand from this entire document collection.

INDIVIDUAL DOCUMENT INTENTS:
${intentsText}

CONSOLIDATION REQUIREMENTS:
1. Merge similar search intents while preserving unique information needs
2. Eliminate redundancy and overlap
3. Prioritize intents with higher confidence scores
4. Create broader, more comprehensive search intents that span multiple documents
5. Focus on information, knowledge, and understanding users might be seeking
6. Include both high-level conceptual searches and specific technical queries
7. Consider different user personas (developers, researchers, learners, analysts, etc.)
8. Think about what questions users might ask or what they might search for

OUTPUT REQUIREMENTS:
Return a JSON array of 8-15 consolidated intent objects with this exact structure:
[{
  "payload": "Clear, comprehensive intent that represents what users are looking for across the document collection",
  "confidence": 0.85
}]

Generate evidence-based consolidated search intents with valid JSON format and appropriate confidence scores (0.6-1.0).
`;

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
    
    // Validate and enhance consolidated intents
    const finalIntents: InferredIntent[] = rawIntents
      .filter(intent => 
        intent.payload && 
        typeof intent.confidence === 'number' &&
        intent.confidence >= 0.6
      )
      .map(intent => ({
        payload: intent.payload,
        confidence: Math.min(intent.confidence, 1.0)
      }));

    console.log(`🎯 Consolidated into ${finalIntents.length} final high-quality intents`);

    return { finalIntents };
  } catch (error) {
    console.error("❌ Error consolidating intents:", error);
    
    // Fallback: return all original intents if consolidation fails
    const fallbackIntents = documentIntents.flatMap(doc => doc.intents);
    
    return { 
      finalIntents: fallbackIntents,
      output: `Intent consolidation failed, returning original intents. Error: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the enhanced workflow
export function createIntentInferrerWorkflow() {
  // Initialize memory for state persistence
  const checkpointer = new MemorySaver();
  
  const workflow = new StateGraph(IntentInferrerState)
  .addNode("loadDocuments", loadDocuments)
  .addNode("generateDocumentIntents", generateDocumentIntents)
  .addNode("consolidateIntents", consolidateIntents)
  .addEdge(START, "loadDocuments")
  .addEdge("loadDocuments", "generateDocumentIntents")
  .addEdge("generateDocumentIntents", "consolidateIntents")
  .addEdge("consolidateIntents", END);

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
      intents: result.finalIntents || [],
      output: result.output || "Intent inference completed successfully",
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