import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
  dotenv.config()
}

import express from 'express';
import axios from "axios";
import Joi from 'joi';
import * as ejv from 'express-joi-validation';

const app = express()
const port = process.env.PORT || 3001;

import RedisClient  from '../clients/redis.js';
const redis = RedisClient.getInstance();


import * as indexController from '../controllers/index.js';
import * as itemController from '../controllers/item.js';
import * as embeddingController from '../controllers/embedding.js';
import * as didController from '../controllers/did.js';

import * as fileController from '../controllers/file.js';
import * as web2Controller from '../controllers/web2.js';

import * as siteController from '../controllers/site.js';

import * as composedb from '../services/composedb.js';
import * as litActions from '../services/lit_actions.js';
import * as infura from '../libs/infura.js';

import { getQueue, getMetadata } from '../libs/crawl.js'

import {
  authenticateMiddleware,
  errorMiddleware,
  privateRouteMiddleware
} from "../middlewares/index.js";


import {isImage, isPKPPublicKey, isCID, isDID, isStreamID} from "../utils/validators.js";

app.use(express.json())

const validator = ejv.createValidator({
  passError: true
})

// Validators
app.use(errorMiddleware);

// Authenticate
app.use(authenticateMiddleware);

// DIDs
app.get('/dids/:id/indexes',validator.query(Joi.object({
  type: Joi.string().valid('starred', 'owner').optional(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.getIndexes)

app.put('/dids/:id/indexes', privateRouteMiddleware, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.addIndex)

app.delete('/dids/:id/indexes',privateRouteMiddleware, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.removeIndex)

// Indexes
app.get('/indexes/:id', validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.getIndexById)

app.post('/indexes', privateRouteMiddleware, validator.body(Joi.object({
  title: Joi.string().required(),
  signerPublicKey: Joi.custom(isPKPPublicKey, "LIT PKP Public Key").optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
})), indexController.createIndex)

app.patch('/indexes/:id', privateRouteMiddleware, validator.body(Joi.object({
  title: Joi.string().optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
}).or('title', 'signerFunction')), validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.updateIndex)

app.delete('/indexes/:id', privateRouteMiddleware, validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.deleteIndex)

// Items
app.get('/items', validator.query(Joi.object({
  query: Joi.string().min(1).optional(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), itemController.listItems)

app.post('/items', privateRouteMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
})), itemController.addItem)

app.delete('/items', privateRouteMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
})), itemController.removeItem)

app.get('/embeddings', validator.query(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().optional(),
  categories: Joi.array().items(Joi.string()).optional(),
  skip: Joi.number().integer().min(0).optional(),
  take: Joi.number().integer().min(1).optional()
})), embeddingController.listEmbeddings);

app.post('/embeddings', privateRouteMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().required(),
  vector: Joi.array().items(Joi.number()).required(),
  context: Joi.string().optional(),
  description: Joi.string().required(),
  category: Joi.string().optional()
})), embeddingController.createEmbedding);

app.patch('/embeddings', privateRouteMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  vector: Joi.array().items(Joi.number()).optional(),
  modelName: Joi.string().required().optional(),
  description: Joi.string().optional(),
  category: Joi.string().optional()
})), embeddingController.updateEmbedding);

app.delete('/embeddings', privateRouteMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  category: Joi.string().required()
})), embeddingController.deleteEmbedding);

app.post('/web2-migrate', privateRouteMiddleware, validator.body(Joi.object({
  url: Joi.string().required(),
  modelId: Joi.string().required(),
  context: Joi.string().optional()
})), web2Controller.);


app.post('/chat_stream', validator.body(Joi.object({
  id: Joi.string().required(),
  messages: Joi.array().required(),
  did: Joi.string().optional(),
  type: Joi.when('did', {
    is: Joi.exist(),
    then: Joi.string().valid('starred', 'owner').optional(),
    otherwise: Joi.forbidden()
  }),
  indexes: Joi.array().items(Joi.string()).optional(),
}).or('did', 'indexes')), async (req, res) => {
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


//Todo refactor later.
app.post('/zapier/index_link', composedb.zapier_index_link);
app.get('/zapier/auth', composedb.zapier_auth);


app.get('/lit_actions/:cid', litActions.get_action);
app.post('/lit_actions', litActions.post_action);

app.get('/nft/:chainName/:tokenAddress', infura.getCollectionMetadataHandler);
app.get('/nft/:chainName/:tokenAddress/:tokenId', infura.getNftMetadataHandler);
app.get('/ens/:ensName', infura.getWalletByENSHandler);


app.get('/crawl/metadata', validator.query(Joi.object({
  url: Joi.string().uri().required(),
})), async (req, res) => {

    let { url } = req.query;

    let response = await getMetadata(url)

    // TODO Move this to link listener.
    req.app.get('queue').addRequests([{url, uniqueKey: Math.random().toString()}])

    res.json(response)

})

app.post('/upload_avatar', isImage.single('file'), fileController.uploadAvatar);




app.post("/subscribe", validator.body(Joi.object({
  email: Joi.string().email().required(),
})), siteController.subscribe);



const start = async () => {

  await redis.connect()
  /*await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
  });
   */
  if(process.env.NODE_ENV !== 'development'){
    // await app.set('queue', await getQueue())
  }
  await app.listen(port, async () => {
    console.log(`Search service listening on port ${port}`)
  })

}


start()
