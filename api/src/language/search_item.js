import { ChromaClient } from "chromadb";

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const chromaClient = new ChromaClient({
  path: 'http://chroma-chromadb.env-mainnet:8000'
});

const collection = await chromaClient.getOrCreateCollection({
  name: "index_mainnet",
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
      model: "text-embedding-3-large",
      input: query,
    });
    const vector = embeddingResponse.data[0].embedding;

    // Build where clause for ChromaDB
    let whereClause = {};
    if (indexIds?.length) {
      whereClause.indexId = { $in: indexIds };
    }
    if (timeFilter) {
      if (timeFilter.from) {
        whereClause.createdAt = { $gte: new Date(timeFilter.from).getTime() };
      }
      if (timeFilter.to) {
        whereClause.createdAt = { $lte: new Date(timeFilter.to).getTime() };
      }
    }

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
    const results = await collection.get({
      where: { indexId: { $in: indexIds } },
      limit: limit + offset
    });

    // Filter and paginate results
    const filteredResults = results.ids
      .map((id, index) => ({
        id,
        metadata: results.metadatas[index],
        data: JSON.parse(results.documents[index])
      }))
      .filter(doc => {
        if (timeFilter) {
          const createdAt = doc.metadata.createdAt;
          if (timeFilter.from && createdAt < new Date(timeFilter.from).getTime()) return false;
          if (timeFilter.to && createdAt > new Date(timeFilter.to).getTime()) return false;
        }
        return true;
      })
      .slice(offset, offset + limit);

    // Log unique model IDs from the filtered results
    const uniqueModelIds = [...new Set(filteredResults.map(r => r.metadata.modelId))];
    console.log('Unique model IDs in filtered results:', uniqueModelIds);

    return filteredResults;
  }
};

