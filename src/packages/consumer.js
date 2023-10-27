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
    generic: {
        'postgres.public.kjzl6hvfrbw6caw09g11y7vy1qza903xne35pi30xvmelvnvlfxy9tadwwkzzd6': 'index',
        'postgres.public.kjzl6hvfrbw6c9aw0xd4vlhqc5mx57f0y2xmm8xiyxzzj1abrizfyppup22r9ac': 'user_index',
        'postgres.public.kjzl6hvfrbw6ca52q3feusjpl2r49wv9x0odyd2zmaytyq8ddunud4243rvl3gm': 'profile',
    },
    items: {
        'postgres.public.kjzl6hvfrbw6c92114fj79ii6shyl8cbnsz5ol3v62s0uu3m78gy76gzaovpaiu': 'link',
        'postgres.public.kjzl6hvfrbw6c8a1u7qrk1xcz5oty0temwn2szbmhl8nfnw9tddljj4ue8wba68': 'index_link',
    }
}

async function start() {

    await redis.connect()
    const consumerItems = kafka.consumer({
        groupId: `index-consumer-dev-12`,
        sessionTimeout: 300000,
        heartbeatInterval: 10000,
        rebalanceTimeout: 5000,
    })
    await consumerItems.connect()
    await consumerItems.subscribe({ topics: Object.keys(topics.items), fromBeginning: true})
    await consumerItems.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());
            console.log(value)
            const op = value.__op;
            const model = topics.items[topic]
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

            switch (model) {
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

    const consumerGeneric = kafka.consumer({
        groupId: `index-consumer-dev-12-generic`,
        sessionTimeout: 300000,
        heartbeatInterval: 10000,
        rebalanceTimeout: 5000,
    })
    await consumerGeneric.connect()
    await consumerGeneric.subscribe({ topics: Object.keys(topics.generic), fromBeginning: true})
    await consumerGeneric.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());
            console.log(value)
            const op = value.__op;
            const model = topics.generic[topic]
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
                case 'profile':
                    switch (op) {
                        case "c":
                            indexer.createProfile(doc)
                            break
                        case "u":
                            indexer.updateProfile(doc)
                            break
                    }
                    break
            }

        },
    })
}

start()
