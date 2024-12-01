import { ComposeClient } from "@composedb/client";
import { getCurrentDateTime } from "../utils/helpers.js";
import { IndexService } from "./index.js";
import pkg from "knex";
import { ChromaClient } from 'chromadb';
import OpenAI from "openai";
import { getModelInfo } from "../utils/mode.js";


const { knex } = pkg;

const cli = knex({
  client: "pg",
  connection: process.env.POSTGRES_CONNECTION_STRING,
});

const chromaClient = new ChromaClient({
  path: 'http://chroma-chromadb.env-mainnet:8000'
});

const collection = await chromaClient.getOrCreateCollection({
  name: process.env.CHROMA_COLLECTION_NAME || "index_mainnet",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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


export class EmbeddingService {
  constructor(definition) {
    this.definition = definition;
    this.client = new ComposeClient({
      ceramic: process.env.CERAMIC_HOST,
      definition,
    });
    this.did = null;
    this.indexService = new IndexService(definition);
  }

  setSession(session) {
    if (session && session.did.authenticated) {
      this.did = session.did;
    }
    return this;
  }

  async getEmbeddingById(id) {
    try {
      let { data, errors } = await this.client.executeQuery(`
            {
              node(id: "${id}") {
                ... on Embedding {
                  id
                  indexId
                  itemId
                  controllerDID {
                    id
                  }
                  modelName
                  category
                  context
                  vector
                  description
                  createdAt
                  updatedAt
                  deletedAt
                  item {
                    id
                    __typename
                  }
                  index {
                    id
                    title
                    controllerDID {
                      id
                    }
                    signerPublicKey
                    signerFunction
                    createdAt
                    updatedAt
                    deletedAt
                  }
                }
              }
            }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error getting index item: ${JSON.stringify(errors)}`);
      }
      // Validate the data response
      if (!data || !data.node) {
        throw new Error("Invalid response data");
      }

      return data.node;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in getEmbeddingById:", error);
      throw error;
    }
  }

  async getEmbedding(indexId, itemId, modelName, category) {
    try {
      const index = await this.indexService.getIndexById(indexId);
      const { data, errors } = await this.client.executeQuery(`
        {
          node(id: "${indexId}") {
            ... on Index {
              embeddings(
                first: 1
                account: "${index.controllerDID.id}"
                filters: {
                  where: {
                    itemId: {
                      equalTo: "${itemId}"
                    },
                    modelName: {
                      equalTo: "${modelName}"
                    },
                    category: {
                      equalTo: "${category}"
                    },
                    deletedAt: {
                      isNull: true
                    }
                  }
                }
              ) {
                edges {
                  node {
                    id
                    indexId
                    itemId
                    controllerDID {
                      id
                    }
                    modelName
                    category
                    context
                    vector
                    description
                    item {
                      id
                      __typename
                    }
                    index {
                      id
                      title
                      controllerDID {
                        id
                      }
                      signerPublicKey
                      signerFunction
                      createdAt
                      updatedAt
                      deletedAt
                    }
                    createdAt
                    updatedAt
                    deletedAt
                  }
                }
              }
            }
          }
        }
        `);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error getting index item: ${JSON.stringify(errors)}`);
      }
      // Validate the data response
      if (
        !data ||
        !data.node ||
        !data.node.embeddings ||
        !data.node.embeddings.edges
      ) {
        throw new Error("Invalid response data");
      }

      const embeddingResp = data.node.embeddings.edges;

      if (embeddingResp.length === 0) {
        return null;
      }

      return embeddingResp[0].node;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in embeddingIndex:", error);
      throw error;
    }
  }

  async createEmbedding(params) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }
    try {
      const embedding = await this.getEmbedding(
        params.indexId,
        params.itemId,
        params.modelName,
        params.category,
      );
      if (embedding) {
        return embedding;
      }

      const content = {
        ...params,
        createdAt: getCurrentDateTime(),
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
                mutation CreateEmbedding($input: CreateEmbeddingInput!) {
                    createEmbedding(input: $input) {
                        document {
                            id
                            indexId
                            itemId
                            controllerDID {
                              id
                            }
                            modelName
                            category
                            context
                            vector
                            description
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`,
        { input: { content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error creating embedding: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.createEmbedding || !data.createEmbedding.document) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      return data.createEmbedding.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createEmbedding:", error);
    }
  }

  async updateEmbedding(params) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }
    try {
      const embedding = await this.getEmbedding(
        params.indexId,
        params.itemId,
        params.modelName,
        params.category,
      );
      if (!embedding) {
        throw new Error("Embedding does not exist.");
      }

      const content = {
        ...params,
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
                mutation UpdateEmbedding($input: UpdateEmbeddingInput!) {
                    updateEmbedding(input: $input) {
                        document {
                            id
                            indexId
                            itemId
                            controllerDID {
                              id
                            }
                            modelName
                            category
                            context
                            vector
                            description
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`,
        { input: { id: embedding.id, content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error updating embedding: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.updateEmbedding || !data.updateEmbedding.document) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      return data.updateEmbedding.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateEmbedding:", error);
      throw error;
    }
  }

  async deleteEmbedding(params) {
    const content = {
      ...params,
      updatedAt: getCurrentDateTime(),
      deletedAt: getCurrentDateTime(),
    };
    return await this.updateEmbedding(content);
  }

  
  async findAndUpsertEmbeddingsByIndexIds(indexIds) {
    try {
      const BATCH_SIZE = 1000;
      let processedCount = 0;
      
      const { runtimeDefinition } = await getModelInfo();

      while (true) {
        const embeddings = await cli('index_embeddings')
          .select('*')
          .whereIn('index_id', indexIds)
          .whereNull('deleted_at')
          .offset(processedCount)
          .limit(BATCH_SIZE);

        if (embeddings.length === 0) break;

        // Get IDs to check in Chroma
        const ids = embeddings.map(e => e.stream_id);
        
        // Check which IDs already exist in Chroma
        const existingEmbeddings = await collection.get({
          ids,
          include: ['metadatas']
        });

        // Filter out embeddings that already exist and have same metadata
        const newEmbeddings = embeddings.filter(embedding => {
          const existing = existingEmbeddings.metadatas?.find(m => 
            m?.itemId === embedding.item_id && 
            m?.modelId === embedding.model_id &&
            m?.indexId === embedding.index_id
          );
          return !existing;
        });

        if (newEmbeddings.length > 0) {
          // Process only new embeddings
          const datas = await Promise.all(newEmbeddings.map(async (a) => {
            const itemStream = await cli(a.model_id)
              .select('stream_content')
              .where('stream_id', a.item_id)
              .first();
            return itemStream.stream_content;
          }));

          const formattedTexts = datas.map((doc, index) => 
            getDocText(doc, {
              modelId: newEmbeddings[index].model_id
            }, runtimeDefinition)
          );

          const newEmbeddingVectors = await Promise.all(formattedTexts.map(async (text) => {
            const response = await openai.embeddings.create({
              model: MODEL_EMBEDDING,
              input: text,
            });
            return response.data[0].embedding;
          }));

          const newIds = newEmbeddings.map(e => e.stream_id);
          const newMetadatas = newEmbeddings.map(embedding => ({
            modelName: embedding.model_name,
            modelId: embedding.model_id,
            indexId: embedding.index_id,
            itemId: embedding.item_id,
            createdAt: new Date(embedding.created_at).toISOString(),
            updatedAt: new Date(embedding.updated_at).toISOString(),
          }));

          await collection.upsert({
            ids: newIds,
            embeddings: newEmbeddingVectors,
            metadatas: newMetadatas,
            documents: datas.map(JSON.stringify)
          });
          
        }
        console.log(processedCount)
        processedCount += embeddings.length;
        if (embeddings.length < BATCH_SIZE) break;
      }

      return processedCount;
    } catch (error) {
      console.error("Error in findAndUpsertEmbeddingsByIndexIds:", error);
      throw error;
    }
  }
}
