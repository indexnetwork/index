import { Annotation, START, END, StateGraph } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { UnstructuredLoader } from "@langchain/community/document_loaders/fs/unstructured";
import { llm } from "../../lib/agents";
import * as fs from 'fs';
import * as path from 'path';

// Type definitions
export interface FileSummary {
  fileName: string;
  summary: string;
}

export interface SummarizationResult {
  success: boolean;
  summary?: FileSummary;
  error?: string;
}

// State annotation for the workflow
const FileSummarizerState = Annotation.Root({
  filePath: Annotation<string>,
  fileId: Annotation<string>,
  outputPath: Annotation<string>,
  content: Annotation<string | null>,
  summary: Annotation<FileSummary | null>,
  error: Annotation<string | null>
});

type StateType = typeof FileSummarizerState.State;

// Node 1: Load file using UnstructuredLoader with fallback
async function loadFile(state: StateType): Promise<Partial<StateType>> {
  const filePath = state.filePath;
  
  if (!filePath || !fs.existsSync(filePath)) {
    return { 
      content: null,
      error: `File not found: ${filePath}`
    };
  }

  // Try UnstructuredLoader first
  try {
    const loaderOptions: any = {
      recursive: true,
      strategy: "fast"
    };
    
    // Configure with available environment variables
    if (process.env.UNSTRUCTURED_API_KEY) {
      loaderOptions.apiKey = process.env.UNSTRUCTURED_API_KEY;
      loaderOptions.apiUrl = process.env.UNSTRUCTURED_API_URL || "https://api.unstructured.io";
    } else if (process.env.UNSTRUCTURED_SERVER_URL) {
      loaderOptions.apiUrl = process.env.UNSTRUCTURED_SERVER_URL;
    }

    const loader = new UnstructuredLoader(filePath, loaderOptions);
    const documents = await loader.load();
    
    if (documents.length > 0) {
      const content = documents.map(doc => doc.pageContent).join('\n\n');
      return { content };
    }
  } catch (error) {
    console.warn(`UnstructuredLoader failed for ${path.basename(filePath)}, trying fallback:`, error instanceof Error ? error.message : 'Unknown error');
  }

  // Fallback: try to read as text file
  try {
    const ext = path.extname(filePath).toLowerCase();
    const textExtensions = ['.txt', '.md', '.json', '.csv', '.js', '.ts', '.py', '.html', '.css', '.xml', '.yml', '.yaml'];
    
    if (textExtensions.includes(ext) || ext === '') {
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.trim()) {
        return { content };
      }
    }
    
    return {
      content: null,
      error: `Cannot process ${ext} files without Unstructured API. Please set UNSTRUCTURED_API_KEY or UNSTRUCTURED_SERVER_URL for document support.`
    };
  } catch (error) {
    return { 
      content: null,
      error: `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Node 2: Generate markdown summary
async function generateSummary(state: StateType): Promise<Partial<StateType>> {
  const content = state.content;
  const filePath = state.filePath;
  
  if (!content || !filePath) {
    return { 
      summary: null,
      error: 'No content to summarize'
    };
  }

  try {
    const fileName = path.basename(filePath);
    
    const prompt = `Analyze this file and create a markdown summary:

FILE: ${fileName}
CONTENT:
${content}

Create a concise markdown summary with:
- What the file is about
- Key information or topics
- Important details

Keep it clear and useful.`;

    const response = await llm.invoke(prompt);
    const summaryContent = response.content as string;
    
    const summary: FileSummary = {
      fileName: fileName,
      summary: summaryContent
    };

    return { summary };
  } catch (error) {
    return { 
      summary: null,
      error: `Error generating summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Node 3: Save summary to {fileId}.summary file
async function saveSummary(state: StateType): Promise<Partial<StateType>> {
  const summary = state.summary;
  const fileId = state.fileId;
  const outputPath = state.outputPath;
  
  if (!summary || !fileId || !outputPath) {
    return {
      error: 'Missing data for saving summary'
    };
  }

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const summaryPath = path.join(outputDir, `${fileId}.summary`);
    fs.writeFileSync(summaryPath, summary.summary, 'utf8');
    
    return {};
  } catch (error) {
    return { 
      error: `Error saving summary: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

// Create the workflow graph
export function createFileSummarizerWorkflow() {
  const workflow = new StateGraph(FileSummarizerState)
    .addNode("loadFile", loadFile)
    .addNode("generateSummary", generateSummary)
    .addNode("saveSummary", saveSummary)
    .addEdge(START, "loadFile")
    .addConditionalEdges("loadFile", (state) => {
      return state.content ? "generateSummary" : END;
    })
    .addConditionalEdges("generateSummary", (state) => {
      return state.summary ? "saveSummary" : END;
    })
    .addEdge("saveSummary", END);

  const checkpointer = new MemorySaver();
  return workflow.compile({ checkpointer });
}

// Main function to process a single file
export async function processFile(
  filePath: string, 
  fileId: string, 
  outputDirectory: string
): Promise<SummarizationResult> {
  try {
    const workflow = createFileSummarizerWorkflow();
    const outputPath = path.join(outputDirectory, `${fileId}.summary`);
    
    const config = { 
      configurable: { thread_id: `file_${fileId}` }
    };
    
    const initialState = {
      filePath,
      fileId,
      outputPath,
      content: null,
      summary: null,
      error: null
    };

    const result = await workflow.invoke(initialState, config);
    
    if (result.error) {
      return {
        success: false,
        error: result.error
      };
    }
    
    if (result.summary) {
      return {
        success: true,
        summary: result.summary
      };
    }
    
    return {
      success: false,
      error: 'Unknown processing error'
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
} 