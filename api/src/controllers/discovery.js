import { z } from "zod";
import { ethers } from "ethers";
import * as hub from "langchain/hub";
import RedisClient from "../clients/redis.js";
import { flattenSources } from "../utils/helpers.js";
import { DIDService } from "../services/did.js";
import { searchItems } from "../language/search_item.js";
import { handleCompletions } from "../language/completions.js";

const redis = RedisClient.getInstance();
const pubSubClient = RedisClient.getPubSubInstance();

export const search = async (req, res, next) => {
  const { query, sources, limit, offset, dateFilter, ...rest } = req.body;
  const definition = req.app.get("runtimeDefinition");
  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);

  try {
    const resp = await searchItems({
      indexIds: reqIndexIds,
      query,
      limit,
      offset,
      dateFilter,
    });
    
    return res.status(200).json(resp);
  } catch (error) {
    console.error("An error occurred:", error);
    res.status(500).json({ error: error.message });
  }
};

export const completions = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");

  const { messages, sources, timeFilter, stream = true, prompt, schema } = req.body;

  try {
    const didService = new DIDService(definition);
    const reqIndexIds = await flattenSources(sources, didService);
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('Content-Encoding', 'none');
    }


    const response = await handleCompletions({
      messages,
      indexIds: reqIndexIds,
      stream,
      timeFilter,
      schema,
      prompt,
    });

    // Handle streaming response
    if (stream) {
      for await (const chunk of response) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          res.write(content);
        }
      }
      res.end();
    } else {
      if (schema) {
        return res.json(JSON.parse(response.choices[0].message.content));
      } else {
        return res.send(response.choices[0].message.content);
      }
    }
  } catch (error) {
    console.error("An error occurred:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
};

export const updates = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const { query, sources } = req.query;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const didService = new DIDService(definition);
  const reqIndexIds = await flattenSources(sources, didService);
  const reqIndexChannels = reqIndexIds.map((id) => `indexStream:${id}`);

  await pubSubClient.subscribe(reqIndexChannels, async (payload, channel) => {
    const indexId = channel.replace(`indexStream:`, "");
    const message = {
      indexId,
      data: {
        node: JSON.parse(payload),
      },
    };
    res.write(`data: ${JSON.stringify(message)}\n\n`);
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

    
    const sourcesHash = ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(JSON.stringify(reqIndexIds)),
    );

    const questionCache = await redis.get(`questions:${sourcesHash}`);

    if (questionCache) {
      let resp = JSON.parse(questionCache);
      return res.status(200).json({ questions: resp });
    }

    const questionPrompt = await hub.pull("v2_web_question_generation");
    const questionPromptText = questionPrompt.promptMessages[0].prompt.template;
  
    let questions = await handleCompletions({
      messages: [{
        role: "system",
        content: questionPromptText
      }],
      indexIds: reqIndexIds,
      stream: false,
      maxDocs: 10,
      schema:  z.object({
        questions: z.array(z.string()),
      })
    });

    
    const questionsResp = JSON.parse(questions.choices[0].message.content)
    questions = questionsResp.questions


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
    console.log(error)
  }
};

export const chat = async (req, res, next) => {};
