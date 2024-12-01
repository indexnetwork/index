import { ComposeClient } from "@composedb/client";
import { getCurrentDateTime } from "../utils/helpers.js";
import { IndexService } from "./index.js";
import pkg from "knex";
import { ChromaClient } from 'chromadb';

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
      
      while (true) {
        const embeddings = await cli('index_embeddings')
          .select('*')
          .whereIn('index_id', indexIds)
          .whereNull('deleted_at')
          .offset(processedCount)
          .limit(BATCH_SIZE);

        if (embeddings.length === 0) break;

        const newIds = embeddings.map(e => e.stream_id);
        const newVectors = embeddings.map(e => JSON.parse(e.vector));
        const newMetadatas = embeddings.map(embedding => ({
          modelName: embedding.model_name,
          modelId: embedding.model_id,
          indexId: embedding.index_id,
          itemId: embedding.item_id,
          createdAt: new Date(embedding.created_at).toISOString(),
          updatedAt: new Date(embedding.updated_at).toISOString(),
        }));
        const newDatas = await Promise.all(embeddings.map(async (a) => {
          const itemStream = await cli(a.model_id)
            .select('stream_content')
            .where('stream_id', a.item_id)
            .first();
          return JSON.stringify(itemStream.stream_content);
        }));

        await collection.upsert({
          ids: newIds,
          embeddings: newVectors,  // Use existing vectors
          metadatas: newMetadatas,
          documents: newDatas,
        });

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
