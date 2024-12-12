import OpenAI from 'openai';
import { traceable } from "langsmith/traceable";
import { wrapOpenAI } from "langsmith/wrappers";
import { z } from "zod";
import { searchItems } from "./search_item.js";
import { zodResponseFormat } from "openai/helpers/zod";
import { jsonSchemaToZod } from "json-schema-to-zod";
import tiktoken from 'tiktoken';
import * as hub from "langchain/hub";
import { getModelInfo } from '../utils/mode.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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
    
    const formattedText = doc.text.replace(/\\n\\n/g, '\n').replace(/\\n/g, '\n');
    
    return [
      'Cast details:',
      `- text: ${formattedText}`,
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

export const handleCompletions = traceable(async ({ messages, indexIds, maxDocs=500, stream, prompt, schema, timeFilter }) => {
  console.time('handleCompletions:total');
  console.time('handleCompletions:init');
  const MAX_TOKENS = 100000;
  let totalTokens = 0;
  console.timeEnd('handleCompletions:init');

  console.time('handleCompletions:search');
  const docs = await searchItems({
    indexIds,
    query: formatChatHistory(messages.filter(m => m.role === 'user')),
    limit: maxDocs,
    timeFilter
  }); 
  console.timeEnd('handleCompletions:search');

  console.time('handleCompletions:modelInfo');
  const { runtimeDefinition } = await getModelInfo();
  console.timeEnd('handleCompletions:modelInfo');

  console.time('handleCompletions:processDocuments');
  console.time('handleCompletions:tokenCounting');
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
  console.timeEnd('handleCompletions:tokenCounting');

  const retrievedDocs = filteredDocs.join('\n');
  console.timeEnd('handleCompletions:processDocuments');
  
  console.time('handleCompletions:promptSetup');
  const completionsPrompt = await hub.pull(prompt || "v2_completions");
  const completionsPromptText = completionsPrompt.promptMessages[0].prompt.template;


  const completionOptions = {
    model: process.env.MODEL_CHAT,
    messages: [ {
      role: 'system',
      content: completionsPromptText
    },{
      role: 'system', 
      content: `Context information:\n${retrievedDocs || 'No context found'}`
    }, ...messages],
    temperature: 0,
    stream: stream,
  };
  console.timeEnd('handleCompletions:promptSetup');

  if (schema && !stream) {
    console.time('handleCompletions:schema');
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
    console.timeEnd('handleCompletions:schema');
  }

  console.time('handleCompletions:completion');
  console.time('handleCompletions:apiCall');
  const result = await openai.chat.completions.create(completionOptions);
  console.timeEnd('handleCompletions:apiCall');
  console.timeEnd('handleCompletions:completion');

  console.timeEnd('handleCompletions:total');
  return result;
});
