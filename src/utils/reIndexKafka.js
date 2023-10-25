import dotenv from 'dotenv'
dotenv.config()

import _  from 'lodash';

import {getIndexById, getIndexLinkById, getLinkById, getProfileById, getUserIndexById} from "./../libs/composedb.js";


import { Kafka } from 'kafkajs'


const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
})

const producer = kafka.producer();





const queryModel = async (cursor, model) => {
    const query = `
    query {
      ${model}(first: 100${cursor ? `, after: "${cursor}"` : ''}) {
        edges {
          node {
            id
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  `;

    const response = await fetch(`${process.env.COMPOSEDB_HOST}/graphql`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            query,
        }),
    });


    if (response.ok) {

        const json = await response.json();
        return json.data;
    } else {
        const error = await response.text();
        throw new Error(`GraphQL query failed: ${error}`);
    }
};


const pushToKafka = async (data, model, topic) => {
    await producer.connect();
    console.log(data,model)
    for (const edge of data[model].edges) {
        await producer.send({
            topic,
            messages: [
                {value: JSON.stringify({
                        stream_id: edge.node.id,
                        "__op":"c"
                })}
            ],
        });
    }

    await producer.disconnect();
};

const paginateAndPush = async (model, topic) => {
    let hasNextPage = true;
    let cursor = null;

    while (hasNextPage) {
        const data = await queryModel(cursor, model);
        await pushToKafka(data, model, topic);

        hasNextPage = data[model].pageInfo.hasNextPage;
        cursor = data[model].pageInfo.endCursor;
    }
};

// Query and push data for each model
// 'linkIndex': 'postgres.public.kjzl6hvfrbw6c92114fj79ii6shyl8cbnsz5ol3v62s0uu3m78gy76gzaovpaiu',

const models = {
    'indexIndex': 'postgres.public.kjzl6hvfrbw6caw09g11y7vy1qza903xne35pi30xvmelvnvlfxy9tadwwkzzd6',
    'indexLinkIndex': 'postgres.public.kjzl6hvfrbw6c8a1u7qrk1xcz5oty0temwn2szbmhl8nfnw9tddljj4ue8wba68',
    'userIndexIndex': 'postgres.public.kjzl6hvfrbw6c9aw0xd4vlhqc5mx57f0y2xmm8xiyxzzj1abrizfyppup22r9ac',
    'profileIndex': 'postgres.public.kjzl6hvfrbw6ca52q3feusjpl2r49wv9x0odyd2zmaytyq8ddunud4243rvl3gm',
};

const go = async () => {
    for (const key of Object.keys(models)) {
        await paginateAndPush(key, models[key]);
    }
};


go()
