import axios from "axios";
import { getAgentDID } from "../utils/helpers.js";
import { ConversationService } from "../services/conversation.js";
import { DIDService } from "../services/did.js";

export const handleNewItemEvent = async (
  chatId,
  subscription,
  item,
  definition,
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

  const { indexIds, messages } = subscription;
  const chatRequest = {
    basePrompt: "seref/index-relevancy-check",
    indexIds,
    messages: [
      ...messages.map((c) => {
        return {
          id: c.id,
          role: c.role,
          content: c.content,
        };
      }),
      {
        role: "system",
        content: `New information: ${JSON.stringify(item)}`,
      },
    ],
  };
  try {
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/external`,
      chatRequest,
      {
        responseType: "text",
      },
    );
    console.log(`Update evaluation response for ${chatId}`, resp.data);
    if (resp.data && !resp.data.includes("NOT_RELEVANT")) {
      const assistantMessage = await conversationService.createMessage(chatId, {
        content: resp.data,
        role: "assistant",
        name: "listener",
      });
      
      await redisClient.publish(
        `agentStream:${chatId}:update`,
        JSON.stringify({
          payload: assistantMessage,
          name: "listener",
          messageId: assistantMessage.id,
        }),
      );

      const didService = new DIDService(definition);

      const conversation = await conversationService.getConversation(chatId);
      const recipients = await Promise.all(
        conversation.members
          .filter((memberId) => memberId.id !== agentDID.id)
          .map(async (memberId) => {
            const externalId = await didService.getControllerDIDByEncryptionDID(memberId.id);
            console.log('External ID:', externalId);
            return {
              external_id: externalId
            };
          })
      );
      await axios.post('https://api.magicbell.com/broadcasts', {
        broadcast: {
          title: conversation.summary,
          content: resp.data,
          recipients
        }
      }, {
        headers: {
          'X-MAGICBELL-API-KEY': process.env.MAGICBELL_API_KEY,
          'X-MAGICBELL-API-SECRET': process.env.MAGICBELL_API_SECRET,
          'Content-Type': 'application/json'
        }
      })

      await redisClient.hSet(
        `subscriptions`,
        chatId,
        JSON.stringify({ indexIds, messages: [...messages, assistantMessage] }),
      );
    }
  } catch (e) {
    console.log(e.message);
  }
};
