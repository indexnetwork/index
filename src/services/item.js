import {ComposeClient} from "@composedb/client";

import moment from "moment";

const getCurrentDateTime = () => moment.utc().toISOString();

import {definition} from "../types/merged-runtime.js";

export class ItemService {
    constructor() {
        this.client = new ComposeClient({
            ceramic: process.env.CERAMIC_HOST,
            definition: definition,
        });
        this.did = null;
    }

    setDID(did) {
        this.did = did;
        return this;
    }

    async getIndexItem(indexId, itemId) {

        try {
            const {data, errors} = await this.client.executeQuery(`
            query{
              indexItemIndex(first:1, filters: {
                where: {
                  itemId: { equalTo: "${itemId}"},
                  indexId: { equalTo: "${indexId}"}
                  deletedAt: {isNull: true}
                }
              }, sorting: { createdAt: DESC}) {
                edges {
                  node {
                    id
                    indexId
                    itemId
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
            if (!data || !data.indexItemIndex || !data.indexItemIndex.edges) {
                throw new Error('Invalid response data');
            }

            if (data.indexItemIndex.edges.length === 0) {
                return null;
            }

            return data.indexItemIndex.edges[0].node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getIndexItem:', error);
            throw error;
        }
    }

    async addItem(indexId, itemId) {

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }
        try {

            const indexItem = await this.getIndexItem(indexId, itemId);
            if (indexItem) {
                return indexItem;
            }
            console.log(indexItem, "haha")

            const content = {
                indexId,
                itemId,
                createdAt: getCurrentDateTime(),
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);

            const {data, errors} = await this.client.executeQuery(`
                mutation CreateIndexItem($input: CreateIndexItemInput!) {
                    createIndexItem(input: $input) {
                        document {
                            id
                            indexId
                            itemId
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`, {input: {content}});
            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating item: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createIndexItem || !data.createIndexItem.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.createIndexItem.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createIndexItem:', error);
            throw error;
        }
    }

    async removeItem(indexId, itemId) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }
        try {

            const indexItem = await this.getIndexItem(indexId, itemId);
            if (!indexItem) {
                throw new Error('Index item does not exist.');
            }
            if (indexItem.deletedAt) {
                throw new Error('Index item is already deleted.');
            }

            const content = {
                updatedAt: getCurrentDateTime(),
                deletedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);

            const {data, errors} = await this.client.executeQuery(`
                mutation UpdateIndexItem($input: UpdateIndexItemInput!) {
                    updateIndexItem(input: $input) {
                        document {
                            id
                            indexId
                            itemId
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`, {input: {id: indexItem.id, content}});
            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating item: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateIndexItem || !data.updateIndexItem.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.updateIndexItem.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in updateIndexItem:', error);
            throw error;
        }
    }
}


