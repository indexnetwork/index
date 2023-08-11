import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

import _  from 'lodash';
import { Kafka } from 'kafkajs'
import * as indexer from '../libs/kafka-indexer.js';
import RedisClient from '../clients/redis.js';

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})


const redis = RedisClient.getInstance();

const topics = {
    'postgres.public.kjzl6hvfrbw6c8e8rlhx3guuoc1o6i4vni5emzh2c48aa5pn0u71jggun7rtu2a': 'index',
    'postgres.public.kjzl6hvfrbw6c72mna95slfmi9nth1fp3bacc2ai7i6g1scygmo7awxsjl4dlpk': 'link',
    'postgres.public.kjzl6hvfrbw6c6vpgfoph7e98nkj4ujmd7bgw5ylb6uzmpts1yjva3zdjk0bhe9': 'index_link',
    'postgres.public.kjzl6hvfrbw6c5gi8p8j811v4u9tpel9m9lo11hm9ks74c1l0fhmnebsbtwusso': 'user_index'
}

async function start() {
    await redis.connect()
    const consumer = kafka.consumer({ groupId: `index-consumer-dev-8` })
    await consumer.connect()
    await consumer.subscribe({ topics: Object.keys(topics), fromBeginning: true})
    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());
            console.log(value)
            const op = value.__op;
            const model = topics[topic]
            if(!['c', 'u'].includes(op)){
                return;
            }

            if(value.stream_content){
                value.stream_content = JSON.parse(value.stream_content)
            }

            let doc = {
                id: value.stream_id,
                controllerDID: value.controller_did,
                ...value.stream_content
            }
            console.log(doc)


            switch (model) {
                case 'index':
                    switch (op) {
                        case "c":
                            indexer.createIndex(doc)
                            break
                        case "u":
                            indexer.updateIndex(doc)
                            break
                    }
                    break
                case 'user_index':
                    switch (op) {
                        case "c":
                            indexer.createUserIndex(doc)
                            break
                        case "u":
                            indexer.updateUserIndex(doc)
                            break
                    }
                    break
                case 'index_link':
                    switch (op) {
                        case "c":
                            indexer.createIndexLink(doc)
                            break
                        case "u":
                            indexer.updateIndexLink(doc)
                            break
                    }
                    break
                case 'link':
                    switch (op) {
                        case "c":
                            indexer.createLink(doc)
                            break
                        case "u":
                            indexer.updateLink(doc)
                            break
                    }
                    break
            }

        },
    })
}

start()
