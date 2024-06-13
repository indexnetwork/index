import { ComposeClient } from "@composedb/client";
import {
  getAgentDID,
  getCurrentDateTime,
  createDagJWE,
  decryptJWE,
} from "../utils/helpers.js";

export class ConversationService {
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
  setDID(did) {
    this.did = did;
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
                    members {
                      id
                    }
                    messages(last:1) {
                      edges {
                        node {
                          id
                          conversationId
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

      let conversations = data.viewer.conversationList.edges.map(
        async (edge) => {
          if (edge.node.deletedAt) {
            return null;
          }
          const decryptedMetadata = await decryptJWE(
            this.did,
            edge.node.metadata,
          );
          if (!decryptedMetadata) {
            return null;
          }
          edge.node.sources = decryptedMetadata.sources;
          edge.node.summary = decryptedMetadata.summary;
          delete edge.node.metadata;

          const messages = await Promise.all(
            edge.node.messages.edges.map(async (edge) => {
              const decryptedJWE = await decryptJWE(
                this.did,
                edge.node.content,
              );
              delete edge.node.content;
              return {
                ...edge.node,
                ...decryptedJWE,
              };
            }),
          );

          edge.node.messages = messages;
          return edge.node;
        },
      );
      conversations = await Promise.all(conversations);
      return conversations.filter((c) => c && c.deletedAt === null);
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
          id
          metadata
          controllerDID {
            id
          }
          createdAt
          updatedAt
          deletedAt
          members {
            id
          }
          messages(first: 1000,  filters: {where: {deletedAt: {isNull: true}}}, sorting: {createdAt: ASC}) {
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

      if (data.node.deletedAt) {
        return null;
      }
      const decryptedMetadata = await decryptJWE(this.did, data.node.metadata);
      data.node.sources = decryptedMetadata.sources;
      data.node.summary = decryptedMetadata.summary;
      delete data.node.metadata;

      const messages = await Promise.all(
        data.node.messages.edges.map(async (edge) => {
          const decryptedContent = await decryptJWE(
            this.did,
            edge.node.content,
          );
          return {
            ...edge.node,
            ...decryptedContent,
          };
        }),
      );

      data.node.messages = messages;
      return data.node;
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
      const agentDID = await getAgentDID();
      const content = {
        metadata: await createDagJWE([this.did, agentDID], params),
        members: [this.did.id, agentDID.id],
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
              members {
                id
              }
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

      const decryptedMetadata = await decryptJWE(
        this.did,
        data.createConversation.document.metadata,
      );

      // Deconstruct document and override metadata
      const { metadata, ...documentWithoutMetadata } =
        data.createConversation.document;

      return {
        ...documentWithoutMetadata,
        ...decryptedMetadata,
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
      const agentDID = await getAgentDID();
      const { deletedAt, ...paramsWithoutDeletedAt } = params;
      const content = {
        metadata: await createDagJWE(
          [this.did, agentDID],
          paramsWithoutDeletedAt,
        ),
        updatedAt: getCurrentDateTime(),
      };
      if (deletedAt) {
        content.deletedAt = deletedAt;
      }

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

      const decryptedMetadata = await decryptJWE(
        this.did,
        data.updateConversation.document.metadata,
      );

      // Deconstruct document and override metadata
      const { metadata, ...documentWithoutMetadata } =
        data.updateConversation.document;

      const messages = await Promise.all(
        documentWithoutMetadata.messages.edges.map(async (edge) => {
          return {
            ...edge.node,
            content: await decryptJWE(this.did, edge.node.content),
          };
        }),
      );

      documentWithoutMetadata.messages = messages;
      return {
        ...documentWithoutMetadata,
        ...decryptedMetadata,
      };
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
          await this.deleteMessage(id, message.id);
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
          conversationId
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

      const decryptedContent = await decryptJWE(this.did, data.node.content);
      const message = {
        ...data.node,
        ...decryptedContent,
      };
      return message;
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in returning message:", error);
      throw error;
    }
  }

  async createMessage(conversationId, params) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
    }
    try {
      const agentDID = await getAgentDID();
      const content = {
        conversationId,
        content: await createDagJWE([this.did, agentDID], params),
        createdAt: getCurrentDateTime(),
        updatedAt: getCurrentDateTime(),
      };
      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
        mutation CreateEncryptedMessage($input: CreateEncryptedMessageInput!) {
          createEncryptedMessage(input: $input) {
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
      if (
        !data ||
        !data.createEncryptedMessage ||
        !data.createEncryptedMessage.document
      ) {
        throw new Error("Invalid response data");
      }
      const decryptedContent = await decryptJWE(
        this.did,
        data.createEncryptedMessage.document.content,
      );
      return {
        ...data.createEncryptedMessage.document,
        ...decryptedContent,
      };
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in createEncryptedMessage:", error);
      throw error;
    }
  }

  async updateMessage(conversationId, messageId, params, deleteAfter = false) {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
    }

    try {
      // Fetch the message if deleteAfter is true
      if (deleteAfter) {
        const agentDID = await getAgentDID();
        const agentConvService = new ConversationService(this.definition).setDID(
          agentDID,
        );
        const message = await this.getMessage(messageId);
        const conversation = await this.getConversation(conversationId);
        if (
          conversation &&
          conversation.messages &&
          conversation.messages.length > 0
        ) {
          for (const messageEdge of conversation.messages.filter(
            (m) => new Date(m.createdAt) > new Date(message.createdAt),
          )) {
            if(messageEdge.controllerDID.id == agentDID.id) {
                await agentConvService.deleteMessage(conversation.id, messageEdge.id);
            } else {
                await this.deleteMessage(conversation.id, messageEdge.id);
            }
          }
        }
      }

      const { deletedAt, ...paramsWithoutDeletedAt } = params;
      const agentDID = await getAgentDID();
      const content = {
        conversationId,
        content: paramsWithoutDeletedAt
          ? await createDagJWE([this.did, agentDID], paramsWithoutDeletedAt)
          : "",
        updatedAt: getCurrentDateTime(),
      };
      if (deletedAt) {
        content.deletedAt = deletedAt;
      }

      this.client.setDID(this.did);

      const { data, errors } = await this.client.executeQuery(
        `
          mutation UpdateEncryptedMessage($input: UpdateEncryptedMessageInput!) {
            updateEncryptedMessage(input: $input) {
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
        { input: { id: messageId, content } },
      );

      // Handle GraphQL errors
      if (errors) {
        throw new Error(
          `Error updating encrypted message: ${JSON.stringify(errors)}`,
        );
      }

      // Validate the data response
      if (
        !data ||
        !data.updateEncryptedMessage ||
        !data.updateEncryptedMessage.document
      ) {
        throw new Error("Invalid response data");
      }

      const decryptedContent = await decryptJWE(
        this.did,
        data.updateEncryptedMessage.document.content,
      );
      return {
        ...data.updateEncryptedMessage.document,
        ...decryptedContent,
      };
    } catch (error) {
      // Log the error and rethrow it for external handling
      console.error("Exception occurred in updateMessage:", error);
      throw error;
    }
  }

  async deleteMessage(conversationId, messageId) {
    return await this.updateMessage(conversationId, messageId, {
      deletedAt: getCurrentDateTime(),
    });
  }
}
