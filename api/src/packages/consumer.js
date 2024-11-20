import dotenv from "dotenv";
import * as Sentry from "@sentry/node"
import { nodeProfilingIntegration } from '@sentry/profiling-node';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0, 
  profilesSampleRate: 1.0,
});

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

import RedisClient from "../clients/redis.js";

import Indexer from "../libs/indexer.js";

import { EventSource } from "cross-eventsource";
import { JsonAsString, AggregationDocument } from "@ceramicnetwork/codecs";
import { decode } from "codeco";
import { fetchModelInfo } from "../utils/helpers.js";

const ceramicFirehose = new EventSource(
  `${process.env.CERAMIC_HOST}/api/v0/feed/aggregation/documents`,
);
const Codec = JsonAsString.pipe(AggregationDocument);

const redisClient = RedisClient.getInstance();
const pubSubClient = RedisClient.getPubSubInstance();

async function start() {
  await pubSubClient.connect();
  await redisClient.connect();
  let { runtimeDefinition, modelFragments } = await fetchModelInfo();
  let indexer = new Indexer(runtimeDefinition, modelFragments);
  pubSubClient.subscribe(`newModel`, async (id) => {
    console.log("New model detected, fetching model info", id);
    ({ runtimeDefinition, modelFragments } = await fetchModelInfo());
    indexer = new Indexer(runtimeDefinition, modelFragments);
  });

  pubSubClient.subscribe(`reIndex`, async (id) => {
    console.log("Reindex an item through external redis subscription.", id);
    await indexer.createIndexItemEvent(id);
  });

  ceramicFirehose.addEventListener("message", async (event) => {
    const parsedData = decode(Codec, event.data);

    const modelId = parsedData.metadata.model.toString();
    const streamId = parsedData.commitId.baseID.toString();
    const op = parsedData.eventType === 0 ? "c" : "u";
    const isProcessed = await redisClient.hIncrBy(
      `events`,
      `${modelId}:${streamId}:${parsedData.commitId.toString()}`,
      1,
    );

    if (isProcessed && isProcessed > 1) {
      console.log(
        `Event ${modelId}:${streamId}:${op} already processed ${isProcessed} times. Skipping...`,
      );
      return;
    } else {
      console.log(`Event ${modelId}:${streamId}:${op} is processing...`);
    }

    try {
      switch (modelId) {
        case runtimeDefinition.models.IndexItem.id:
          switch (op) {
            case "c":
              console.log(`IndexItem ${streamId} created`);
              await indexer.createIndexItemEvent(streamId);
              break;
            case "u":
              console.log(`IndexItem ${streamId} updated`);
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
              console.log(`WebPage ${streamId} updated`);
              await indexer.updateWebPageEvent(streamId);
              break;
          }
          break;
        case runtimeDefinition.models.Embedding.id:
          switch (op) {
            case "c":
              console.log(`Embedding ${streamId} created`);
              await indexer.createEmbeddingEvent(streamId);
              break;
            case "u":
              console.log(`Embedding ${streamId} updated`);
              await indexer.updateEmbeddingEvent(streamId);
              break;
          }
          break;
        case runtimeDefinition.models.EncryptedMessage.id:
          switch (op) {
            case "c":
              console.log(`User Message ${streamId} created`);
              await indexer.createEncryptedMessageEvent(
                streamId,
                pubSubClient,
                redisClient,
              );
              break;
            case "u":
              console.log(`User Message ${streamId} updated`);
              await indexer.updateEncryptedMessageEvent(streamId, pubSubClient, redisClient);
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
