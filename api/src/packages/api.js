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

import * as litProtocol from '../controllers/lit-protocol.js';

import * as fileController from '../controllers/file.js';
import * as web2Controller from '../controllers/web2.js';
import * as zapierController from '../controllers/zapier.js';

import * as siteController from '../controllers/site.js';

import * as infuraController from '../controllers/infura.js';

import {
  authenticateMiddleware,
  errorMiddleware, authCheckMiddleware
} from "../middlewares/index.js";


import { isImage, isPKPPublicKey, isCID, isDID, isStreamID } from "../types/validators.js";
import {ItemService} from "../services/item.js";

app.use(express.json())

const validator = ejv.createValidator({
  passError: true
})

// Authenticate
app.use(authenticateMiddleware);

// DIDs
app.get('/dids/:id/indexes',validator.query(Joi.object({
  type: Joi.string().valid('starred', 'owner').optional(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.getIndexes)

app.put('/dids/:id/indexes', authCheckMiddleware, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.addIndex)

app.delete('/dids/:id/indexes',authCheckMiddleware, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.removeIndex)

app.patch('/dids/:id/profile', authCheckMiddleware, validator.body(Joi.object({
  name: Joi.string().optional(),
  bio: Joi.string().optional(),
  avatar: Joi.custom(isCID, "Avatar").optional().allow(null),
}).or('name', 'bio', 'avatar')), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.createProfile)

app.get('/dids/:id/profile', validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.getProfile)

// Indexes
app.get('/indexes/:id', validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.getIndexById)

app.post('/indexes', authCheckMiddleware, validator.body(Joi.object({
  title: Joi.string().required(),
  signerPublicKey: Joi.custom(isPKPPublicKey, "LIT PKP Public Key").optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
})), indexController.createIndex)

app.patch('/indexes/:id', authCheckMiddleware, validator.body(Joi.object({
  title: Joi.string().optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
}).or('title', 'signerFunction')), validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.updateIndex)

app.delete('/indexes/:id', authCheckMiddleware, validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.deleteIndex)

// Items
app.get('/items', validator.query(Joi.object({
  query: Joi.string().min(1).optional(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), itemController.listItems)

app.post('/items', authCheckMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
})), itemController.addItem)

app.delete('/items', authCheckMiddleware, validator.body(Joi.object({
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

app.post('/embeddings', authCheckMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().required(),
  category: Joi.string().required(),
  context: Joi.string().optional(),
  vector: Joi.array().items(Joi.number()).required(),
  description: Joi.string().required()
})), embeddingController.createEmbedding);

app.patch('/embeddings', authCheckMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().required(),
  category: Joi.string().required(),
  context: Joi.string().optional(),
  vector: Joi.array().items(Joi.number()).required(),
  description: Joi.string().optional()
})), embeddingController.updateEmbedding);

app.delete('/embeddings', authCheckMiddleware, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().required(),
  category: Joi.string().required()
})), embeddingController.deleteEmbedding);

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

app.post('/web2/webpage', authCheckMiddleware,  validator.body(Joi.object({
  title: Joi.string().required(),
  favicon: Joi.string().optional(),
  url: Joi.string().uri().required(),
  content: Joi.string().required(),
})), web2Controller.createWebPage)

app.post('/web2/webpage/crawl', authCheckMiddleware, validator.body(Joi.object({
  title: Joi.string().required(),
  favicon: Joi.string().optional(),
  url: Joi.string().uri().required(),
})), web2Controller.crawlWebPage)

app.get('/web2/webpage/metadata', validator.query(Joi.object({
  url: Joi.string().uri().required(),
})), web2Controller.crawlMetadata)


//Todo refactor later.
app.post('/zapier/index_link', zapierController.indexLink);
app.get('/zapier/auth', zapierController.authenticate);

//Todo refactor later.
app.get('/lit_actions/:cid', litProtocol.getAction);
app.post('/lit_actions', litProtocol.postAction);

//Todo refactor later.
app.get('/nft/:chainName/:tokenAddress', infuraController.getCollectionMetadataHandler);
app.get('/nft/:chainName/:tokenAddress/:tokenId', infuraController.getNftMetadataHandler);
app.get('/ens/:ensName', infuraController.getWalletByENSHandler);

app.post('/site/upload_avatar', isImage.single('file'), fileController.uploadAvatar);

app.post("/site/subscribe", validator.body(Joi.object({
  email: Joi.string().email().required(),
})), siteController.subscribe);

app.get("/site/faucet", validator.query(Joi.object({
  address: Joi.string().regex(/^0x[a-fA-F0-9]{40}$/).required(),
})), siteController.faucet);


// Validators
app.use(errorMiddleware);

const start = async () => {

  await redis.connect()

  await app.listen(port, async () => {
    console.log(`Search service listening on port ${port}`)
  })

}

start()
