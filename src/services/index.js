import {ComposeClient} from "@composedb/client";

import moment from "moment";

const getCurrentDateTime = () => moment.utc().toISOString();

import {definition} from "../types/merged-runtime.js";

export class IndexService {
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

    async getIndexById(id) {


        try {
            let didPayload = "";
            if (this.did) {
                didPayload = `did(first:10, account: "${this.did.id}") {
                        edges {
                            node {
                                id
                                type
                                controllerDID {
                                    id
                                }
                                createdAt
                                updatedAt
                                deletedAt
                            }
                        }
                    }`
            }

            const {data, errors} = await this.client.executeQuery(`
                {
                  node(id: "${id}") {
                    id
                    ... on Index {
                      id
                      title
                      signerPublicKey
                      signerFunction
                      createdAt
                      updatedAt
                      deletedAt
                      ${didPayload}
                    }
                  }
                }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting index by id: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.node) {
                throw new Error('Invalid response data');
            }

            // Return the index document
            return data.node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getIndexById:', error);
            throw error;
        }
    }

    async createIndex(params) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
                createdAt: getCurrentDateTime(),
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation CreateIndex($input: CreateIndexInput!) {
                    createIndex(input: $input) {
                        document {
                            id
                            title
                            signerPublicKey
                            signerFunction
                            createdAt
                            updatedAt
                        }
                    }
                }`, {input: {content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createIndex || !data.createIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.createIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createIndex:', error);
            throw error;
        }
    }

    async updateIndex(id, params) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation UpdateIndex($input: UpdateIndexInput!) {
                    updateIndex(input: $input) {
                        document {
                            id
                            title
                            signerPublicKey
                            signerFunction
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`, {input: {id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateIndex || !data.updateIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.updateIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in updateIndex:', error);
            throw error;
        }
    }

    async deleteIndex(id) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
                updatedAt: getCurrentDateTime(),
                deletedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation UpdateIndex($input: UpdateIndexInput!) {
                    updateIndex(input: $input) {
                        document {
                            id
                            title
                            signerPublicKey
                            signerFunction
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }`, {input: {id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error deleting index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateIndex || !data.updateIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.updateIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in updateIndex:', error);
            throw error;
        }
    }
}


