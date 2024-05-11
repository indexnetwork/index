import {ComposeClient} from "@composedb/client";

import { getCurrentDateTime } from "../utils/helpers.js";
import { webPageFragment } from "../types/fragments.js";

import {definition} from "../types/merged-runtime.js";



export class WebPageService {
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

    async createWebPage(params) {
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
                mutation CreateWebPage($input: CreateWebPageInput!) {
                    createWebPage(input: $input) {
                        document {
                          ${webPageFragment}
                        }
                    }
                }`, {input: {content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating webpage: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createWebPage || !data.createWebPage.document) {
                throw new Error('Invalid response data');
            }

            // Return the created webpage document
            return data.createWebPage.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createWebPage:', error);
            throw error;
        }
    }

    async updateWebPage(id, params) {
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
                mutation UpdateWebPage($input: UpdateWebPageInput!) {
                    updateWebPage(input: $input) {
                        document {
                          ${webPageFragment}
                        }
                    }
                }`, {input: {id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error updating webPage: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateWebPage || !data.updateWebPage.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.updateWebPage.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in updateWebPage:', error);
            throw error;
        }
    }

    async getWebPageById(webPageId) {

        try {
            const {data, errors} = await this.client.executeQuery(`
            {
              node(id: "${webPageId}") {
                ${webPageFragment}
              }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting webpage: ${JSON.stringify(errors)}`);
            }
            // Validate the data response
            if (!data || !data.node) {
                throw new Error('Invalid response data');
            }

            return data.node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getWebPageById:', error);
            throw error;
        }
    }
}
