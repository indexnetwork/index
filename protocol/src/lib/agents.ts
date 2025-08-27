import db from './db';
import { ChatOpenAI } from '@langchain/openai';
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

// Simple OpenAI client for agent decisions
export const llm = new ChatOpenAI({
  model: "gpt-4o",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY,
  tags: ["agent", "llm", "gpt-4o"],
  metadata: { 
    model: "gpt-4o",
    temperature: 0.1,
    purpose: "agent-decision-making"
  }
});

// LLM wrapper utility with Langfuse tracing
export function traceableLlm(name: string, tags: string[], metadata: Record<string, any>) {
  return async (prompt: string) => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    return await llm.invoke(prompt, { runName: name, callbacks: [handler] });
  };
}

// Structured output wrapper utility with Langfuse tracing
export function traceableStructuredLlm(name: string, tags: string[], metadata: Record<string, any>) {
  return async (prompt: string, schema: any) => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    const modelWithStructure = llm.withStructuredOutput(schema);
    return await modelWithStructure.invoke(prompt, { runName: name, callbacks: [handler] });
  };
}

export default db; 