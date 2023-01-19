require('dotenv').config()
const _ = require('lodash')
const { Kafka } = require('kafkajs')
const indexer = require('./controllers/indexer.js')

const kafka = new Kafka({
    clientId: 'api',
    brokers: ['kafka.composedb:9092'],
})

const topics = {
    'postgres.public.kjzl6hvfrbw6c8696fsod7n8ziu7gjn66opuepm2g5h12kiak7dsl4vcq7avkhl': 'link',
    'postgres.public.kjzl6hvfrbw6c62eb8h5htpr5yzizs1oc6w834botm5mdfnju6smn441uubss1x': 'index'
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



