import db from './db';
import { ChatBedrockConverse } from "@langchain/aws";

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

// Simple Bedrock client for agent decisions
export const llm = new ChatBedrockConverse({
  model: "openai.gpt-oss-120b-1:0", // Using OpenAI GPT OSS 120B
  temperature: 0.1,
  disableStreaming: true,
  region: "us-west-2",
  supportsToolChoiceValues: ["auto", "any", "tool"],
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
  //maxTokens: 512,
  //topP: 0.5,
  tags: ["agent", "llm", "gpt-oss-120b"],
  metadata: { 
    model: "gpt-oss-120b",
    temperature: 1,
    topP: 0.5,
    purpose: "agent-decision-making"
  }
});

// LLM wrapper utility with Langfuse tracing
export function traceableLlm(name: string, tags: string[], metadata: Record<string, any>) {
  return async (prompt: string) => {
    const handler = createLangfuseHandler(name, { ...metadata, tags });
    const response = await llm.invoke(prompt, { runName: name, callbacks: [handler] });
    
    // console.log(JSON.stringify(response, null, 2));
    // Handle new response format with reasoning content
    if (response.content && Array.isArray(response.content)) {
      // Extract text from the new format
      const textContent = response.content
        .map((item: any) => {
          if (item.type === 'reasoning_content' && item.reasoningText?.text) {
            //return item.reasoningText.text;
          } else if (item.type === 'text' && item.text) {
            return item.text;
          } else if (typeof item === 'string') {
            return item;
          }
          return '';
        })
        .filter(Boolean)
        .join('');
      
      // Return response with content as string for backward compatibility
      return {
        ...response,
        content: textContent
      };
    }
    
    // Return as-is if already in expected format
    return response;
  };
}

// Structured output wrapper utility with Langfuse tracing
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
