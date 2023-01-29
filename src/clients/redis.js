const { createClient } = require('redis');

if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()    
}


class RedisClient {

  constructor() {
      if (!RedisClient.client) {
          RedisClient.client = createClient({
              url: process.env.REDIS_CONNECTION_STRING
          });
          RedisClient.client.on('error', err => console.log('Redis Client Error', err));
      }
  }

  getInstance() {
      return RedisClient.client;
  }

}

module.exports = RedisClient;