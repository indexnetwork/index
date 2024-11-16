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
  const { 
    indexIds, 
    query, 
    limit = 500, 
    offset = 0, 
    dateFilter  // Add date filter parameter
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

  // Only add vector search if query is provided
  if (query) {
    const embeddingResponse = await openai.embeddings.create({
      model: process.env.MODEL_EMBEDDING,
      input: query,
    });
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

  // Add date filters if provided
  if (dateFilter) {
    if (dateFilter.from) {
      embeddingQuery = embeddingQuery.where('created_at', '>=', dateFilter.from);
    }
    if (dateFilter.to) {
      embeddingQuery = embeddingQuery.where('created_at', '<=', dateFilter.to);
    }
  }

  embeddingQuery = embeddingQuery
    .limit(limit)
    .offset(offset);

    

  const results = await embeddingQuery;
  console.log("results", results.length)

  let ceramicResp = await ceramic.multiQuery(
    results.map((doc) => {
      return {
        streamId: doc.item_id,
      };
    }),
  );
  
  ceramicResp = Object.values(ceramicResp).map((doc) => {
    const { vector, ...contentWithoutVector } = doc.content;
    return {
      id: doc.id.toString(),
      modelName: doc.model,
      controllerDID: doc.state.metadata.controllers[0],
      ...contentWithoutVector,
    };
  });

  return ceramicResp;
};

