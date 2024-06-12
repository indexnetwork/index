import { ComposeClient } from "@composedb/client";
import { getCurrentDateTime } from "../utils/helpers.js";

const decryptJWE = async (did, str) => {
  try {
    const parsedStr = JSON.parse(str.replace(/`/g, '"'));
    const decryptedData = await did.decryptDagJWE(parsedStr);
    return decryptedData;
  } catch (error) {
    console.error("Failed to decrypt JWE:", error);
    throw new Error("Decryption failed. Please check the input and try again.");
  }
};

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
    }
    return this;
  }

  async listConversations() {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(`
        query {
          viewer {
            ... on CeramicAccount {
              conversationList(first: 1000) {
                edges {
                  node {
                    id
                    metadata
                    createdAt
                    updatedAt
                    deletedAt
                    controllerDID {
                      id
                    }
                    messages(last:1) {
                      edges {
                        node {
                          id
                          controllerDID {
                            id
                          }
                          createdAt
                          updatedAt
                          deletedAt
                          content
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
          `Error getting conversations: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data.viewer ||
        !data.viewer.conversationList ||
        !data.viewer.conversationList.edges
      ) {
        throw new Error("Invalid response data");
      }

      if (data.viewer.conversationList.edges.length === 0) {
        return [];
      }

      const conversations = data.viewer.conversationList.edges.map(
        async (edge) => {
          return {
            ...edge.node,
            metadata: await decryptJWE(this.did, edge.node.metadata),
          };
        },
      );
      return await Promise.all(conversations);
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning conversation:", error);
      throw error;
    }
  }

  async getConversation(id) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(`
     {
      node(id: "${id}") {
        ... on Conversation {
          metadata
          controllerDID {
            id
          }
          createdAt
          updatedAt
          deletedAt
          messages(first: 10000, sorting: {updatedAt: DESC}) {
            edges {
              node {
                id
                controllerDID {
                  id
                }
                createdAt
                updatedAt
                deletedAt
                content
              }
            }
          }
        }
      }
    }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error getting conversations: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (!data || !data.node || !data.node.messages) {
        throw new Error("Invalid response data");
      }

      if (data.node.messages.length === 0) {
        return [];
      }

      const conversations = data.node.messages.edges.map(async (edge) => {
        return {
          ...edge.node,
          metadata: await decryptJWE(this.did, edge.node.metadata),
        };
      });
      return await Promise.all(conversations);
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning conversation:", error);
      throw error;
    }
  }

  async createConversation(params) {
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
        mutation CreateConversation($input: CreateConversationInput!) {
          createConversation(input: $input) {
            document {
              id
              metadata
              createdAt
              updatedAt
              deletedAt
              controllerDID {
                id
              }
            }
          }
        }
      `,
        { input: { content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error creating embedding: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (
        !data ||
        !data.createConversation ||
        !data.createConversation.document
      ) {
        throw new Error("Invalid response data");
      }
      return {
        ...data.createConversation.document,
        metadata: await decryptJWE(
          this.did,
          data.createConversation.document.metadata,
        ),
      };
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createEmbedding:", error);
      throw error;
    }
  }

  async updateConversation(id, params) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }
    try {
      const content = {
        ...params,
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
                mutation UpdateConversation($input: UpdateConversationInput!) {
                    updateConversation(input: $input) {
                        document {
                          id
                          metadata
                          createdAt
                          updatedAt
                          deletedAt
                          controllerDID {
                            id
                          }
                          messages(last:1) {
                            edges {
                              node {
                                id
                                controllerDID {
                                  id
                                }
                                createdAt
                                updatedAt
                                deletedAt
                                content
                              }
                            }
                          }
                        }
                    }
                }`,
        { input: { id, content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error updating conversation: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data.updateConversation ||
        !data.updateConversation.document
      ) {
        throw new Error("Invalid response data");
      }

      // Return the created index document
      return data.updateConversation.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateConversation:", error);
      throw error;
    }
  }

  async deleteConversation(id) {
    const content = {
      ...params,
      updatedAt: getCurrentDateTime(),
      deletedAt: getCurrentDateTime(),
    };
    return await this.updateConversation(id, content);
  }

  async getMessage(id) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }

    try {
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(`
     {
      node(id: "${id}") {
        ... on EncryptedMessage {
          id
          controllerDID {
            id
          }
          conversation {
            id
            controllerDID {
              id
            }
          }
          createdAt
          updatedAt
          deletedAt
          content
        }
      }
    }`);

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error getting conversations: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data.node ||
        !data.messages.conversationList ||
        !data.viewer.conversationList.edges
      ) {
        throw new Error("Invalid response data");
      }

      if (data.viewer.conversationList.edges.length === 0) {
        return [];
      }

      const conversations = data.viewer.conversationList.edges.map(
        async (edge) => {
          return {
            ...edge.node,
            metadata: await decryptJWE(this.did, edge.node.metadata),
          };
        },
      );
      return await Promise.all(conversations);
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning conversation:", error);
      throw error;
    }
  }

  async createMessage(params) {
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
        mutation CreateMessage($input: CreateMessageInput!) {
          createMessage(input: $input) {
            document {
              id
              content
              createdAt
              updatedAt
              deletedAt
              controllerDID {
                id
              }
            }
          }
        }
      `,
        { input: { content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error creating message: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.createMessage || !data.createMessage.document) {
        throw new Error("Invalid response data");
      }
      return {
        ...data.createMessage.document,
        content: await decryptJWE(
          this.did,
          data.createMessage.document.content,
        ),
      };
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createMessage:", error);
      throw error;
    }
  }

  async updateMessage(id, params, deleteAfter = false) {
    if (!this.did) {
      throw new Error("DID not set. Use setDID() to set the did.");
    }
    try {
      const content = {
        ...params,
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
                mutation UpdateMessage($input: UpdateMessageInput!) {
                    updateMessage(input: $input) {
                        document {
                          id
                          content
                          createdAt
                          updatedAt
                          deletedAt
                          controllerDID {
                            id
                          }
                        }
                    }
                }`,
        { input: { id, content } },
      );
      // Handle GraphQL errors
      if (errors) {
        throw new Error(`Error updating message: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.updateMessage || !data.updateMessage.document) {
        throw new Error("Invalid response data");
      }

      // Return the updated message document
      return data.updateMessage.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateMessage:", error);
      throw error;
    }
  }

  async deleteMessasge(id) {
    const content = {
      ...params,
      updatedAt: getCurrentDateTime(),
      deletedAt: getCurrentDateTime(),
    };
    return await this.updateMessage(id, content);
  }
}
