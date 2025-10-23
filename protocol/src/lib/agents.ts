import db from './db';
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "langfuse-langchain";

// Langfuse handler factory
function createLangfuseHandler(sessionId: string, metadata: Record<string, any>) {
  return new CallbackHandler({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
    secretKey: process.env.LANGFUSE_SECRET_KEY || "",
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com",
    sessionId,
    metadata
  });
}

// Factory function to create LLM instance for a specific preset
function createAgentLlm(preset: string): ChatOpenAI {
  return new ChatOpenAI({
    model: `@preset/${preset}`,
    streaming: false,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
    }
  });
}

// Traceable LLM wrapper with Langfuse integration
export function traceableLlm(preset: string, metadata: Record<string, any>) {
  return async (messages: Array<{role: string, content: string}>, options?: { reasoning?: { exclude?: boolean; effort?: 'minimal' | 'low' | 'medium' | 'high'; max_tokens?: number } }) => {
    const handler = createLangfuseHandler(preset, metadata);
    
    // Build modelKwargs with reasoning config if provided
    const modelKwargs: any = {};
    if (options?.reasoning) {
      modelKwargs.reasoning = options.reasoning;
    }
    
    const llm = new ChatOpenAI({
      model: `@preset/${preset}`,
      streaming: false,
      apiKey: process.env.OPENROUTER_API_KEY!,
      configuration: {
        baseURL: 'https://openrouter.ai/api/v1',
      },
      modelKwargs
    });
    
    const response = await llm.invoke(messages, { runName: preset, callbacks: [handler] });
    return response;
  };
}

// Traceable structured output LLM wrapper with Langfuse integration
export function traceableStructuredLlm(preset: string, metadata: Record<string, any>) {
  const llm = createAgentLlm(preset);
  
  return async (messages: Array<{role: string, content: string}>, schema: any) => {
    const handler = createLangfuseHandler(preset, metadata);
    const structuredLlm = llm.withStructuredOutput(schema, {
      name: schema.name || 'structured_output'
    });
    const response = await structuredLlm.invoke(messages, { 
      runName: preset, 
      callbacks: [handler] 
    });
    return response;
  };
}

export default db;
