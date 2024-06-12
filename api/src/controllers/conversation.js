import { ConversationService } from "../services/conversation.js";

// List all conversations
export const listConversations = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const conversations = await conversationService.listConversations();
    res.status(200).json(conversations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Get a single conversation by ID
export const getConversation = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { id } = req.params;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const conversation = await conversationService.getConversation(id);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create a new conversation
export const createConversation = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const conversation = await conversationService.createConversation(req.body);
    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a conversation by ID
export const updateConversation = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { id } = req.params;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const conversation = await conversationService.updateConversation(
      id,
      req.body,
    );
    res.status(200).json(conversation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a conversation by ID
export const deleteConversation = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { id } = req.params;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    await conversationService.deleteConversation(id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Create a new message
export const createMessage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { conversationId } = req.params;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const message = await conversationService.createMessage(
      conversationId,
      req.body,
    );
    res.status(201).json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Update a message by ID
export const updateMessage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { conversationId, messageId } = req.params;
  const { deleteAfter } = req.query;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    const message = await conversationService.updateMessage(
      conversationId,
      messageId,
      req.body,
      deleteAfter,
    );
    res.status(200).json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Delete a message by ID
export const deleteMessage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { conversationId, messageId } = req.params;
  const { deleteAfter } = req.query;
  try {
    const conversationService = new ConversationService(definition).setSession(
      req.session,
    );
    await conversationService.deleteMessage(
      conversationId,
      messageId,
      deleteAfter,
    );
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
