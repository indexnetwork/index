import dotenv from "dotenv";
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

import { createClient } from "redis";

class RedisClient {
  constructor() {
    throw new Error("Use Singleton.getInstance()");
  }

  static getInstance() {
    if (!RedisClient.client) {
      RedisClient.client = createClient({
        url: process.env.REDIS_CONNECTION_STRING,
      });
    }
    return RedisClient.client;
  }

  static getPubSubInstance() {
    if (!RedisClient.pubsub) {
      RedisClient.pubsub = createClient({
        url: process.env.REDIS_CONNECTION_STRING,
      });
    }
    return RedisClient.pubsub;
  }
}

export default RedisClient;
