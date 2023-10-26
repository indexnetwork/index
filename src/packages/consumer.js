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
    'postgres.public.kjzl6hvfrbw6caw09g11y7vy1qza903xne35pi30xvmelvnvlfxy9tadwwkzzd6': 'index',
    'postgres.public.kjzl6hvfrbw6c92114fj79ii6shyl8cbnsz5ol3v62s0uu3m78gy76gzaovpaiu': 'link',
    'postgres.public.kjzl6hvfrbw6c8a1u7qrk1xcz5oty0temwn2szbmhl8nfnw9tddljj4ue8wba68': 'index_link',
    'postgres.public.kjzl6hvfrbw6c9aw0xd4vlhqc5mx57f0y2xmm8xiyxzzj1abrizfyppup22r9ac': 'user_index',
    'postgres.public.kjzl6hvfrbw6ca52q3feusjpl2r49wv9x0odyd2zmaytyq8ddunud4243rvl3gm': 'profile',
}

async function start() {
    await redis.connect()
    const rnd = Math.random().toString(36).slice(2, 7);
    const consumer = kafka.consumer({ groupId: `index-consumer-dev-v6zei}` })
    await consumer.connect()
    await consumer.subscribe({ topics: Object.keys(topics)})
    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());

            const op = value.__op;
            if(!['c', 'u'].includes(op)){
                return;
            }
            let docId = value.stream_id;
            const model = topics[topic];

            switch (model) {
                case 'index':
                    switch (op) {
                        case "c":
                            await indexer.createIndex(docId)
                            break
                        case "u":
                            await indexer.updateIndex(docId)
                            break
                    }
                    break
                case 'user_index':
                    switch (op) {
                        case "c":
                            await indexer.createUserIndex(docId)
                            break
                        case "u":
                            await indexer.updateUserIndex(docId)
                            break
                    }
                    break
                case 'index_link':
                    switch (op) {
                        case "c":
                            await indexer.createIndexLink(docId)
                            break
                        case "u":
                            await indexer.updateIndexLink(docId)
                            break
                    }
                    break
                case 'link':
                    switch (op) {
                        case "c":
                            await indexer.createLink(docId)
                            break
                        case "u":
                            await indexer.updateLink(docId)
                            break
                    }
                    break
                case 'profile':
                    switch (op) {
                        case "c":
                            await indexer.createProfile(docId)
                            break
                        case "u":
                            await indexer.updateProfile(docId)
                            break
                    }
                    break
            }

        },
    })
}

start()
