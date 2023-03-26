if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()
}

const _ = require('lodash')
const { Kafka } = require('kafkajs')
const indexer = require('../libs/kafka-indexer.js')

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

const topics = {
    'postgres.public.kjzl6hvfrbw6c9bh2wggilqiije6udtgohahloxhuhbkm0igfjd3pm05z80164h': 'index',
    //'postgres.public.kjzl6hvfrbw6c569n1q6egc47s4u2213x1rs4jjygrgszjmdo3nedbrnt8dl46q': 'link',
    'postgres.public.kjzl6hvfrbw6c560rpemkm0l47ud63g1ydbs8yfkrbli53mxtf25uszqoqwunog': 'index_link',
    'postgres.public.kjzl6hvfrbw6c8x0tvgf98z805tg08s6fn9tre7wiusghayi8f83rcoyh3hdo9b': 'user_index'
}

async function start() {
    await redis.connect()
    const consumer = kafka.consumer({ groupId: `index-consumer-dev-7` })
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
                ..._.pick(value, ['controller_did']),
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
            }

        },
    })
}

start()
