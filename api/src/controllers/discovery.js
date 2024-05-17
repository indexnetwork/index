import axios from "axios";

import { ethers } from "ethers";

import RedisClient from "../clients/redis.js";
import { flattenSources } from "../utils/helpers.js";

const redis = RedisClient.getInstance();

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

export const questions = async (req, res, next) => {
  try {
    console.log(`mala`);
    const { sources } = req.body;

    const reqIndexIds = await flattenSources(sources);

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
