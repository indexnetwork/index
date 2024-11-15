import axios from "axios";
import { ethers } from "ethers";
import { CeramicClient } from "@ceramicnetwork/http-client";

import RedisClient from "../clients/redis.js";
import { flattenSources } from "../utils/helpers.js";
import { DIDService } from "../services/did.js";
import { searchItems } from "../language/search_item.js";
import { DIDSession } from "did-session";

const redis = RedisClient.getInstance();
const pubSubClient = RedisClient.getPubSubInstance();

const ceramic = new CeramicClient(process.env.CERAMIC_HOST);

export const search = async (req, res, next) => {
  /*
  const searchRequest = {
    indexIds: req.body.indexIds,
    query: req.body.query,
    page: req.body.page || 1,
    limit: req.body.limit || 10,
    filters: req.body.filters || [],
  };
  */
  const { vector, sources, page, categories, modelNames, ...rest } = req.body;
  const definition = req.app.get("runtimeDefinition");
  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);

  try {
    const resp = await searchItems({
      indexIds: reqIndexIds,
      vector,
      page,
      categories,
      modelNames,
    });
    
    let ceramicResp = await ceramic.multiQuery(
      resp.map((doc) => {
        return {
          streamId: doc.item_id,
        };
      }),
    );
    

    ceramicResp = Object.values(ceramicResp).map((doc) => {
      const { vector, ...contentWithoutVector } = doc.content;
      return {
        id: doc.id.toString(),
        controllerDID: doc.state.metadata.controllers[0],
        ...contentWithoutVector,
      };
    });

    
    return res.status(200).json(ceramicResp);
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ error: error.message });
  }
};

export const completions = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { messages, prompt, sources, ...rest } = req.body;

  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);

  const payload = {
    indexIds: reqIndexIds,
  };
  if (messages) {
    payload.messages = messages;
    payload.basePrompt= "seref/first-system"
  } else if (prompt) {
    payload.prompt = prompt;
  }

  try {
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/external`,
      payload,
      {
        responseType: "stream",
      },
    );
    res.set(resp.headers);

    resp.data.on("data", (chunk) => {
      res.write(chunk);
    });

    resp.data.on("end", async () => {
      res.end();
    });
  } catch (error) {
    console.error("An error occurred:", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

export const updates = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { query, sources } = req.query;

  const session = await DIDSession.fromSession(req.query.session);
  if (!session || !session.isAuthorized()) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);
  const reqIndexChannels = reqIndexIds.map((id) => `indexStream:${id}`);

  await pubSubClient.subscribe(reqIndexChannels, async (payload, channel) => {
    const indexId = channel.replace(`indexStream:`, "");
    if (response) {
      res.write(
        `data: ${JSON.stringify({
          indexId,
          data: {
            relevance: response,
            node: JSON.parse(payload),
          },
        })}\n\n`,
      );
    }
  });

  // Cleanup on client disconnect
  req.on("close", () => {
    pubSubClient.unsubscribe(reqIndexChannels);
    res.end();
  });
};

export const questions = async (req, res, next) => {
  try {
    const definition = req.app.get("runtimeDefinition");
    const { sources } = req.body;

    const didService = new DIDService(definition);
    const reqIndexIds = await flattenSources(sources, didService);

    const items = await searchItems({
      indexIds: reqIndexIds,
    });
    if (items.length === 0) {
      return res.status(200).json({ questions: [] });
    }

    const sourcesHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(JSON.stringify(reqIndexIds)),
    );

    const questionCache = await redis.get(`questions:${sourcesHash}`);

    if (questionCache) {
      let resp = JSON.parse(questionCache);
      return res.status(200).json({ questions: resp });
    }

    try {
      let response = await axios.post(
        `${process.env.LLM_INDEXER_HOST}/chat/external`,
        {
          indexIds: reqIndexIds,
          basePrompt: "seref/question_generation_prompt-new",
        },
      );
      let questions = response.data.split(`\n`).filter((q) => q.length > 0);
      if (questions && questions.length > 0) {
        questions = questions.slice(0, 4);
        redis.set(`questions:${sourcesHash}`, JSON.stringify(questions), {
          EX: 86400,
        });
      } else {
        questions = [];
      }

      res.status(200).json({ questions });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const chat = async (req, res, next) => {};
