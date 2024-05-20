import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

import RedisClient from "../clients/redis.js";

import Indexer from "../libs/indexer.js";

import { EventSource } from "cross-eventsource";
import { JsonAsString, AggregationDocument } from "@ceramicnetwork/codecs";
import { decode } from "codeco";
import { fetchModelInfo } from "../utils/helpers.js";
import { createClient } from "redis";

const ceramicFirehose = new EventSource(
  `${process.env.CERAMIC_HOST}/api/v0/feed/aggregation/documents`,
);

const redis = RedisClient.getInstance();

const subClient = createClient({
  url: process.env.REDIS_CONNECTION_STRING,
});

async function start() {
  await subClient.connect();
  let { runtimeDefinition, modelFragments } = await fetchModelInfo();
  subClient.subscribe("newModel", async (id) => {
    console.log("New model detected, fetching model info", id);
    ({ runtimeDefinition, modelFragments } = await fetchModelInfo());
  });
  await redis.connect();

  const Codec = JsonAsString.pipe(AggregationDocument);

  const indexer = new Indexer(runtimeDefinition, modelFragments);
  ceramicFirehose.addEventListener("message", async (event) => {
    const parsedData = decode(Codec, event.data);
    const modelId = parsedData.metadata.model.toString();
    const streamId = parsedData.commitId.baseID.toString();
    const op = parsedData.eventType === 0 ? "c" : "u";

    console.log("New event: ", modelId, streamId, op);

    try {
      switch (modelId) {
        case runtimeDefinition.models.IndexItem.id:
          switch (op) {
            case "c":
              await indexer.createIndexItemEvent(streamId);
              break;
            case "u":
              await indexer.updateIndexItemEvent(streamId);
              break;
          }
          break;
        case runtimeDefinition.models.WebPage.id:
          switch (op) {
            case "c":
              // We are not interested in this case.
              // We'll index objects only if they belong to an index.
              break;
            case "u":
              await indexer.updateWebPageEvent(streamId);
              break;
          }
          break;
        case runtimeDefinition.models.Embedding.id:
          switch (op) {
            case "c":
              await indexer.createEmbeddingEvent(streamId);
              break;
            case "u":
              await indexer.updateEmbeddingEvent(streamId);
              break;
          }
          break;
      }
    } catch (e) {
      console.log(e);
    }
  });

  ceramicFirehose.addEventListener("error", (error) => {
    console.log("error", error);
  });
}

start();
