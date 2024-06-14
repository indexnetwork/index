import axios from "axios";
import { getAgentDID } from "../utils/helpers.js";
import { ConversationService } from "../services/conversation.js";

export const handleNewItemEvent = async (
  chatId,
  subscription,
  item,
  redisClient,
) => {
  console.log(`New item subscriber for ${chatId}`);
  const subscriptionResp = await redisClient.hGet(`subscriptions`, chatId);
  if (!subscriptionResp) {
    return;
  }

  const agentDID = await getAgentDID();
  const conversationService = new ConversationService(definition).setDID(
    agentDID,
  );

  const assistantMessage = await conversationService.createMessage(id, {
    role: "assistant",
    content: "",
  });

  const { indexIds, messages } = subscription;
  const chatRequest = {
    indexIds,
    input: {
      information: JSON.stringify(item),
      chat_history: messages,
    },
  };
  try {
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/stream`,
      chatRequest,
      {
        responseType: "text",
      },
    );
    console.log(`Update evaluation response for ${chatId}`, resp.data);
    if (resp.data && !resp.data.includes("NOT_RELEVANT")) {
      assistantMessage.content = resp.data;
      await redisClient.publish(
        `agentStream:${id}:update`,
        JSON.stringify({
          payload: assistantMessage,
          name: "listener",
          messageId: assistantMessage.id,
        }),
      );
      await conversationService.updateMessage(id, assistantMessage.id, {
        content: assistantMessage,
      });
      await redisClient.hSet(
        `subscriptions`,
        chatId,
        JSON.stringify({ indexIds, messages: [...messages, assistantMessage] }),
      );
    }
  } catch (e) {
    console.log(e);
  }
};
