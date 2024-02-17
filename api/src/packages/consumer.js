import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import { definition } from "../types/merged-runtime.js";

import { Kafka } from 'kafkajs'
import RedisClient from '../clients/redis.js';

import * as indexer from '../libs/kafka-indexer.js';

import * as Sentry from "@sentry/node";
import { ProfilingIntegration } from "@sentry/profiling-node";

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

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})

const redis = RedisClient.getInstance();

const topics = [
    definition.models.IndexItem,
    definition.models.WebPage,
    definition.models.Embedding
]

async function start() {

    await redis.connect()
    const consumerItems = kafka.consumer({
        groupId: `index-consumer-dev-1321`,
        sessionTimeout: 300000,
        heartbeatInterval: 10000,
        rebalanceTimeout: 3000,
    })
    await consumerItems.connect()
    await consumerItems.subscribe({ topics: topics.map(t => t.id), fromBeginning: false})
    await consumerItems.run({
        eachBatchAutoResolve: true,
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());

            const op = value.__op;
            if(!['c', 'u'].includes(op)){
                return;
            }

            let docId = value.stream_id;
            try {
                switch (topic) {

                    // TODO: Add index delete update events

                    case definition.models.IndexItem.id:
                        switch (op) {
                            case "c":
                                await indexer.createIndexItemEvent(docId)
                                break
                            case "u":
                                await indexer.updateIndexItemEvent(docId)
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
                                await indexer.updateWebPageEvent(docId)
                                break
                        }
                        break
                    case definition.models.Embedding.id:
                        switch (op) {
                            case "c":
                                await indexer.createEmbeddingEvent(docId)
                                break
                            case "u":
                                await indexer.updateEmbeddingEvent(docId)
                                break
                        }
                        break
                }
            } catch (e) {
                console.log(e)
            }

        },
    })

}

start()
