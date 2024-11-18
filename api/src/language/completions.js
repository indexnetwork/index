import OpenAI from 'openai';
import { searchItems } from "./search_item.js";
import { zodResponseFormat } from "openai/helpers/zod";
import { jsonSchemaToZod } from "json-schema-to-zod";

import { z } from "zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const formatChatHistory = (messages) => {
  if (!Array.isArray(messages)) return '';
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
};

export const handleCompletions = async ({ messages, indexIds, maxDocs=500, stream, schema, timeFilter }) => {

  // TODO indexIds is optional because of chat summary.
  
  // Fetch relevant documents
  const docs = await searchItems({
    indexIds,
    query: formatChatHistory(messages),
    limit: maxDocs,
    timeFilter
  }); 

  console.log(timeFilter, docs.length)
  

  const retrievedDocs = docs
    .map(doc => {
      if (doc.object === "cast") {
        return `Cast details: 
- text: ${doc.text}
- link: https://warpcast.com/${doc.author.username}/${doc.hash.substring(0, 12)}
- author: [${doc.author.name || doc.author.username}](https://warpcast.com/${doc.author.username})
- created_at: ${doc.timestamp}
          ----
`;
      }
      return JSON.stringify(doc);
    })
    .join('\n');
  
    

  if (retrievedDocs) {
    messages.push({
      role: 'system',
      content: `Context information:\n${retrievedDocs}`
    });
  }

  
  const completionOptions = {
    model: process.env.MODEL_CHAT,
    messages,
    temperature: 0,
    stream: stream,
  };

  // Add response_format if schema is provided and streaming is disabled
  if (schema && !stream) {
    // Add validation to ensure schema has the expected structure
    if (!schema.definitions?.response) {
      throw new Error('Invalid schema format: missing definitions.response');
    }
    
    try {
      const zodSchema = eval(jsonSchemaToZod(schema.definitions.response));
      completionOptions.response_format = zodResponseFormat(zodSchema, 'response');
    } catch (error) {
      console.error('Error processing schema:', error);
      throw new Error('Failed to process schema format');
    }
  }

  const result =  openai.chat.completions.create(completionOptions);
  return result
};
