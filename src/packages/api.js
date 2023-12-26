import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
  dotenv.config()
}
import Moralis from 'moralis';
import RedisClient  from '../clients/redis.js';
const redis = RedisClient.getInstance();

import * as search from '../services/elasticsearch.js';
import * as composedb from '../services/composedb.js';
import * as litActions from '../services/lit_actions.js';
import * as moralis from '../libs/moralis.js';
import * as infura from '../libs/infura.js';

import Joi from 'joi';
import * as ejv from 'express-joi-validation';

import IPFSClient from '../clients/ipfs.js';

import multer from 'multer';
import mailchimp from '@mailchimp/mailchimp_marketing';

const multerUpload = multer({
  fileFilter: function (req, file, cb) {
    // Check if the file is an image
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Not an image. Please upload an image file.'), false);
    }
  }
});



import { getQueue, getMetadata } from '../libs/crawl.js'
import express from 'express';
import {getWalletByENSHandler} from "../libs/infura.js";
import axios from "axios";

const app = express()
const port = process.env.PORT || 3001;

app.use(express.json())

const validator = ejv.createValidator({
  passError: true
})

// DIDs
app.post('/dids/:id/indexes', validator.body(Joi.object({
  type: Joi.string().min(1).optional(), //TODO Enumize
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), didService.getIndexes)

// Indexes
app.get('/indexes/:id', validator.params(Joi.object({
  id: Joi.string().required()
})), indexService.getIndexById)

app.post('/indexes', validator.body(Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required()
})), indexService.createIndex)

app.put('/indexes/:id', validator.body(Joi.object({
  name: Joi.string(),
  description: Joi.string()
})), validator.params(Joi.object({
  id: Joi.string().required()
})), indexService.updateIndex)

app.delete('/indexes/:id', validator.params(Joi.object({
  id: Joi.string().required()
})), indexService.deleteIndex)

// Items
app.get('/items', validator.query(Joi.object({
  query: Joi.string().min(1).optional(),
  indexId: Joi.string().required(),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), indexService.listItems)

app.post('/items', validator.params(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required()
})), indexService.createItem)

app.delete('/items', validator.params(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required(),
})), indexService.deleteItem)


app.get('/embeddings', validator.query(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required(),
  modelName: Joi.string().optional(),
  category: Joi.string().optional(),
  skip: Joi.number().integer().min(0).optional(),
  take: Joi.number().integer().min(1).optional()
})), embeddingService.listEmbeddings);

app.post('/embeddings', validator.body(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required(),
  vector: Joi.array().items(Joi.number()).required(),
  modelName: Joi.string().required(),
  contextDescription: Joi.string().optional(),
  category: Joi.string().optional()
})), embeddingService.createEmbedding);

app.put('/embeddings', validator.body(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required(),
  vector: Joi.array().items(Joi.number()).required(),
  modelName: Joi.string().required(),
  contextDescription: Joi.string().optional(),
  category: Joi.string().optional()
})), embeddingService.updateEmbedding);

app.delete('/embeddings', validator.params(Joi.object({
  indexId: Joi.string().required(),
  itemId: Joi.string().required(),
  category: Joi.string().required()
})), embeddingService.deleteEmbedding);


app.get('/indexes/:id', composedb.get_index)
app.get('/index_link/:id', composedb.get_index_link)

app.post('/search/user_indexes', validator.body(Joi.object({
  did: Joi.string().required(),
  index_id: Joi.string().min(40).required(),
})), search.user_index) // TODO Remove

app.post('/chat_stream', validator.body(Joi.object({
  id: Joi.string().required(),
  did: Joi.string().optional(),
  indexes: Joi.array().items(Joi.string()).optional(),
  messages: Joi.array().required(),
})), async (req, res) => {
  try{
    let resp = await axios.post(`${process.env.LLM_INDEXER_HOST}/chat_stream`, req.body, {
        responseType: 'stream'
    })
    res.set(resp.headers);
    resp.data.pipe(res);
  } catch (error) {
    // Handle the exception
    console.error('An error occurred:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }

})
app.post('/zapier/index_link', composedb.zapier_index_link);
app.get('/zapier/auth', composedb.zapier_auth);


app.post('/webhook/moralis/pkp', moralis.indexPKP) //Unavailable for chronicle. TODO Before mainnet.

app.get('/lit_actions/:cid', litActions.get_action);
app.post('/lit_actions', litActions.post_action);

app.get('/nft/:chainName/:tokenAddress', infura.getCollectionMetadataHandler);
app.get('/nft/:chainName/:tokenAddress/:tokenId', infura.getNftMetadataHandler);
app.get('/ens/:ensName', infura.getWalletByENSHandler);

const crawlSchema = Joi.object({
  url: Joi.string().uri().required(),
})

app.get('/crawl/metadata', validator.query(crawlSchema), async (req, res) => {

    let { url } = req.query;

    let response = await getMetadata(url)

    // TODO Move this to link listener.
    req.app.get('queue').addRequests([{url, uniqueKey: Math.random().toString()}])

    res.json(response)

})



app.post('/upload_avatar', multerUpload.single('file'), async (req, res) => {
  try {
    // Get the uploaded file from the request
    const file = req.file;

    // Add the file to IPFS
    const addedFile = await IPFSClient.add({ path: file.originalname, content: file.buffer });

    // Respond with the IPFS hash
    res.json({ cid: addedFile.cid.toString() });
  } catch (error) {
    console.error(error);
    res.status(500).send('An error occurred while uploading the file to IPFS.');
  }
});

mailchimp.setConfig({
  apiKey: process.env.MAILCHIMP_API_KEY,
  server: "us8"
});


app.post("/subscribe", validator.body(Joi.object({
  email: Joi.string().email().required(),
})), async (req, res) => {
  const { email } = req.body;
  try {
    const response = await mailchimp.lists.addListMember(process.env.MAILCHIMP_LIST_ID, {
      email_address: email,
      status: "subscribed"
    });
    res.json({ success: true, message: "Subscription successful", data: response });
  } catch (error) {
    console.error('Mailchimp subscription error:', error);
    if (error.response && error.response.body.title === "Member Exists") {
      res.status(400).json({ success: false, message: "This email is already subscribed." });
    } else if (error.response && error.response.body.title === "Invalid Resource") {
      res.status(400).json({ success: false, message: "Invalid email address." });
    } else {
      const status = error.response ? error.response.status : 500;
      const message = error.response ? error.response.body.detail : "An error occurred while subscribing.";
      res.status(status).json({ success: false, message });
    }
  }
});


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
  await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
  });
  if(process.env.NODE_ENV !== 'development'){
    await app.set('queue', await getQueue())
  }
  await app.listen(port, async () => {
    console.log(`Search service listening on port ${port}`)
  })

}


start()
