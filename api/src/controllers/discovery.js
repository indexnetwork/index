import axios from "axios";
import { DIDService } from "../services/did.js";

import RedisClient from "../clients/redis.js";

const redis = RedisClient.getInstance();


const flattenSources = async (sources) => {
  const didService = new DIDService();

  const sourcePromises = sources.map(async (source) => {
    if (source.includes("did:")) {
      // TODO: check better
      const did = source.split("/")[0];

      let type;
      if (source.includes("/index/starred")) {
        type = "starred";
      } else if (source.includes("/index/owned")) {
        type = "owned";
      }

      return didService
        .getIndexes(did, type)
        .then((indexes) => indexes.map((i) => i.id));
    } else {
      const result = [source];
      const subIndexes = await redis.hKeys(`index:${source}:subIndexes`);
      if (subIndexes.length > 0) {
          result.push(...subIndexes);
      }
      return Promise.resolve(result);
    }
  });

  const results = await Promise.all(sourcePromises);
  return results.flat();
};

export const chat = async (req, res, next) => {
  const { id, messages, sources, ...rest } = req.body;

  const reqIndexIds = await flattenSources(sources);

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
    resp.data.pipe(res);
  } catch (error) {
    // Handle the exception
    console.error("An error occurred:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
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
