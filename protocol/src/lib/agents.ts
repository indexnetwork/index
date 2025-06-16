import db from './db';
import { ChatOpenAI } from '@langchain/openai';

// Simple OpenAI client for agent decisions
export const llm = new ChatOpenAI({
  model: "gpt-4o-mini",
  temperature: 0.1,
  apiKey: process.env.OPENAI_API_KEY
});

export default db; 