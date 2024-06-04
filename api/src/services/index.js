import { ComposeClient } from "@composedb/client";

import { getCurrentDateTime } from "../utils/helpers.js";
import { getLitOwner } from "../libs/lit/index.js";
import { profileFragment } from "../types/fragments.js";

export class IndexService {
  constructor(definition) {
    this.client = new ComposeClient({
      ceramic: process.env.CERAMIC_HOST,
      definition,
    });
    this.did = null;
  }

  setSession(session) {
    if (session && session.did.authenticated) {
      this.did = session.did;
    }
    return this;
  }

  async getIndexById(id) {
    try {
      let didPayload = "";

      if (this.did && this.did.parent) {
        didPayload = `did(first:10, account: "${this.did.parent}", filters: {
                    where: {
                        deletedAt: {isNull: true}
                    }
                }) {
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
                }`;
      }

      const { data, errors } = await this.client.executeQuery(`
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
                      controllerDID {
                        id
                        profile {
                          id
                          name
                          avatar
                          bio
                        }
                      }
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
        throw new Error("Invalid response data");
      }

      const index = data.node;

      if (index.did && index.did.edges && index.did.edges.length > 0) {
        const did = { starred: false, owned: false };
        index.did.edges.forEach((edge) => {
          if (edge.node.type === "owned") {
            did.owned = edge.node.deletedAt === null;
          }
          if (edge.node.type === "starred") {
            did.starred = edge.node.deletedAt === null;
          }
        });
        index.did = did;
      }

      index.ownerDID = this.getOwnerProfile(index);
      delete index.controllerDID;
      console.log(index.ownerDID);
      return index;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in getIndexById:", error);
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
      const { data, errors } = await this.client.executeQuery(
        `
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
                }`,
        { input: { content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error creating index: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.createIndex || !data.createIndex.document) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      const createdIndex = data.createIndex.document;
      createdIndex.ownerDID = createdIndex.controllerDID;

      return createdIndex;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createIndex:", error);
      throw error;
    }
  }

  async updateIndex(id, params) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    let didPayload = "";

    if (this.did) {
      didPayload = `did(first:10, account: "${this.did.parent}", filters: {
                where: {
                    deletedAt: {isNull: true}
                }
            }) {
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
            }`;
    }

    try {
      const content = {
        ...params,
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(
        `
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
                            ${didPayload}
                        }
                    }
                }`,
        { input: { id, content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error updating index: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.updateIndex || !data.updateIndex.document) {
        throw new Error("Invalid response data");
      }

      const index = data.updateIndex.document;

      if (index.did && index.did.edges && index.did.edges.length > 0) {
        const did = { starred: false, owned: false };
        index.did.edges.forEach((edge) => {
          if (edge.node.type === "owned") {
            did.owned = edge.node.deletedAt === null;
          }
          if (edge.node.type === "starred") {
            did.starred = edge.node.deletedAt === null;
          }
        });
        index.did = did;
      }

      index.ownerDID = index.controllerDID;
      // Return the created index document
      return index;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateIndex:", error);
      throw error;
    }
  }

  async deleteIndex(id) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      const content = {
        updatedAt: getCurrentDateTime(),
        deletedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(
        `
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
                }`,
        { input: { id, content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error deleting index: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.updateIndex || !data.updateIndex.document) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      return data.updateIndex.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateIndex:", error);
      throw error;
    }
  }

  async getOwner(indexId) {
    try {
      const { data, errors } = await this.client.executeQuery(`
              query{
                dIDIndexIndex(first: 1, sorting: {createdAt: DESC}, filters: { where: {deletedAt: {isNull: true}, type: {equalTo: "owned"}, indexId: {equalTo: "${indexId}"}}}) {
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
        throw new Error(
          `Error getting DIDIndex index: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (!data || !data.dIDIndexIndex || !data.dIDIndexIndex.edges) {
        throw new Error("Invalid response data");
      }

      if (data.dIDIndexIndex.edges.length === 0) {
        return null;
      }
      let profile = {};
      if (data.dIDIndexIndex.edges[0].node.controllerDID.profile !== null) {
        profile = data.dIDIndexIndex.edges[0].node.controllerDID.profile;
        profile.id = profile.controllerDID.id;
        delete profile.controllerDID;
        return profile;
      } else {
        return {
          id: data.dIDIndexIndex.edges[0].node.controllerDID.id,
        };
      }
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in dIDIndexIndex:", error);
      throw error;
    }
  }

  getOwnerProfile(index) {
    if (index.controllerDID.profile) {
      const profile = index.controllerDID.profile;
      profile.id = index.controllerDID.id;
      return profile;
    } else {
      return { id: index.controllerDID.id };
    }
  }
}
