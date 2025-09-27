import db from './db';
import { ChatOpenAI } from "@langchain/openai";
import { CallbackHandler } from "langfuse-langchain";

// Helper function to create Langfuse callback handler
function createLangfuseHandler(sessionId: string, metadata: Record<string, any>) {
  return new CallbackHandler({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY || "",
    secretKey: process.env.LANGFUSE_SECRET_KEY || "",
    baseUrl: process.env.LANGFUSE_BASE_URL || "https://us.cloud.langfuse.com",
    sessionId,
    metadata
  });
}


// OpenRouter client for agent decisions
export const llm = new ChatOpenAI({
  model: process.env.OPENROUTER_MODEL || "openrouter/auto",
  streaming: false,
  apiKey: process.env.OPENROUTER_API_KEY!,
  reasoning: {
    effort: 'minimal',
  },
  
  configuration: {
    baseURL: 'https://openrouter.ai/api/v1',
  }
});


// LLM wrapper utility with Langfuse tracing - uses single ChatOpenAI instance
export function traceableLlm(name: string, tags: string[], metadata: Record<string, any>) {
  return async (prompt: string) => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    
    const response = await llm.invoke(prompt, { runName: name, callbacks: [handler] });
    
    // OpenRouter normalizes all responses to OpenAI format
    return response;
  };
}

// Structured output wrapper utility with Langfuse tracing - uses single ChatOpenAI instance
export function traceableStructuredLlm(name: string, tags: string[], metadata: Record<string, any>) {
  return async (prompt: string, schema: any) => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    
    // Use LangChain's native withStructuredOutput method
    const structuredLlm = llm.withStructuredOutput(schema, {
      name: schema.name || 'structured_output'
    });
    
    const response = await structuredLlm.invoke(prompt, { 
      runName: name, 
      callbacks: [handler] 
    });
    
    return response;
  };
}


export default db; 