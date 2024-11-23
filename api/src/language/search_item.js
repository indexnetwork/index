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

  console.time('ceramic-query');
  let ceramicResp = await ceramic.multiQuery(
    results.map((doc) => {
      return {
        streamId: doc.item_id,
      };
    }),
  );
  console.timeEnd('ceramic-query');

  ceramicResp = Object.values(ceramicResp).map((doc) => {
    const { vector, ...contentWithoutVector } = doc.content;
    return {
      id: doc.id.toString(),
      modelName: doc.model,
      controllerDID: doc.state.metadata.controllers[0],
      ...contentWithoutVector,
    };
  });

  console.timeEnd('searchItems-total');
  return ceramicResp;
};

