import { handleCompletions } from "../language/completions.js";
import { ConversationService } from "../services/conversation.js";
import { DIDService } from "../services/did.js";
import { flattenSources, getAgentDID } from "../utils/helpers.js";
import * as hub from "langchain/hub";

export const handleUserMessage = async (
  message,
  runtimeDefinition,
  pubSubClient,
  redisClient,
) => {
  const definition = runtimeDefinition;
  const { id, messages, sources, ...rest } = message.conversation;
  console.log("tarkan")
  const didService = new DIDService(definition);
  const agentDID = await getAgentDID();
  const conversationService = new ConversationService(definition).setDID(
    agentDID,
  );
  const reqIndexIds = await flattenSources(sources, didService);

  let isStopped = false;
  let isSaved = false;
  pubSubClient.subscribe(`stopChat`, async (stopId) => {
    if (stopId === id) {
      isStopped = true;
    }
  });

  const assistantMessage = await conversationService.createMessage(id, {
    role: "assistant",
    content: "",
    name: "basic_assistant",
  });

  try {

    const completionsPrompt = await hub.pull("v2_completions");
    const completionsPromptText = completionsPrompt.promptMessages[0].prompt.template;
    
    const filteredMessages = messages.filter((_, index) => index <= messages.findIndex((m) => m.id === message.id));
    console.log(filteredMessages)
    const response = await handleCompletions({
      indexIds:  reqIndexIds,
      messages: [{
        role: 'system',
        content: completionsPromptText
      }, ...filteredMessages.map((c) => {
        return {
          id: c.id,
          role: c.role,
          content: c.content,
        };
      })],
      stream: true
    })

  
    // Process each chunk from the stream
    for await (const chunk of response) {
      if (isStopped && !isSaved) {
        isSaved = true;
        await conversationService.updateMessage(id, assistantMessage.id, {
          role: "assistant",
          content: assistantMessage.content,
          name: "basic_assistant",
        });
        break;
      }

      const content = chunk.choices[0]?.delta?.content;
      if (!content) continue;

      assistantMessage.content += content;
      await redisClient.publish(
        `agentStream:${id}:chunk`,
        JSON.stringify({
          chunk: content,
          name: "basic_assistant",
          messageId: assistantMessage.id,
        }),
      );
        
    }

    if (assistantMessage.content && !isStopped && !isSaved) {
      await redisClient.publish(
        `agentStream:${id}:end`,
        JSON.stringify({
          end: true,
          name: "basic_assistant",
          messageId: assistantMessage.id,
        }),
      );
      await conversationService.updateMessage(id, assistantMessage.id, {
        content: assistantMessage.content,
        name: "basic_assistant",
        role: "assistant",
      });
      // todo api save.
      isStopped = true;
      isSaved = true;
    }
  } catch (error) {
    // Handle the exception
    console.error("An error occurred:", error);
  }
};
