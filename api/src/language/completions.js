import OpenAI from 'openai';
import { z } from "zod";
import { searchItems } from "./search_item.js";
import { zodResponseFormat } from "openai/helpers/zod";
import { jsonSchemaToZod } from "json-schema-to-zod";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const formatChatHistory = (messages) => {
  if (!Array.isArray(messages)) return '';
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
};

export const handleCompletions = async ({ messages, indexIds, maxDocs=500, stream, schema, timeFilter }) => {

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
        const authorName = doc.author.name || doc.author.username;
        const castUrl = `https://warpcast.com/${doc.author.username}/${doc.hash.substring(0, 12)}`;
        const authorUrl = `https://warpcast.com/${doc.author.username}`;
        
        return [
          'Cast details:',
          `- text: ${doc.text}`,
          `- link: ${castUrl}`, 
          `- author: [${authorName}](${authorUrl})`,
          `- created_at: ${doc.timestamp}`,
          '----'
        ].join('\n');
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

  if (schema && !stream) {
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