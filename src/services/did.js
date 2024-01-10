import { ComposeClient } from "@composedb/client";

import moment from "moment";
const getCurrentDateTime = () => moment.utc().toISOString();

import { definition }  from "../types/merged-runtime.js";
import { getOwnerProfile } from "../libs/lit/index.js";

export class DIDService {
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

    async getDIDIndex(indexId, type) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`{
              viewer{
                didIndexList(first: 1, sorting: {createdAt: DESC}, filters: { where: {type: {equalTo: "${type}"}, indexId: {equalTo: "${indexId}"}}}) {
                  edges {
                    node {
                      id
                      type
                      indexId
                      createdAt
                      updatedAt
                      deletedAt
                      controllerDID {
                        id
                      }
                    }
                  }
                }
              }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting DIDIndex index: ${JSON.stringify(errors)}`);
            }
            // Validate the data response
            if (!data || !data.viewer || !data.viewer.didIndexList) {
                throw new Error('Invalid response data');
            }

            if (data.viewer.didIndexList.edges.length === 0) {
                return null;
            }

            return data.viewer.didIndexList.edges[0].node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createDIDIndex:', error);
            throw error;
        }
    }

    async getIndexes(did, type) {

        try {

            let filtersPart = type ? `filters: {
                where: {
                    type: {equalTo: "${type}"}
                }
            }` : "";

            // Include the comma only when filtersPart is not empty
            let didIndexListArguments = `first: 1000${filtersPart ? `, ${filtersPart}` : ""}`;
            console.log(did,type, didIndexListArguments);
            const {data, errors} = await this.client.executeQuery(`
            query{
                node(id:"${did}") {
                ... on CeramicAccount{
                        didIndexList (${didIndexListArguments}, sorting: {createdAt: DESC}) {
                            edges {
                                node {
                                    id
                                    type
                                    createdAt
                                    updatedAt
                                    deletedAt
                                    index {
                                        id
                                        title
                                        signerPublicKey
                                        signerFunction
                                        createdAt
                                        updatedAt
                                        deletedAt
                                    }
                                }
                            }
                        }
                    }
                }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting DIDIndex index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.node || !data.node.didIndexList) {
                throw new Error('Invalid response data');
            }

            if (data.node.didIndexList.edges.length === 0) {
                return null;
            }

            let promises = data.node.didIndexList.edges.map(async (edge) => {
                // Get the ownerDID asynchronously

                const ownerDID = await getOwnerProfile(edge.node.index.signerPublicKey);
                // Return the modified edge with the ownerDID
                return { ...edge.node.index, ownerDID };
            });

            const results = await Promise.all(promises);
            return results;


        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createDIDIndex:', error);
            throw error;
        }

    }

    async addIndex(indexId, type) {

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {

            //Duplicate check, it'll be refactored when ceramic release the set account relations.
            const existingIndex = await this.getDIDIndex(indexId, type);
            if (existingIndex && !existingIndex.deletedAt) {
                return existingIndex;
            }

            const content = {
                indexId,
                type,
                createdAt: getCurrentDateTime(),
                updatedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
                mutation CreateDIDIndex($input: CreateDIDIndexInput!) {
                  createDIDIndex(input: $input) {
                    document {
                      id
                      type
                      indexId
                      createdAt
                      updatedAt
                      deletedAt
                      controllerDID {
                        id
                      }
                    }
                  }
                }`, {input: {content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error adding index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createDIDIndex || !data.createDIDIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.createDIDIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createDIDIndex:', error);
            throw error;
        }
    }

    async removeIndex(indexId, type) {
        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {
            // Check if the index exists and is not already deleted
            const existingIndex = await this.getDIDIndex(indexId, type);
            if (!existingIndex) {
                throw new Error('Index does not exist.');
            }

            if (existingIndex.deletedAt) {
                throw new Error('Index is already deleted.');
            }

            const content = {
                updatedAt: getCurrentDateTime(),
                deletedAt: getCurrentDateTime(),
            };
            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
            mutation UpdateDIDIndex($input: UpdateDIDIndexInput!) {
                updateDIDIndex(input: $input) {
                    document {
                      id
                      type
                      indexId
                      createdAt
                      updatedAt
                      deletedAt
                      controllerDID {
                        id
                      }
                    }
                }
            }`, {input: {id: existingIndex.id, content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error removing index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.updateDIDIndex || !data.updateDIDIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the updated index document
            return data.updateDIDIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in removeIndex:', error);
            throw error;
        }
    }


    async createProfile(params) {
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
                mutation CreateProfile($input: CreateProfileInput!) {
                    createProfile(input: $input) {
                        document {
                            id
                            bio
                            avatar
                            name
                            createdAt
                            updatedAt
                            deletedAt
                            controllerDID{
                                id
                            }
                        }
                    }
                }`, {input: {content}});

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error creating profile: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.createProfile || !data.createProfile.document) {
                throw new Error('Invalid response data');
            }

            // Return the created profile document
            return data.createProfile.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createProfile:', error);
            throw error;
        }
    }


    async getProfile(did) {

        try {

            const {data, errors} = await this.client.executeQuery(`{
                node(id: "${did}") {
                ... on CeramicAccount {
                        profile {
                            id
                            name
                            bio
                            avatar
                            createdAt
                            updatedAt
                            deletedAt
                        }
                    }
                }
            }`);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting profile: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.node) {
                throw new Error('Invalid response data');
            }

            if(!data.node.profile){
                return null
            }

            // Return the created profile document
            return data.node.profile;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getProfile:', error);
            throw error;
        }
    }

}



