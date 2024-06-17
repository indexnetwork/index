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

  validateDID() {
    if (!this.did) {
      throw new Error("DID not set. Use setSession() to set the did.");
    }
  }

  async executeQuery(query, variables = {}) {
    try {
      this.client.setDID(this.did);
      const { data, errors } = await this.client.executeQuery(query, variables);
      if (errors) {
        throw new Error(`GraphQL error: ${JSON.stringify(errors)}`);
      }
      return data;
    } catch (error) {
      console.error("Exception occurred in executeQuery:", error);
      throw error;
    }
  }

  async decryptNode(node) {
    const decryptedPayload = await decryptJWE(this.did, node.payload);
    if (!decryptedPayload) return null;
    node.sources = decryptedPayload.sources;
    node.summary = decryptedPayload.summary;
    delete node.payload;

    const messages = await Promise.all(
      node.messages.edges.map(async (edge) => {
        const decryptedPayload = await decryptJWE(this.did, edge.node.payload);
        delete edge.node.payload;
        return { ...edge.node, ...decryptedPayload };
      }),
    );
    node.messages = messages.filter((m) => m.role && m.deletedAt === null);
    return node;
  }

  async listConversations() {
    this.validateDID();

    const query = `
      query {
        viewer {
          ... on CeramicAccount {
            conversationList(first: 1000,  sorting: {createdAt: DESC}, filters: {
              where: {
                deletedAt: {isNull: true}
              }
            }) {
              edges {
                node {
                  id
                  payload
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
                        payload
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`;

    const data = await this.executeQuery(query);
    const edges = data?.viewer?.conversationList?.edges || [];
    const conversations = await Promise.all(
      edges.map(async (edge) => {
        if (edge.node.deletedAt) return null;
        return await this.decryptNode(edge.node);
      }),
    );
    return conversations.filter((c) => c && c.deletedAt === null);
  }

  async getConversation(id) {
    this.validateDID();

    const query = `
      {
        node(id: "${id}") {
          ... on Conversation {
            id
            payload
            controllerDID {
              id
            }
            createdAt
            updatedAt
            deletedAt
            members {
              id
            }
            messages(first: 1000, filters: {where: {deletedAt: {isNull: true}}}, sorting: { createdAt: ASC }) {
              edges {
                node {
                  id
                  controllerDID {
                    id
                  }
                  createdAt
                  updatedAt
                  deletedAt
                  payload
                }
              }
            }
          }
        }
      }`;

    const data = await this.executeQuery(query);
    if (data.node.deletedAt) return null;
    return await this.decryptNode(data.node);
  }

  async createConversation(params) {
    this.validateDID();

    let members;
    if (params.members) {
      members = params.members;
      delete params.members;
    } else {
      const agentDID = await getAgentDID();
      members = [this.did.id, agentDID.id];
    }

    const content = {
      payload: await createDagJWE(this.did, members, params),
      members,
      createdAt: getCurrentDateTime(),
      updatedAt: getCurrentDateTime(),
    };

    const query = `
      mutation CreateConversation($input: CreateConversationInput!) {
        createConversation(input: $input) {
          document {
            id
            payload
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
      }`;

    const data = await this.executeQuery(query, { input: { content } });
    const document = data.createConversation.document;

    const decryptedPayload = await decryptJWE(this.did, document.payload);
    return { ...document, ...decryptedPayload, payload: undefined };
  }

  async updateConversation(id, params) {
    this.validateDID();

    const conversation = await this.getConversation(id);
    const { deletedAt, ...paramsWithoutDeletedAt } = params;
    const content = {
      payload: await createDagJWE(
        this.did,
        conversation.members.map((i) => i.id),
        paramsWithoutDeletedAt,
      ),
      updatedAt: getCurrentDateTime(),
      ...(deletedAt && { deletedAt }),
    };

    const query = `
      mutation UpdateConversation($input: UpdateConversationInput!) {
        updateConversation(input: $input) {
          document {
            id
            payload
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
                  payload
                }
              }
            }
          }
        }
      }`;

    const data = await this.executeQuery(query, { input: { id, content } });
    const document = data.updateConversation.document;

    const decryptedPayload = await decryptJWE(this.did, document.payload);
    const messages = await Promise.all(
      document.messages.edges.map(async (edge) => ({
        ...edge.node,
        payload: await decryptJWE(this.did, edge.node.payload),
      })),
    );
    return { ...document, ...decryptedPayload, messages, payload: undefined };
  }

  async deleteConversation(id) {
    this.validateDID();

    const conversation = await this.getConversation(id);

    if (!conversation) {
      return;
    }
    if (conversation && conversation.messages) {
      for (const message of conversation.messages) {
        try {
          await this.deleteMessage(id, message.id);
        } catch (e) {
          console.error(e);
        }
      }
    }

    return await this.updateConversation(id, {
      deletedAt: getCurrentDateTime(),
    });
  }

  async getMessage(id) {
    this.validateDID();

    const query = `
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
            payload
          }
        }
      }`;

    const data = await this.executeQuery(query);
    const node = data.node;

    const decryptedPayload = await decryptJWE(this.did, node.payload);
    delete node.payload;
    return { ...node, ...decryptedPayload };
  }

  async createMessage(conversationId, params) {
    this.validateDID();

    const conversation = await this.getConversation(conversationId);

    console.log("conversation", conversation, `heheh`);
    const content = {
      conversationId,
      payload: await createDagJWE(
        this.did,
        conversation.members.map((i) => i.id),
        params,
      ),
      createdAt: getCurrentDateTime(),
      updatedAt: getCurrentDateTime(),
    };

    const query = `
      mutation CreateEncryptedMessage($input: CreateEncryptedMessageInput!) {
        createEncryptedMessage(input: $input) {
          document {
            id
            payload
            createdAt
            updatedAt
            deletedAt
            controllerDID {
              id
            }
          }
        }
      }`;

    const data = await this.executeQuery(query, { input: { content } });
    const document = data.createEncryptedMessage.document;

    const decryptedPayload = await decryptJWE(this.did, document.payload);
    delete document.payload;
    return { ...document, ...decryptedPayload };
  }

  async updateMessage(conversationId, messageId, params, deleteAfter = false) {
    this.validateDID();

    const message = await this.getMessage(messageId);

    if (!message) {
      return;
    }
    const conversation = await this.getConversation(conversationId);
    if (!conversation) {
      return;
    }
    const agentDID = await getAgentDID();
    const agentConvService = new ConversationService(this.definition).setDID(
      agentDID,
    );

    if (deleteAfter && conversation && conversation.messages.length > 0) {
      for (const messageEdge of conversation.messages.filter(
        (m) => new Date(m.createdAt) > new Date(message.createdAt),
      )) {
        if (messageEdge.controllerDID.id === agentDID.id) {
          await agentConvService.deleteMessage(conversation.id, messageEdge.id);
        } else if (messageEdge.controllerDID.id === this.did.id) {
          await this.deleteMessage(conversation.id, messageEdge.id);
        } else {
          console.log(`Skipping message ${messageEdge.id}`);
        }
      }
    }

    const { deletedAt, ...paramsWithoutDeletedAt } = params;
    const content = {
      conversationId,
      payload: paramsWithoutDeletedAt
        ? await createDagJWE(
            this.did,
            conversation.members.map((i) => i.id),
            paramsWithoutDeletedAt,
          )
        : "",
      updatedAt: getCurrentDateTime(),
      ...(deletedAt && { deletedAt }),
    };

    const query = `
      mutation UpdateEncryptedMessage($input: UpdateEncryptedMessageInput!) {
        updateEncryptedMessage(input: $input) {
          document {
            id
            payload
            createdAt
            updatedAt
            deletedAt
            controllerDID {
              id
            }
          }
        }
      }`;

    const data = await this.executeQuery(query, {
      input: { id: messageId, content },
    });
    const document = data.updateEncryptedMessage.document;

    const decryptedPayload = await decryptJWE(this.did, document.payload);
    delete document.payload;
    return { ...document, ...decryptedPayload };
  }

  async deleteMessage(conversationId, messageId) {
    return await this.updateMessage(conversationId, messageId, {
      deletedAt: getCurrentDateTime(),
    });
  }
}
