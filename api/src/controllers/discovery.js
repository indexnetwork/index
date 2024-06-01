import axios from "axios";
import { ethers } from "ethers";
import { CeramicClient } from "@ceramicnetwork/http-client";

import RedisClient from "../clients/redis.js";
import { flattenSources } from "../utils/helpers.js";
import { DIDService } from "../services/did.js";

const redis = RedisClient.getInstance();
const pubSubClient = RedisClient.getPubSubInstance();

const ceramic = new CeramicClient(process.env.CERAMIC_HOST);

export const chat = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { id, messages, sources, ...rest } = req.body;

  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);

  try {
    const chatRequest = {
      indexIds: reqIndexIds,
      input: {
        question: messages.at(-1).content,
        chat_history: [...messages.slice(0, -1)],
      },
      model_args: {
        ...rest,
      },
    };
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/stream`,
      chatRequest,
      {
        responseType: "stream",
      },
    );
    res.set(resp.headers);

    let cmdMode = false;
    let inferredCmd = "";
    resp.data.on("data", (chunk) => {
      const plainText = chunk.toString();
      if (plainText.includes("<<")) {
        cmdMode = true;
      } else if (plainText.includes(">>")) {
        cmdMode = false;
      } else if (cmdMode) {
        inferredCmd += plainText;
      } else {
        res.write(chunk);
      }
    });

    resp.data.on("end", async () => {
      if (inferredCmd) {
        await redis.hSet(
          `subscriptions`,
          id,
          JSON.stringify({
            indexIds: reqIndexIds,
            messages,
          }),
        );
        await redis.publish(`newSubscription`, id);
      }
      console.log("Stream ended", inferredCmd);
      res.end();
    });
  } catch (error) {
    // Handle the exception
    console.error("An error occurred:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updates = async (ws, req) => {
  //const definition = req.app.get("runtimeDefinition");
  //const { id, messages, sources, ...rest } = req.body;

  const { chatId } = req.params;
  await pubSubClient.subscribe(`newUpdate:${chatId}`, async (itemId) => {
    console.log(chatId, itemId, `newUpdate`);
    console.log("New update triggered, fetching item data", itemId);
    const subscriptionResp = await redis.hGet(`subscriptions`, chatId);
    if (!subscriptionResp) {
      return;
    }
    const { indexIds, messages } = JSON.parse(subscriptionResp);
    const itemStream = await ceramic.loadStream(itemId);
    const chatRequest = {
      indexIds,
      input: {
        question: `
          Determine if the following information is relevant to the previous conversation.
          If it is relevant, output a conversation simulating that you received real-time news for the user.
          Use conversational output format suitable to data model, use bold texts and links when available.
          Do not mention relevancy check, just share it as an update.
          If it is not relevant, simply say "NOT_RELEVANT.
          Information: ${JSON.stringify(itemStream.content)}
          `,
        chat_history: messages,
      },
    };
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/stream`,
      chatRequest,
      {
        responseType: "text",
      },
    );
    console.log("Update evaluation response", resp.data);
    ws.send(resp.data);
  });
};
export const search = async (req, res, next) => {
  try {
    const searchRequest = {
      indexIds: req.body.indexIds,
      query: req.body.query,
      page: req.body.page || 1,
      limit: req.body.limit || 10,
      filters: req.body.filters || [],
    };

    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/search/query`,
      searchRequest,
      {
        responseType: "stream",
      },
    );
    res.set(resp.headers);
    resp.data.pipe(res);
  } catch (error) {
    // Handle the exception
    console.error("An error occurred:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const questions = async (req, res, next) => {
  try {
    const definition = req.app.get("runtimeDefinition");
    const { sources } = req.body;

    const didService = new DIDService(definition);
    const reqIndexIds = await flattenSources(sources, didService);

    const sourcesHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(JSON.stringify(reqIndexIds)),
    );

    const questionCache = await redis.get(`questions:${sourcesHash}`);

    if (questionCache) {
      return res.status(200).json(JSON.parse(questionCache));
    }

    try {
      let response = await axios.post(
        `${process.env.LLM_INDEXER_HOST}/chat/questions`,
        {
          indexIds: reqIndexIds,
        },
      );
      redis.set(`questions:${sourcesHash}`, JSON.stringify(response.data), {
        EX: 86400,
      });
      res.status(200).json(response.data);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
