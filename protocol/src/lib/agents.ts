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
    
    // Add JSON formatting instructions to the prompt
    const jsonPrompt = `${prompt}

IMPORTANT: Return your response as a valid JSON object that matches this structure exactly. Do not include any text before or after the JSON.`;
    
    const response = await llm.invoke(jsonPrompt, { runName: name, callbacks: [handler] });
    
    // Extract the text content
    let textContent = '';
    if (typeof response === 'string') {
      textContent = response;
    } else if (response && typeof response === 'object' && 'content' in response) {
      if (Array.isArray(response.content)) {
        for (const item of response.content) {
          if (item.type === 'text' && item.text) {
            textContent += item.text;
          }
        }
      } else if (typeof response.content === 'string') {
        textContent = response.content;
      }
    }
    
    // Try to parse the JSON response
    try {
      // Remove any markdown code blocks if present
      textContent = textContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const parsed = JSON.parse(textContent);
      
      // Validate against schema if zod is available
      if (schema && schema.parse) {
        return schema.parse(parsed);
      }
      
      return parsed;
    } catch (error) {
      console.error('Failed to parse structured output:', error);
      console.error('Raw response:', textContent);
      throw new Error('Failed to parse AI response as JSON');
    }
  };
}

export default db; 