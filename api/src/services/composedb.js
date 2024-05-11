import {ComposeClient} from "@composedb/client";

import {definition} from "../types/merged-runtime.js";
import { webPageFragment, teamFragment } from "../types/fragments.js";

const fragments = {
  [definition.models.WebPage.id]: { fragment: webPageFragment, name: "WebPage" },
  [definition.models.Team.id]: { fragment: teamFragment, name: "Team"  }
};

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

    async createNode(modelId, params) {

        const modelFragment = fragments[modelId];

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation CreateNode($input: Create${modelFragment.name}Input!) {
                    create${modelFragment.name}(input: $input) {
                        document {
                            ${modelFragment.fragment}
                        }
                    }
                }`, {input: { content }});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating ${modelFragment.name}: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data[`create${modelFragment.name}`] || !data[`create${modelFragment.name}`].document) {
                throw new Error('Invalid response data');
            }

            // Return the created webpage document
            return data[`create${modelFragment.name}`].document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createWebPage:', error);
            throw error;
        }
    }

    async updateNode(modelId, id, params) {

        const modelFragment = fragments[modelId];

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            const content = {
                ...params,
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation Update${modelFragment.name}($input: Update${modelFragment.name}Input!) {
                    update${modelFragment.name}(input: $input) {
                        document {
                            ${modelFragment.fragment}
                        }
                    }
                }`, {input: {id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating ${modelFragment.name}: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data[`update${modelFragment.name}`] || !data[`update${modelFragment.name}`].document) {
                throw new Error('Invalid response data');
            }

            // Return the updated node document
            return data[`update${modelFragment.name}`].document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error(`Exception occurred in update${modelFragment.name}:`, error);
            throw error;
        }
    }

    async getNodeById(modelId, id) {

        const modelFragment = fragments[modelId];
        console.log(fragments, modelId)
        try {
            const {data, errors} = await this.client.executeQuery(`
            {
              node(id: "${id}") {
                ... on ${modelFragment.name} {
                  ${modelFragment.fragment}
                }
              }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting ${modelFragment.name}: ${JSON.stringify(errors)}`);
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
