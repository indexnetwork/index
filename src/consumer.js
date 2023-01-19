const _ = require('lodash')
const { Kafka } = require('kafkajs')
const indexer = require('./controllers/indexer.js')

const kafka = new Kafka({
    clientId: 'api',
    brokers: ['kafka.composedb:9092'],
})

const topics = {
    'postgres.public.kjzl6hvfrbw6c8h4pade9b7b37yg0dcm2vy5ilqhwcdlwwmkve2173np0dwi3g8': 'link',
    'postgres.public.kjzl6hvfrbw6cakrkcfo753x5e2xno56ggo44120sfp4z99fzfgyk7v731mzv6d': 'index'
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
                ..._.pick(value, ['stream_id', 'controller_did', 'created_at','updated_at']),
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
            }

        },
    })

}

start()



