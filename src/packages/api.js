if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()
}

const RedisClient = require('../clients/redis.js');
const redis = RedisClient.getInstance();

const search = require('../services/elasticsearch.js')
const composedb = require('../services/composedb.js')

const moralis = require('../libs/moralis.js')

const { getQueue, getMetadata } = require('../libs/crawl.js')

const express = require('express')
const cors = require('cors')
const app = express()
const port = process.env.PORT || 3000;

app.use(express.json())

const Joi = require('joi')
const validator = require('express-joi-validation').createValidator({
  passError: true
})

const didSearchSchema = Joi.object({
  did: Joi.string().required(),
  type: Joi.string().min(1).default(false),
  search: Joi.string().min(1).default(false),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
  links_size: Joi.number().max(100)
})

const indexSearchSchema = Joi.object({
  index_ids: Joi.array().items(Joi.string()).min(1).required(),
  search: Joi.string().min(1).default(false),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
  links_size: Joi.number().max(100)
})


const linkSearchSchema = Joi.object({
  index_id: Joi.string().required(),
  search: Joi.string().min(1).default(false),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})

const userIndexSchema = Joi.object({
  did: Joi.string().required(),
  index_id: Joi.string().min(40).required(),
})

app.post('/search/did', validator.body(didSearchSchema), search.did)
app.post('/search/indexes', validator.body(indexSearchSchema), search.index)
app.post('/search/links', validator.body(linkSearchSchema), search.link)
app.post('/search/user_indexes', validator.body(userIndexSchema), search.user_index)

app.get('/indexes/:id', composedb.get_index)

app.post('/index/pkp', moralis.indexPKP)



const crawlSchema = Joi.object({
  url: Joi.string().uri().required(),
})

app.get('/crawl/metadata', validator.query(crawlSchema), async (req, res) => {

    let { url } = req.query;

    let response = await getMetadata(url)
    req.app.get('queue').addRequests([{url, uniqueKey: Math.random().toString()}])
    res.json(response)

})



app.use((err, req, res, next) => {
  if (err && err.error && err.error.isJoi) {
    res.status(400).json({
      type: err.type,
      message: err.error.toString()
    });
  } else {
    next(err);
  }
});

const start = async () => {
  await redis.connect()
  await app.set('queue', await getQueue())
  await app.listen(port, async () => {

    console.log(`Search service listening on port ${port}`)
  })

}


start()
