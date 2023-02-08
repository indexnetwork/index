if(process.env.NODE_ENV !== 'production'){
    require('dotenv').config()    
}

const RedisClient = require('./clients/redis.js');
const redis = RedisClient.getInstance();

const search = require('./controllers/search.js')
const crawl = require('./controllers/crawl.js')
const { getQueue } = require('./controllers/crawl-content.js')
const express = require('express')
const cors = require('cors')
const app = express()
const port = 3000


app.use(express.json())

//app.use(cors())

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


const crawlSchema = Joi.object({
  url: Joi.string().uri().required(),
})

app.get('/crawl/metadata', validator.query(crawlSchema), crawl.metadata)

app.use((err, req, res, next) => {
  if (err && err.error && err.error.isJoi) {
    // we had a joi error, let's return a custom 400 json response
    res.status(400).json({
      type: err.type, // will be "query" here, but could be "headers", "body", or "params"
      message: err.error.toString()
    });
  } else {
    // pass on to another error handler
    next(err);
  }
});

const run = async () => {
  await redis.connect()
  await app.set('queue', await getQueue())
  await app.listen(port, async () => {
    
    console.log(`Search service listening on port ${port}`)
  })

}


run()