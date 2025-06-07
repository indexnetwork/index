import { processFolder, InferredIntent } from './workflow';
import * as fs from 'fs';

/**
 * Intent Inferrer Agent Integration
 * 
 * This agent analyzes a folder/codebase using local RAG and generates
 * potential intents that users might have based on the files found.
 */

// Enhanced result interface
export interface IntentInferenceResult {
  success: boolean;
  intents: InferredIntent[];
  output: string;
  error?: string;
  metadata?: {
    folderPath: string;
    processingTime: number;
    unstructuredEnabled: boolean;
    parsingMethod: 'api' | 'local' | 'fallback';
  };
}

// Configuration interface for the agent
export interface AgentConfig {
  version: string;
  name: string;
  description: string;
  supportedFileTypes: {
    basic: string[];
    advanced: string[];
  };
  requirements: {
    unstructuredAPI?: boolean;
    environment?: string[];
  };
}

/**
 * Main function to process a folder and generate intents
 * @param folderPath - Absolute path to the folder to analyze
 * @returns Promise with analysis results and inferred intents
 */
export async function analyzeFolder(
  folderPath: string,  
  options: {
    timeoutMs?: number;
  } = {}
): Promise<IntentInferenceResult> {
  const startTime = Date.now();
  
  try {
    // Validate folder path
    if (!folderPath || !fs.existsSync(folderPath)) {
      return {
        success: false,
        intents: [],
        output: "",
        error: `Folder path "${folderPath}" does not exist or is not accessible`,
        metadata: {
          folderPath,
          processingTime: Date.now() - startTime,
          unstructuredEnabled: false,
          parsingMethod: 'fallback'
        }
      };
    }

    const folderStat = fs.statSync(folderPath);
    if (!folderStat.isDirectory()) {
      return {
        success: false,
        intents: [],
        output: "",
        error: `Path "${folderPath}" is not a directory`,
        metadata: {
          folderPath,
          processingTime: Date.now() - startTime,
          unstructuredEnabled: false,
          parsingMethod: 'fallback'
        }
      };
    }

    // Determine parsing method based on environment
    let parsingMethod: 'api' | 'local' | 'fallback' = 'fallback';
    const unstructuredEnabled = !!(process.env.UNSTRUCTURED_API_KEY || process.env.UNSTRUCTURED_SERVER_URL);
    
    if (process.env.UNSTRUCTURED_API_KEY) {
      parsingMethod = 'api';
    } else if (process.env.UNSTRUCTURED_SERVER_URL) {
      parsingMethod = 'local';
    }

    // Process the folder with timeout handling
    const timeoutMs = options.timeoutMs || 300000; // 5 minute default timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Processing timeout exceeded')), timeoutMs);
    });

    const result = await Promise.race([
      processFolder(folderPath),
      timeoutPromise
    ]);

    const processingTime = Date.now() - startTime;

    return {
      success: true,
      intents: result.intents,
      output: result.output,
      metadata: {
        folderPath,
        processingTime,
        unstructuredEnabled,
        parsingMethod
      }
    };

  } catch (error) {
    console.error('Intent inference error:', error);
    
    return {
      success: false,
      intents: [],
      output: "",
      error: error instanceof Error ? error.message : 'Unknown error occurred',
      metadata: {
        folderPath,
        processingTime: Date.now() - startTime,
        unstructuredEnabled: !!(process.env.UNSTRUCTURED_API_KEY || process.env.UNSTRUCTURED_SERVER_URL),
        parsingMethod: 'fallback'
      }
    };
  }
}

/**
 * Quick function to get just the intents array without full analysis
 * @param folderPath - Absolute path to the folder to analyze
 * @returns Promise with array of inferred intents
 */
export async function getIntents(folderPath: string): Promise<InferredIntent[]> {
  const result = await analyzeFolder(folderPath);
  return result.intents;
}



/**
 * Get top intents by confidence score
 * @param intents - Array of inferred intents
 * @param limit - Maximum number of intents to return
 * @returns Top intents sorted by confidence
 */
export function getTopIntentsByConfidence(
  intents: InferredIntent[], 
  limit: number = 5
): InferredIntent[] {
  return intents
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}


