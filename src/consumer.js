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

const topics = {
    'postgres.public.kjzl6hvfrbw6c8olbhuzwqimo7mudyf6iui6wb1nlymjf57y16uufzogjd0cc5m': 'link',
    'postgres.public.kjzl6hvfrbw6c9nr6lquycvocpcpg7sxz55v67iyyv2n2t29tre8hy2gli4m6wn': 'index',
    'postgres.public.kjzl6hvfrbw6c9nr6lquycvocpcpg7sxz55v67iyyv2n2t29tre8hy2gli4m6wn': 'user_index'
}

async function start() {

    const consumer = kafka.consumer({ groupId: `index-consumer-${Math.random()}` })
    await consumer.connect()
    await consumer.subscribe({ fromBeginning: true, topics: Object.keys(topics) })

    await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {

            let op = message.headers['__debezium-operation'].toString()
            let model = topics[topic]

            if(!['c', 'u'].includes(op)){
                return;
            }

            let value = JSON.parse(message.value.toString())
            if(value.stream_content){
                value.stream_content = JSON.parse(value.stream_content)
            }

            let doc = {
                id: value.stream_id,
                ..._.pick(value, ['controller_did']),
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



