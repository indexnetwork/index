require('dotenv').config()
const _ = require('lodash')
const { Kafka } = require('kafkajs')
const indexer = require('./controllers/indexer.js')

const kafka = new Kafka({
    clientId: 'api',
    brokers: ['kafka.composedb:9092'],
})

const topics = {
    'postgres.public.kjzl6hvfrbw6cb0dwlhc750jr0ndiv8sn1l6at7cb179ulet7azkx7bcfe25e9j': 'link',
    'postgres.public.kjzl6hvfrbw6c806itknk4zvj5vxcjposg5e1196tyzqvg7zf0w5j16sdp035o9': 'index'
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
                ..._.pick(value, ['controller_did', 'created_at','updated_at']),
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



