import OpenAI from 'openai';
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import { z } from "zod";
import { searchItems } from "./search_item.js";
import { zodResponseFormat } from "openai/helpers/zod";
import { jsonSchemaToZod } from "json-schema-to-zod";
import tiktoken from 'tiktoken';
import { getModelInfo } from '../utils/mode.js';

const openai = wrapOpenAI(new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
}));

const encoding = tiktoken.encoding_for_model('gpt-4o');

const formatChatHistory = (messages) => {
  if (!Array.isArray(messages)) return '';
  return messages.map(m => `${m.role}: ${m.content}`).join('\n');
};

const countTokens = (text) => {
  try {
    return encoding.encode(text).length;
  } catch (error) {
    console.warn("Warning: model not found. Using o200k_base encoding.");
  }
};

const getDocText = (doc, metadata, runtimeDefinition) => {
  if (metadata.modelId === runtimeDefinition.models.Cast.id) {
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
  
  if (metadata.modelId === runtimeDefinition.models.Event.id) {
    return [
      'Event details:',
      `- title: ${doc.title}`,
      `- location: ${doc.location}`,
      `- start time: ${doc.start_time}`,
      `- end time: ${doc.end_time}`,
      `- link: ${doc.link}`,
      `- description: ${doc.description}`,
      '----'
    ].join('\n');
  }
  
  return JSON.stringify(doc);
};

export const handleCompletions = traceable(async ({ messages, indexIds, maxDocs=500, stream, schema, timeFilter }) => {
  const MAX_TOKENS = 100000;
  let totalTokens = 0;

  const docs = await searchItems({
    indexIds,
    query: formatChatHistory(messages.filter(m => m.role === 'user')),
    limit: maxDocs,
    timeFilter
  }); 

  const { runtimeDefinition } = await getModelInfo();


  const filteredDocs = [];
  for (const item of docs) {
    const docText = getDocText(item.data, item.metadata, runtimeDefinition);
    
    const docTokens = countTokens(docText);
    if (totalTokens + docTokens <= MAX_TOKENS) {
      filteredDocs.push(docText);
      totalTokens += docTokens;
    } else {
      break;
    }
  }


  const retrievedDocs = filteredDocs.join('\n');
  
  console.log('totalTokens', totalTokens)
  

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
});
