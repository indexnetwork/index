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
    //'postgres.public.kjzl6hvfrbw6c732vo3usihwsmaudk78by48c6fy7qxxwkmn9yrryza13jyg6kt': 'link',
    //'postgres.public.kjzl6hvfrbw6c8mi3r321zv8aujo0pz75u3hd75nmnw8cohfakz650td4c7qxxf': 'index',
    'postgres.public.kjzl6hvfrbw6c9uhr6wtbziqokgadeavvh1y9u7qbs6u3jmwz7nmxexwb0mgj52': 'user_index'
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



