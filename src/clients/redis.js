import { createClient } from 'redis';

class RedisClient {

  constructor() {
      throw new Error('Use Singleton.getInstance()');

  }

  static getInstance() {
      if (!RedisClient.client) {
        RedisClient.client = createClient({
          url: process.env.REDIS_CONNECTION_STRING
        });
      }
      return RedisClient.client;
  }

}

export default RedisClient;
