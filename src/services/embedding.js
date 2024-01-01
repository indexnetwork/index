import {ComposeClient} from "@composedb/client";

import moment from "moment";

const getCurrentDateTime = () => moment.utc().toISOString();

import {definition} from "../types/merged-runtime.js";

export class EmbeddingService {
    constructor() {
        this.client = new ComposeClient({
            ceramic: "http://localhost:7007",
            definition: definition,
        });
        this.did = null;
    }

    setDID(did) {
        this.did = did;
        return this;
    }

    async getEmbedding(indexId, itemId, modelName, category) {

        try {
            const {data, errors} = await this.client.executeQuery(`
            query{
              embeddingIndex(first:1, filters: {
                where: {
                  itemId: { equalTo: "${itemId}"},
                  indexId: { equalTo: "${indexId}"}
                  modelName: { equalTo: "${modelName}"}
                  category: { equalTo: "${category}"}
                  deletedAt: {isNull: true}
                }
              }, sorting: { createdAt: DESC}) {
                edges {
                  node {
                    id
                    indexId
                    itemId
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
              }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting index item: ${JSON.stringify(errors)}`);
            }
            // Validate the data response
            if (!data || !data.embeddingIndex || !data.embeddingIndex.edges) {
                throw new Error('Invalid response data');
            }

            if (data.embeddingIndex.edges.length === 0) {
                return null;
            }

            return data.embeddingIndex.edges[0].node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in embeddingIndex:', error);
            throw error;
        }
    }

    async createEmbedding(params) {

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }
        try {

            const embedding = await this.getEmbedding(params.indexId, params.itemId, params.modelName, params.category);
            if (embedding) {
                return embedding;
            }

            const content = {
                ...params,
                createdAt: getCurrentDateTime(),
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);

            const {data, errors} = await this.client.executeQuery(`
                mutation CreateEmbedding($input: CreateEmbeddingInput!) {
                    createEmbedding(input: $input) {
                        document {
                            id
                            indexId
                            itemId
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
                }`, {input: {content}});
            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating embedding: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createEmbedding || !data.createEmbedding.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.createEmbedding.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createEmbedding:', error);
            throw error;
        }
    }

    async updateEmbedding(params) {

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }
        try {

            const embedding = await this.getEmbedding(params.indexId, params.itemId, params.modelName, params.category);
            if (!embedding) {
                throw new Error('Embedding does not exist.');
            }

            const content = {
                ...params,
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);

            const {data, errors} = await this.client.executeQuery(`
                mutation UpdateEmbedding($input: UpdateEmbeddingInput!) {
                    updateEmbedding(input: $input) {
                        document {
                            id
                            indexId
                            itemId
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
                }`, {input: {id: embedding.id, content}});
            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating embedding: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateEmbedding || !data.updateEmbedding.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.updateEmbedding.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in updateEmbedding:', error);
            throw error;
        }
    }

    async deleteEmbedding(params) {

        const content = {
            ...params,
            updatedAt: getCurrentDateTime(),
            deletedAt: getCurrentDateTime()
        };
        return await this.updateEmbedding(content);
    }

}


