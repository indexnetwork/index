import {ComposeClient} from "@composedb/client";

import {definition} from "../types/merged-runtime.js";


export class ComposeDBService {
    constructor() {
        this.client = new ComposeClient({
            ceramic: process.env.CERAMIC_HOST,
            definition: definition,
        });
        this.did = null;
    }

    setSession(session) {
        if(session && session.did.authenticated) {
            this.did = session.did
        }
        return this;
    }

    async createNode(modelName, params) {

        const modelFragment = fragments[modelName];

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation CreateNode($input: Create${modelName}Input!) {
                    create${modelName}(input: $input) {
                        document {
                            ${modelFragment}
                        }
                    }
                }`, {input: { content }});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating ${modelName}: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data[`create${modelName}`] || !data[`create${modelName}`].document) {
                throw new Error('Invalid response data');
            }

            // Return the created webpage document
            return data[`create${modelName}`].document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createWebPage:', error);
            throw error;
        }
    }

    async updateNode(modelName, id, params) {

        const modelFragment = fragments[modelName];

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation Update${modelName}($input: Update${modelName}Input!) {
                    update${modelName}(input: $input) {
                        document {
                            ${modelFragment}
                        }
                    }
                }`, {input: {id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating ${modelName}: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data[`update${modelName}`] || !data[`update${modelName}`].document) {
                throw new Error('Invalid response data');
            }

            // Return the updated node document
            return data[`update${modelName}`].document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error(`Exception occurred in update${modelName}:`, error);
            throw error;
        }
    }

    async getNodeById(modelName, id) {

        const modelFragment = fragments[modelName];

        try {
            const {data, errors} = await this.client.executeQuery(`
            {
              node(id: "${id}") {
                ... on ${modelName} {
                  ${modelFragment}
                }
              }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting ${modelName}: ${JSON.stringify(errors)}`);
            }
            // Validate the data response
            if (!data || !data.node) {
                throw new Error('Invalid response data');
            }

            return data.node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error(`Exception occurred in getNodeById:`, error);
            throw error;
        }
    }
}
