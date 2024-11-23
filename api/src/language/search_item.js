import { CeramicClient } from "@ceramicnetwork/http-client";
import pkg from "knex";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const ceramic = new CeramicClient(process.env.CERAMIC_HOST);
const { knex } = pkg;

const cli = knex({
  client: "pg",
  connection: process.env.POSTGRES_CONNECTION_STRING,
});

export const searchItems = async (params) => {
  console.time('searchItems-total');
  const { 
    indexIds, 
    query, 
    limit = 500, 
    offset = 0, 
    timeFilter  // Add timeFilter parameter
  } = params;

  let embeddingQuery = cli('index_embeddings')
    .select([
      'index_id',
      'item_id', 
      'model_id',
      'stream_id',
      'category',
      'model_name',
      'description',
      'created_at',
      'updated_at'
    ])
    .whereIn('index_id', indexIds)
    .whereNull('deleted_at');

    // Add date filters if provided
  if (timeFilter) {
    if (timeFilter.from) {
      embeddingQuery = embeddingQuery.where('created_at', '>=', timeFilter.from);
    }
    if (timeFilter.to) {
      embeddingQuery = embeddingQuery.where('created_at', '<=', timeFilter.to);
    }
  }
  
  // Only add vector search if query is provided
  if (query) {
    console.time('embedding-generation');
    const embeddingResponse = await openai.embeddings.create({
      model: process.env.MODEL_EMBEDDING,
      input: query,
    });
    console.timeEnd('embedding-generation');
    const vector = embeddingResponse.data[0].embedding;

    // Set HNSW search parameter
    await cli.raw('SET hnsw.ef_search = 1000');
    
    // Add vector similarity search to select clause
    embeddingQuery = embeddingQuery.select(
      cli.raw('vector <=> ?::vector AS distance', [cli.raw(`'[${vector.join(',')}]'::vector(1536)`)])
    );
    
    // Order by distance when doing vector search
    embeddingQuery = embeddingQuery.orderBy('distance');
  }

  

  embeddingQuery = embeddingQuery
    .limit(limit)
    .offset(offset);

    

  // Log the final query before execution
  const queryString = embeddingQuery.toString();
  console.log('Executing query:', queryString);
  
  console.time('database-query');
  const results = await embeddingQuery;
  console.timeEnd('database-query');

  console.time('model-content-query');
  // Group results by model_id
  const groupedByModel = results.reduce((acc, doc) => {
    if (!acc[doc.model_id]) {
      acc[doc.model_id] = [];
    }
    acc[doc.model_id].push(doc);
    return acc;
  }, {});

  // Query each model table once with all relevant stream_ids
  const contentPromises = Object.entries(groupedByModel).map(async ([modelId, docs]) => {
    const streamIds = docs.map(doc => doc.item_id);
    const modelResults = await cli(modelId)
      .select(['stream_id', 'stream_content'])
      .whereIn('stream_id', streamIds);

    // Create a lookup map for quick access
    const contentMap = modelResults.reduce((acc, row) => {
      acc[row.stream_id] = row.stream_content;
      return acc;
    }, {});

    // Map back to original order with content
    return docs.map(doc => {
      const content = contentMap[doc.item_id];
      if (!content) return null;

      const { vector, ...contentWithoutVector } = content;
      return {
        id: doc.item_id,
        modelName: doc.model_name,
        controllerDID: content.controllers?.[0] || null,
        ...contentWithoutVector,
      };
    });
  });

  const ceramicResp = (await Promise.all(contentPromises))
    .flat()
    .filter(Boolean);
  console.timeEnd('model-content-query');

  console.timeEnd('searchItems-total');
  return ceramicResp;
};

