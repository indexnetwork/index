import dotenv from 'dotenv'
dotenv.config()

import pkg from 'pg';
const { Pool } = pkg;
import { Kafka } from 'kafkajs';

// Kafka setup
const kafka = new Kafka({
    clientId: 'api',
    brokers: [process.env.KAFKA_HOST],
});
const producer = kafka.producer();

// PostgreSQL setup
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    port: process.env.POSTGRES_PORT,
});

const queryPostgres = async (query, values) => {
    const client = await pool.connect();
    try {
        const res = await client.query(query, values);
        return res.rows;
    } finally {
        client.release();
    }
};

const pushToKafka = async (data, topic) => {
    for (const row of data) {
        await producer.send({
            topic,
            messages: [{ value: JSON.stringify({stream_id: row.stream_id, "__op": "c"}) }],
        });
    }
};

const go = async () => {
    await producer.connect();

    const pageSize = 100;

    const models = [
        'kjzl6hvfrbw6caw09g11y7vy1qza903xne35pi30xvmelvnvlfxy9tadwwkzzd6',
        'kjzl6hvfrbw6c8a1u7qrk1xcz5oty0temwn2szbmhl8nfnw9tddljj4ue8wba68',
        'kjzl6hvfrbw6c9aw0xd4vlhqc5mx57f0y2xmm8xiyxzzj1abrizfyppup22r9ac',
        'kjzl6hvfrbw6ca52q3feusjpl2r49wv9x0odyd2zmaytyq8ddunud4243rvl3gm'
    ];


    for (const model  of models) {

        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const query = `
        SELECT * FROM ${model}
        LIMIT $1 OFFSET $2
      `;
            const values = [pageSize, offset];
            const data = await queryPostgres(query, values);

            if (data.length > 0) {
                console.log(data.length)
                pushToKafka(data, 'postgres.public.' + model);
                offset += pageSize;
            } else {
                hasMore = false;
            }
        }
    }

    setTimeout(() => {
        console.log('Finished, waiting...');
    }, 10000);
    //await producer.disconnect();
};

go();