/**
 * Validate folder path before processing
 * @param folderPath - Path to validate
 * @returns Validation result
 */
export function validateFolderPath(folderPath: string): {
  isValid: boolean;
  error?: string;
} {
  if (!folderPath || typeof folderPath !== 'string') {
    return { isValid: false, error: 'Folder path is required and must be a string' };
  }
  
  if (!folderPath.trim()) {
    return { isValid: false, error: 'Folder path cannot be empty' };
  }
  
  // Additional validation could be added here
  // e.g., check if path exists, is accessible, etc.
  
  return { isValid: true };
}

/**
 * Get the agent configuration for external use
 */
export function getAgentConfig(): AgentConfig {
  const hasUnstructuredAPI = !!process.env.UNSTRUCTURED_API_KEY;
  const hasLocalServer = !!process.env.UNSTRUCTURED_SERVER_URL;
  
  return {
    version: "3.0.0",
    name: "Intent Inferrer Agent",
    description: "Advanced document analysis and intent inference using Unstructured and LangGraph",
    supportedFileTypes: {
      basic: [
        ".ts", ".js", ".tsx", ".jsx", ".py", ".md", ".txt", 
        ".json", ".yaml", ".yml", ".sql", ".html", ".htm", 
        ".xml", ".csv"
      ],
      advanced: hasUnstructuredAPI || hasLocalServer ? [
        ".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls",
        ".rtf", ".odt", ".epub", ".eml", ".msg"
      ] : []
    },
    requirements: {
      unstructuredAPI: hasUnstructuredAPI,
      environment: [
        ...(hasUnstructuredAPI ? ["UNSTRUCTURED_API_KEY"] : []),
        ...(hasLocalServer ? ["UNSTRUCTURED_SERVER_URL"] : []),
        "OPENAI_API_KEY (for LLM inference)"
      ]
    }
  };
}

/**
 * Utility function to validate environment setup
 */
export function validateEnvironment(): {
  isValid: boolean;
  warnings: string[];
  errors: string[];
  recommendations: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  const recommendations: string[] = [];

  // Check for OpenAI API key (required for LLM)
  if (!process.env.OPENAI_API_KEY) {
    errors.push("OPENAI_API_KEY is required for intent generation");
  }

  // Check Unstructured setup
  const hasUnstructuredAPI = !!process.env.UNSTRUCTURED_API_KEY;
  const hasLocalServer = !!process.env.UNSTRUCTURED_SERVER_URL;

  if (!hasUnstructuredAPI && !hasLocalServer) {
    warnings.push("No Unstructured API key or server URL found");
    recommendations.push("Set UNSTRUCTURED_API_KEY for advanced document parsing");
    recommendations.push("Or set UNSTRUCTURED_SERVER_URL for local Docker server");
  }

  if (hasUnstructuredAPI && hasLocalServer) {
    warnings.push("Both UNSTRUCTURED_API_KEY and UNSTRUCTURED_SERVER_URL are set - API key will take precedence");
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
    recommendations
  };
}

/**
 * Function to test the agent setup
 */
export async function testSetup(testFolderPath?: string): Promise<{
  success: boolean;
  message: string;
  details: any;
}> {
  try {
    const envValidation = validateEnvironment();
    const config = getAgentConfig();
    
    if (!envValidation.isValid) {
      return {
        success: false,
        message: "Environment validation failed",
        details: {
          errors: envValidation.errors,
          warnings: envValidation.warnings,
          recommendations: envValidation.recommendations
        }
      };
    }

    // Test with actual folder if provided
    if (testFolderPath) {
      const result = await analyzeFolder(testFolderPath);
      return {
        success: result.success,
        message: result.success ? "Agent test completed successfully" : "Agent test failed",
        details: {
          config,
          testResult: result,
          environment: envValidation
        }
      };
    }

    return {
      success: true,
      message: "Agent configuration is valid",
      details: {
        config,
        environment: envValidation
      }
    };

  } catch (error) {
    return {
      success: false,
      message: "Agent test failed with error",
      details: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    };
  }
}

// Export types for external use
export type { InferredIntent } from './workflow'; 