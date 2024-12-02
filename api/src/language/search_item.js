import { ChromaClient } from "chromadb";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chromaClient = new ChromaClient({
  path: 'http://chroma-chromadb.env-mainnet:8000'
});

const collection = await chromaClient.getOrCreateCollection({
  name: process.env.CHROMA_COLLECTION_NAME || "index_mainnet"
});

export const searchItems = async (params) => {
  const { 
    indexIds, 
    query, 
    limit = 500, 
    offset = 0, 
    timeFilter 
  } = params;

  // If there's a query, perform vector similarity search
  if (query) {
    const embeddingResponse = await openai.embeddings.create({
      model: process.env.MODEL_EMBEDDING,
      input: query,
    });
    const vector = embeddingResponse.data[0].embedding;

    // Build where clause for ChromaDB
    let whereClause = {};
    const conditions = [];
    
    if (indexIds?.length) {
      conditions.push({ indexId: { $in: indexIds } });
    }
    
    if (timeFilter) {
      if (timeFilter.from) {
        conditions.push({ createdAt: { $gte: new Date(timeFilter.from).getTime() } });
      }
      if (timeFilter.to) {
        conditions.push({ createdAt: { $lte: new Date(timeFilter.to).getTime() } });
      }
    }

    if (conditions.length > 0) {
      whereClause = conditions.length === 1 ? conditions[0] : { $and: conditions };
    }

    console.log('whereClause', whereClause);
    const results = await collection.query({
      queryEmbeddings: [vector],
      nResults: 1000,
      where: Object.keys(whereClause).length ? whereClause : undefined,
    });

    // Transform results to match previous format
    return results.ids[0].map((id, index) => ({
      id,
      metadata: results.metadatas[0][index],
      data: JSON.parse(results.documents[0][index])
    }));

  } else {
    // For non-query searches, get all documents and filter
    // Build where clause for ChromaDB
    let whereClause = { indexId: { $in: indexIds } };
    
    if (timeFilter) {
      whereClause = {
        $and: [
          whereClause,
          timeFilter.from && { createdAt: { $gte: new Date(timeFilter.from).getTime() } },
          timeFilter.to && { createdAt: { $lte: new Date(timeFilter.to).getTime() } }
        ].filter(Boolean)
      };
    }

    const results = await collection.get({
      where: whereClause,
      limit: limit + offset
    });

    // Map results
    const filteredResults = results.ids
      .map((id, index) => ({
        id,
        metadata: results.metadatas[index],
        data: JSON.parse(results.documents[index])
      }))
      .slice(offset, offset + limit);

    // Log unique model IDs from the filtered results  
    const uniqueModelIds = [...new Set(filteredResults.map(r => r.metadata.modelId))];
    console.log('Unique model IDs in filtered results:', uniqueModelIds);

    return filteredResults;
  }
};

