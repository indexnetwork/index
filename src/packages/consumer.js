import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import { definition } from "../types/merged-runtime.js";

import { Kafka } from 'kafkajs'
import * as indexer from '../libs/kafka-indexer.js';
import RedisClient from '../clients/redis.js';

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})

const redis = RedisClient.getInstance();

const topics = [
    definition.models.IndexItem,
    definition.models.WebPage
]

async function start() {

    await redis.connect()
    const consumerItems = kafka.consumer({
        groupId: `index-consumer-dev-12`,
        sessionTimeout: 300000,
        heartbeatInterval: 10000,
        rebalanceTimeout: 3000,
    })
    await consumerItems.connect()
    await consumerItems.subscribe({ topics: topics.map(t => `postgres.public.${t.id}`), fromBeginning: true})
    await consumerItems.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());
            const op = value.__op;
            const model = topics.items[topic]
            if(!['c', 'u'].includes(op)){
                return;
            }

            let docId = value.stream_id;

            // For each updated graph object
                // find it's associated indexItems
                    // reindex item according to rules of index.
            // Index item:
                Index this mutherfucker.
            switch (model) {
                case `${definition.models.IndexItem.id}`:
                    switch (op) {
                        case "c":
                            indexer.createIndexLink(docId)
                            break
                        case "u":
                            indexer.updateIndexLink(docId)
                            break
                    }
                    break
                case 'WebPage':
                    switch (op) {
                        case "c":
                            // We are not interested in this case.
                            // We'll index objects only if they belong to an index.
                            break
                        case "u":
                            // Find
                            indexer.updateWebPage(docId)
                            break
                    }
                    break
            }

        },
    })

}

start()
