import { ComposeClient } from "@composedb/client";
import { profileFragment } from "../types/fragments.js";
import { getCurrentDateTime } from "../utils/helpers.js";
import RedisClient from "../clients/redis.js";
import { IndexService } from "./index.js";
import { DIDSession } from "did-session";
import { getENSProfileByWallet } from "../controllers/meta.js";

const redisClient = RedisClient.getInstance();

export class DIDService {
  constructor(definition) {
    this.definition = definition;
    this.client = new ComposeClient({
      ceramic: process.env.CERAMIC_HOST,
      definition,
    });
    this.did = null;
  }

  setSession(session) {
    if (session && session.did.authenticated) {
      this.did = session.did;
      this.session = session;
    }
    return this;
  }

  async getDIDIndexForViewer(indexId, type) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(`{
              viewer{
                didIndexList(first: 1, sorting: {updatedAt: DESC}, filters: { where: {type: {equalTo: "${type}"}, indexId: {equalTo: "${indexId}"}}}) {
                  edges {
                    node {
                      ... on DIDIndex {
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
              }
            }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error getting DIDIndex index: ${JSON.stringify(errors)}`,
        );
      }
      // Validate the data response
      if (
        !data ||
        !data.viewer.didIndexList ||
        !data.viewer.didIndexList.edges
      ) {
        throw new Error("Invalid response data");
      }

      if (data.viewer.didIndexList.edges.length === 0) {
        return null;
      }

      return data.viewer.didIndexList.edges[0].node;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in getDIDIndexForViewer:", error);
      throw error;
    }
  }

  async getIndexes(did, type) {
    try {
      let filtersPart = type
        ? `filters: {
                where: {
                    type: {equalTo: "${type}"},
                    deletedAt: {isNull: true}
                }
            }`
        : `filters: {
                where: {
                    deletedAt: {isNull: true}
                }
            }`;

      // Include the comma only when filtersPart is not empty
      let didIndexListArguments = `first: 1000${filtersPart ? `, ${filtersPart}` : ""}`;
      const { data, errors } = await this.client.executeQuery(`
            query{
                node(id:"${did}") {
                ... on CeramicAccount{
                        didIndexList (${didIndexListArguments}, sorting: {updatedAt: DESC}) {
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
                                        controllerDID {
                                          id
                                          profile {
                                            id
                                            name
                                            avatar
                                            bio
                                          }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error getting DIDIndex index: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (!data || !data.node || !data.node.didIndexList) {
        throw new Error("Invalid response data");
      }

      if (data.node.didIndexList.edges.length === 0) {
        return [];
      }

      const indexesMap = new Map();
      const uniqueIndexes = [];

      data.node.didIndexList.edges.forEach((edge) => {
        const indexId = edge.node.index.id;

        if (!indexesMap.has(indexId)) {
          const newIndex = {
            did: { owned: false, starred: false },
            ...edge.node.index,
          };

          indexesMap.set(indexId, newIndex);
          uniqueIndexes.push(newIndex);
        }

        const currentIndex = indexesMap.get(indexId);

        if (edge.node.type === "owned") {
          currentIndex.did.owned = true;
        } else if (edge.node.type === "starred") {
          currentIndex.did.starred = true;
        }
      });

      const indexService = new IndexService(this.definition);

      return await Promise.all(
        uniqueIndexes
          .filter((i) => i.did.owned || i.did.starred)
          .map(async (i) => await indexService.transformIndex(i)),
      );
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createDIDIndex:", error);
      throw error;
    }
  }

  async setDIDIndex(indexId, type, isDeleted = false) {
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

      if (isDeleted) {
        content.deletedAt = getCurrentDateTime();
      }

      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(
        `
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
              }`,
        { input: { content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error setting DID Index: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.setDIDIndex || !data.setDIDIndex.document) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      return data.setDIDIndex.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in setDIDIndex:", error);
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
      const { data, errors } = await this.client.executeQuery(
        `
                mutation CreateProfile($input: CreateProfileInput!) {
                    createProfile(input: $input) {
                        document {
                            ${profileFragment}
                        }
                    }
                }`,
        { input: { content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error creating profile: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.createProfile || !data.createProfile.document) {
        throw new Error("Invalid response data");
      }

      return await this.getProfile(
        data.createProfile.document.controllerDID.id,
      );
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createProfile:", error);
      throw error;
    }
  }

  async getProfile(did) {
    try {
      const { data, errors } = await this.client.executeQuery(`{
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
        throw new Error("Invalid response data");
      }

      if (!data.node.profile) {
        const wallet = did.split(":").slice(-1).pop();
        const ensProfile = await getENSProfileByWallet(wallet);
        if (ensProfile) {
          if (ensProfile.image && ensProfile.image.startsWith(`ipfs://`)) {
            ensProfile.image = ensProfile.image.replace(
              `ipfs://`,
              `https://ipfs.io/ipfs/`,
            );
          }
          return {
            id: did,
            name: ensProfile.ensName,
            avatar: ensProfile.image,
            bio: "",
          };
        }
        return {
          id: did,
        };
      }
      const profileObj = data.node.profile;

      profileObj.id = profileObj.controllerDID.id;
      delete profileObj.controllerDID;

      if (profileObj.avatar) {
        profileObj.avatar = `https://ipfs.io/ipfs/${profileObj.avatar}`;
      }

      return profileObj;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in getProfile:", error);
      throw error;
    }
  }
  async publicEncryptionDID() {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    const encryptedSessionStr = await redisClient.hGet(
      `encryption_sessions`,
      this.did.parent,
    );

    if (encryptedSessionStr) {
      const session = await DIDSession.fromSession(encryptedSessionStr);
      await session.did.authenticate();
      return session;
    }

    try {
      const content = {
        publicEncryptionDID: this.did.id,
      };

      const mutation = `
        mutation createPublicEncryptionDID($input: CreatePublicEncryptionDIDInput!) {
          createPublicEncryptionDID(input: $input) {
            document {
              id
              controllerDID {
                id
              }
              publicEncryptionDID {
                id
              }
            }
          }
        }
      `;

      this.client.setDID(this.did);

      const { data: mutationData, errors: mutationErrors } =
        await this.client.executeQuery(mutation, { input: { content } });

      if (mutationErrors) {
        throw new Error(
          `Error creating public encryption DID: ${JSON.stringify(mutationErrors)}`,
        );
      }

      await redisClient.hSet(
        `encryption_sessions`,
        this.did.parent,
        this.session.serialize(),
      );

      return this.session;
    } catch (error) {
      console.error("Exception occurred in publicEncryptionDID:", error);
      throw error;
    }
  }
}
