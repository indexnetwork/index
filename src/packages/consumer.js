import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}


import { Kafka } from 'kafkajs'
import * as indexer from '../libs/kafka-indexer.js';
import RedisClient from '../clients/redis.js';

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})


const redis = RedisClient.getInstance();

const topics = {
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
        rebalanceTimeout: 3000,
    })
    await consumerItems.connect()
    await consumerItems.subscribe({ topics: Object.keys(topics.items), fromBeginning: true})
    await consumerItems.run({
        eachMessage: async ({ topic, partition, message }) => {

            const value = JSON.parse(message.value.toString());
            const op = value.__op;
            const model = topics.items[topic]
            if(!['c', 'u'].includes(op)){
                return;
            }

            let docId = value.stream_id;

            switch (model) {
                case 'index_link':
                    switch (op) {
                        case "c":
                            indexer.createIndexLink(docId)
                            break
                        case "u":
                            indexer.updateIndexLink(docId)
                            break
                    }
                    break
                case 'link':
                    switch (op) {
                        case "c":
                            indexer.createLink(docId)
                            break
                        case "u":
                            indexer.updateLink(docId)
                            break
                    }
                    break
            }

        },
    })

}

start()
