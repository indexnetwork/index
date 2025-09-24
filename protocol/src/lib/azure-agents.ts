import db from './db';
import { AzureChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "langfuse-langchain";
import { z } from "zod";

// Azure OpenAI Configuration Interface (using proper AzureChatOpenAI parameters)
export interface AzureOpenAIConfig {
  azureOpenAIApiKey?: string;
  azureOpenAIEndpoint?: string;
  azureOpenAIApiInstanceName?: string;
  azureOpenAIApiDeploymentName?: string;
  azureOpenAIApiVersion?: string;
  temperature?: number;
  maxConcurrency?: number;
  maxRetries?: number;
}

// Helper function to create Langfuse callback handler
function createLangfuseHandler(sessionId: string, metadata: Record<string, unknown>) {
  return new CallbackHandler({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
    secretKey: process.env.LANGFUSE_SECRET_KEY || "",
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com",
    sessionId,
    metadata
  });
}

// Azure OpenAI LLM setup function using proper AzureChatOpenAI
export function createAzureOpenAI(config?: AzureOpenAIConfig): AzureChatOpenAI {
  console.log('Setting up Azure OpenAI with LangChain');
  
  const azureConfig = {
    azureOpenAIApiKey: config?.azureOpenAIApiKey || process.env.AZURE_OPENAI_API_KEY,
    azureOpenAIEndpoint: config?.azureOpenAIEndpoint || process.env.AZURE_OPENAI_ENDPOINT,
    azureOpenAIApiDeploymentName: config?.azureOpenAIApiDeploymentName || process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o',
    azureOpenAIApiVersion: config?.azureOpenAIApiVersion || process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview',
    temperature: config?.temperature || 0.1,
    maxConcurrency: config?.maxConcurrency || 5,
    maxRetries: config?.maxRetries || 3,
  };
  
  console.log(`Using Azure OpenAI endpoint: ${azureConfig.azureOpenAIEndpoint}`);
  console.log(`Using deployment name: ${azureConfig.azureOpenAIApiDeploymentName}`);
  console.log(`Using API version: ${azureConfig.azureOpenAIApiVersion}`);
  
  return new AzureChatOpenAI(azureConfig);
}

// Main LLM export - Azure OpenAI instance
export const llm = createAzureOpenAI();

// LLM wrapper utility with Langfuse tracing (Azure OpenAI only)
export function traceableLlm(name: string, tags: string[], metadata: Record<string, unknown>, azureConfig?: AzureOpenAIConfig) {
  return async (prompt: string) => {
    console.log('traceableLlm');
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    const selectedLlm = azureConfig ? createAzureOpenAI(azureConfig) : llm;
    const response = await selectedLlm.invoke(prompt, { runName: name, callbacks: [handler] });
    
    // Handle response format - Azure OpenAI typically returns simple string content
    return response;
  };
}

// Structured output wrapper utility with Langfuse tracing (Azure OpenAI only)
export function traceableStructuredLlm(
  name: string, 
  tags: string[], 
  metadata: Record<string, unknown>, 
  azureConfig?: AzureOpenAIConfig
) {
  return async <T = Record<string, unknown>>(prompt: string, schema: z.ZodType<T> | Record<string, unknown>): Promise<T> => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    const selectedLlm = azureConfig ? createAzureOpenAI(azureConfig) : llm;
    console.log('traceableStructuredLlm');
    try {
      // Use AzureChatOpenAI's native withStructuredOutput method
      const structuredLlm = selectedLlm.withStructuredOutput(schema, {
        name: typeof schema === 'object' && 'name' in schema ? schema.name as string : 'structured_output',
        method: 'functionCalling' // Explicitly use function calling for better reliability
      });
      
      const response = await structuredLlm.invoke(prompt, { 
        runName: name, 
        callbacks: [handler] 
      });

      console.log(JSON.stringify(response, null, 2));
      
      return response as T;
    } catch (error) {
      console.error('Structured output error:', error);
      console.error('Prompt:', prompt);
      console.error('Schema:', schema);
      throw error;
    }
  };
}

export default db;