import dotenv from "dotenv";
import { Kafka, logLevel } from "kafkajs";
import { v4 as uuidv4 } from 'uuid';
import { processFarcasterEvent } from "../libs/farcaster.js";
import { fetchModelInfo } from "../utils/helpers.js";
import RedisClient from "../clients/redis.js";

dotenv.config();

const redis = RedisClient.getInstance();


const kafka = new Kafka({
  clientId: `neynar-webhook-consumer-${uuidv4()}`,
  brokers: process.env.NEYNAR_KAFKA_BROKERS.split(','),
  logLevel: logLevel.INFO,
  connectionTimeout: 3000,
  ssl: true,
  sasl: {
    mechanism: 'scram-sha-512',
    username: process.env.NEYNAR_KAFKA_USERNAME,
    password: process.env.NEYNAR_KAFKA_PASSWORD
  }
});

const consumer = kafka.consumer({
  groupId: process.env.NEYNAR_KAFKA_CONSUMER_GROUP_ID
});

export const startFarcasterConsumer = async (runtimeDefinition, modelFragments) => {
  try {
    console.log('Starting Farcaster consumer...');

    await consumer.connect();
    await consumer.subscribe({ topic: 'farcaster-mainnet-events', fromBeginning: false });

    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        //console.log('Received message from partition:', partition);
        try {
          const event = JSON.parse(message.value.toString());
          
          if (event.event_type === 'cast.created') {
            //console.log('Processing cast:', event.data.hash, 'from user:', event.data.author.fid);
            await processFarcasterEvent(event, runtimeDefinition, modelFragments);
          } else {
            // console.log('Skipping non-cast event:', event.event_type);
          }
        } catch (error) {
          console.error('Error processing message:', error);
          console.error('Raw message value:', message.value?.toString());
        }
      },
    });

    console.log('Farcaster consumer started successfully');
  } catch (error) {
    console.error('Error starting Farcaster consumer:', error);
    throw error;
  }
};

// Add graceful shutdown
const errorTypes = ['unhandledRejection', 'uncaughtException'];
const signalTraps = ['SIGTERM', 'SIGINT', 'SIGUSR2'];

errorTypes.forEach(type => {
  process.on(type, async () => {
    try {
      console.log(`process.on ${type}`);
      await consumer.disconnect();
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach(type => {
  process.once(type, async () => {
    try {
      await consumer.disconnect();
    } finally {
      process.kill(process.pid, type);
    }
  });
});
