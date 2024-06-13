import axios from "axios";

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
      await redisClient.publish(`agentStream:${chatId}:update`, resp.data);
      await redisClient.hSet(
        `subscriptions`,
        chatId,
        JSON.stringify({ indexIds, messages: [messages, resp.data] }),
      );
    }
  } catch (e) {
    console.log(e);
  }
};
