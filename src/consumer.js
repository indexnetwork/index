if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()
}

const _ = require('lodash')
const { Kafka } = require('kafkajs')
const indexer = require('./controllers/indexer.js')

const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})

const RedisClient = require('./clients/redis.js');
const redis = RedisClient.getInstance();

const topics = {
    'postgres.public.kjzl6hvfrbw6casje7g29aekjral6tocm9tbzyc7n3dwtp4j1il3sd3l5k6q7x4': 'link',
    'postgres.public.kjzl6hvfrbw6c90qlqsw8wknzoi3rhspund6qzgz8vifalod8jk8ujwdji5kdm1': 'index',
    'postgres.public.kjzl6hvfrbw6cb2dygt8kwbw3jfcgny4omo1patq3iipe2o24jcwl5v99by7qye': 'user_index'
}

async function start() {
    await redis.connect()
    const consumer = kafka.consumer({ groupId: `index-consumer-${Math.random()}` })
    await consumer.connect()
    await consumer.subscribe({ topics: Object.keys(topics) })
    //conflicts: "proceed",
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
            console.log(doc);

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
            }

        },
    })

}

start()



