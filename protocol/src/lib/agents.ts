import db from './db';
import { ChatOpenAI } from '@langchain/openai';
import { traceable } from "langsmith/traceable";

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

// Traceable LLM wrapper utility
export const traceableLlm = (name: string, tags: string[], metadata: Record<string, any>) => {
  return traceable(
    async (prompt: string) => await llm.invoke(prompt),
    { name, tags, metadata }
  );
};

// Traceable structured output wrapper utility  
export const traceableStructuredLlm = (name: string, tags: string[], metadata: Record<string, any>) => {
  return traceable(
    async (prompt: string, schema: any) => {
      const modelWithStructure = llm.withStructuredOutput(schema);
      return await modelWithStructure.invoke(prompt);
    },
    { name, tags, metadata }
  );
};

export default db; 