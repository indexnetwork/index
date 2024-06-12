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

export class Conversation {
  constructor(definition) {
    this.definition = definition;
    this.client = new ComposeClient({
      ceramic: process.env.CERAMIC_HOST,
      definition,
    });
    this.did = null;
  }

  setSession(session) {
    if (session && session.did && session.did.authenticated) {
      this.did = session.did;
    }
    return this;
  }

  async listConversations() {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
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
      throw new Error("DID not set. Use setSession() to set the did.");
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
          `Error getting conversation: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (!data || !data.node || !data.node.messages) {
        throw new Error("Invalid response data");
      }

      if (data.node.messages.edges.length === 0) {
        return [];
      }

      const messages = data.node.messages.edges.map(async (edge) => {
        return {
          ...edge.node,
          content: await decryptJWE(this.did, edge.node.content),
        };
      });
      return await Promise.all(messages);
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning conversation:", error);
      throw error;
    }
  }

  async createConversation(params) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
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
        throw new Error(
          `Error creating conversation: ${JSON.stringify(errors)}`,
        );
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
      console.error("Exception occurred in createConversation:", error);
      throw error;
    }
  }

  async updateConversation(id, params) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
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

      // Return the updated conversation document
      return data.updateConversation.document;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateConversation:", error);
      throw error;
    }
  }

  async deleteConversation(id) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
    }

    try {
      const conversation = await this.getConversation(id);

      if (conversation && conversation.messages) {
        for (const message of conversation.messages) {
          await this.deleteMessage(message.id);
        }
      }

      // Delete the conversation
      return await this.updateConversation(id, {
        deletedAt: getCurrentDateTime(),
      });
    } catch (error) {
      console.error("Exception occurred in deleting conversation:", error);
      throw error;
    }
  }

  async getMessage(id) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
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
        throw new Error(`Error getting message: ${JSON.stringify(errors)}`);
      }

      // Validate the data response
      if (!data || !data.node || !data.node.content) {
        throw new Error("Invalid response data");
      }

      const message = {
        ...data.node,
        content: await decryptJWE(this.did, data.node.content),
      };
      return message;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning message:", error);
      throw error;
    }
  }

  async createMessage(params) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
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
      throw new Error("DID not set. Use setSession() to set the did.");
    }

    try {
      // Fetch the message if deleteAfter is true
      if (deleteAfter) {
        const message = await this.getMessage(id);
        const conversation = await this.getConversation(
          message.conversation.id,
        );

        if (conversation && conversation.messages) {
          for (const messageEdge of conversation.messages.edges.filter(
            (m) => new Date(m.node.createdAt) > new Date(message.createdAt),
          )) {
            await this.deleteMessage(messageEdge.node.id);
          }
        }
      }

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

  async deleteMessage(id) {
    return await this.updateMessage(id, { deletedAt: getCurrentDateTime() });
  }
}
