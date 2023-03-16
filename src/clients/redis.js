const { createClient } = require('redis');

if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()    
}


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

module.exports = RedisClient;