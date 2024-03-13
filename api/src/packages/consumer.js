import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import { definition } from "../types/merged-runtime.js";

import RedisClient from '../clients/redis.js';

import * as indexer from '../libs/kafka-indexer.js';

import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

import { EventSource  } from "cross-eventsource";
import { JsonAsString, AggregationDocument } from '@ceramicnetwork/codecs';
import { decode } from "codeco";


Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    new ProfilingIntegration(),
  ],
  // Performance Monitoring
  tracesSampleRate: 1.0, //  Capture 100% of the transactions
  // Set sampling rate for profiling - this is relative to tracesSampleRate
  profilesSampleRate: 1.0,
});

const ceramicFirehose = new EventSource(`${CERAMIC_HOST}/api/v0/feed/aggregation/documents``)

const redis = RedisClient.getInstance();

async function start() {

    await redis.connect()

    const Codec = JsonAsString.pipe(AggregationDocument)

    ceramicFirehose.addEventListener('message', async (event) => {

     	const parsedData = decode(Codec, event.data);
      const modelId = parsedData.metadata.model.toString();
     	const streamId = parsedData.commitId.baseID.toString()
      const op = parsedData.eventType === 0 ? "c" : "u"

      console.log("New event: ", modelId, streamId, op);

      try {

        switch (modelId) {
            case definition.models.IndexItem.id:
                switch (op) {
                    case "c":
                        await indexer.createIndexItemEvent(streamId)
                        break
                    case "u":
                        await indexer.updateIndexItemEvent(streamId)
                        break
                }
                break
            case definition.models.WebPage.id:
                switch (op) {
                    case "c":
                        // We are not interested in this case.
                        // We'll index objects only if they belong to an index.
                        break
                    case "u":
                        await indexer.updateWebPageEvent(streamId)
                        break
                }
                break
            case definition.models.Embedding.id:
                switch (op) {
                    case "c":
                        await indexer.createEmbeddingEvent(streamId)
                        break
                    case "u":
                        await indexer.updateEmbeddingEvent(streamId)
                        break
                }
                break
        }
      } catch (e) {
          console.log(e)
      }

    })

    ceramicFirehose.addEventListener('error', error => {
      console.log('error', error)
    })

}

start()
