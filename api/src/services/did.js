import { ComposeClient } from "@composedb/client";
import { definition }  from "../types/merged-runtime.js";
import { profileFragment }  from "../types/fragments.js";
import { getCurrentDateTime }  from "../utils/helpers.js";
import { getOwnerProfile } from "../libs/lit/index.js";

export class DIDService {
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


    async getOwner(indexId) {

        try {
            const {data, errors} = await this.client.executeQuery(`
              query{
                dIDIndexIndex(first: 1, sorting: {createdAt: DESC}, filters: { where: {type: {equalTo: "owned"}, indexId: {equalTo: "${indexId}"}}}) {
                  edges {
                    node {
                      id
                      type
                      indexId
                      createdAt
                      updatedAt
                      deletedAt
                      controllerDID {
                        profile {
                          ${profileFragment}
                        }
                      }
                    }
                  }
                }
              }
            `);

            // Handle GraphQL errors
            if (errors) {
                throw new Error(`Error getting DIDIndex index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.dIDIndexIndex || !data.dIDIndexIndex.edges) {
                throw new Error('Invalid response data');
            }

            if (data.dIDIndexIndex.edges.length === 0) {
                return null;
            }

            return data.dIDIndexIndex.edges[0].node.controllerDID.profile;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in dIDIndexIndex:', error);
            throw error;
        }
    }


    async getDIDIndexForViewer(indexId, type) {

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
                      ${didIndexFragment}
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
            if (!data || !data.viewer.didIndexList || !data.viewer.didIndexList.edges) {
                throw new Error('Invalid response data');
            }

            if (data.viewer.didIndexList.edges.length === 0) {
                return null;
            }

            return data.viewer.didIndexList.edges[0].node;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getDIDIndexForViewer:', error);
            throw error;
        }
    }

    async getIndexes(did, type) {

        try {

            let filtersPart = type ? `filters: {
                where: {
                    type: {equalTo: "${type}"},
                    deletedAt: {isNull: true}
                }
            }` : `filters: {
                where: {
                    deletedAt: {isNull: true}
                }
            }`;

            // Include the comma only when filtersPart is not empty
            let didIndexListArguments = `first: 1000${filtersPart ? `, ${filtersPart}` : ""}`;
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
                return [];
            }


            const indexes = data.node.didIndexList.edges.reduce((acc, edge) => {
                const indexId = edge.node.index.id;
                if (!acc[indexId]) {
                    acc[indexId] = { did: {owned: false, starred: false}, ...edge.node.index };
                }

                if (edge.node.type === "owned") {
                    acc[indexId].did.owned = true;
                } else if (edge.node.type === "starred") {
                    acc[indexId].did.starred = true;
                }
                return acc;
            }, {})

            return await Promise.all(
                Object.values(indexes)
                    .filter(i => i.did.owned || i.did.starred)
                    .map(async (i) => {
                        const ownerDID = await getOwnerProfile(i.id);
                        return { ...i, ownerDID };
                    })
                    .sort((a, b) => {
                      return new Date(b.createdAt) - new Date(a.createdAt);
                    })
            );


        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in createDIDIndex:', error);
            throw error;
        }

    }

    async setDIDIndex(indexId, type, isDeleted=false) {

        if (!this.did) {
            throw new Error("DID not set. Use setDID() to set the did.");
        }

        try {

            let content = {
                indexId,
                type,
                createdAt: getCurrentDateTime(),
                updatedAt: getCurrentDateTime(),
            };

            if(isDeleted){
              content.deletedAt = getCurrentDateTime();
            }

            this.client.setDID(this.did);
            const {data, errors} = await this.client.executeQuery(`
              mutation SetDIDIndex($input: SetDIDIndexInput!) {
                setDIDIndex(input: $input) {
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
                throw new Error(`Error setting DID Index: ${JSON.stringify(errors)}`);
            }

            // Validate the data response
            if (!data || !data.setDIDIndex || !data.setDIDIndex.document) {
                throw new Error('Invalid response data');
            }

            // Return the created index document
            return data.setDIDIndex.document;

        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in setDIDIndex:', error);
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
                            ${profileFragment}
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

            const profileObj = data.createProfile.document;

            profileObj.id = profileObj.controllerDID.id
            delete profileObj.controllerDID;

            return profileObj;

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
                            ${profileFragment}
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

            const profileObj = data.node.profile;

            profileObj.id = profileObj.controllerDID.id
            delete profileObj.controllerDID;

            return profileObj;


        } catch (error) {
            // Log the error and rethrow it for external handling
            console.error('Exception occurred in getProfile:', error);
            throw error;
        }
    }

}
