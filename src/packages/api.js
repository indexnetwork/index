import dotenv from 'dotenv'
if(process.env.NODE_ENV !== 'production'){
  dotenv.config()
}
import Moralis from 'moralis';
//import RedisClient  from '../clients/redis.js';
//const redis = RedisClient.getInstance();

import * as search from '../services/elasticsearch.js';

import * as indexController from '../controllers/index.js';
import * as didController from '../controllers/did.js';
import * as helperService from '../services/helper.js';

import * as composedb from '../services/composedb.js';
import * as litActions from '../services/lit_actions.js';
import * as moralis from '../libs/moralis.js';
import * as infura from '../libs/infura.js';

import Joi from 'joi';
import * as ejv from 'express-joi-validation';

import { DIDSession } from 'did-session'
import { StreamID } from '@ceramicnetwork/streamid';
import { CID } from 'multiformats/cid'
import { ethers } from "ethers";

import { DID } from 'dids'
import KeyResolver from 'key-did-resolver'


const isStreamID = (value, helpers) => {
  try {
    return StreamID.fromString(value).toString();
  } catch (e) {
    return helpers.message('Invalid Stream ID');
  }
};

const isDID = (value, helpers) => {
  try {
    const did = new DID({ resolver: KeyResolver.getResolver() })
    return value
  } catch (e) {
    return helpers.message('Invalid Stream ID');
  }
};

const isCID = (value, helpers) => {
  try {
    return CID.parse(value).toString();
  } catch (e) {
    return helpers.message('Invalid CID');
  }
};

const isPKPPublicKey = (value, helpers) => {
  try {
    ethers.computeAddress(value);
    return value;
  } catch (e) {
    return helpers.message('Invalid Pkp Public Key');
  }
};


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
import {index} from "../services/elasticsearch.js";

const app = express()
const port = process.env.PORT || 3001;

app.use(express.json())

const validator = ejv.createValidator({
  passError: true
})

// Authenticate
app.use( async (req, res, next) => {
  try{

    const authHeader = req.headers.authorization;
    if(authHeader){
      const session = await DIDSession.fromSession(authHeader.split(' ')[1]);
      await session.did.authenticate()
      req.user = session.did;

      console.log("Authenticated", req.user)
    }

  } catch (e){
    console.log("Public");
  }

  next();
});
const privateRoute = (req, res, next) => {
  if(!req.user){
    return res.status(401).send('Unauthorized');
  }
  next();
}

// DIDs
app.get('/dids/:id/indexes',validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').optional(),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.getIndexes)

app.put('/dids/:id/indexes', privateRoute, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.addIndex)

app.delete('/dids/:id/indexes',privateRoute, validator.body(Joi.object({
  type: Joi.string().valid('starred', 'owner').required(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
})), validator.params(Joi.object({
  id: Joi.custom(isDID, "DID").required(),
})), didController.removeIndex)

// Indexes
app.get('/indexes/:id', validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.getIndexById)

app.post('/indexes', privateRoute, validator.body(Joi.object({
  title: Joi.string().required(),
  signerPublicKey: Joi.custom(isPKPPublicKey, "LIT PKP Public Key").optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
})), indexController.createIndex)

app.patch('/indexes/:id', privateRoute, validator.body(Joi.object({
  title: Joi.string().optional(),
  signerFunction: Joi.custom(isCID, "IPFS CID").optional()
}).or('title', 'signerFunction')), validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.updateIndex)

app.delete('/indexes/:id', privateRoute, validator.params(Joi.object({
  id: Joi.custom(isStreamID, "Index ID").required(),
})), indexController.deleteIndex)

// Items
app.get('/items', validator.query(Joi.object({
  query: Joi.string().min(1).optional(),
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  skip: Joi.number().default(0),
  take: Joi.number().default(10),
})), indexController.listItems)

app.post('/items', privateRoute, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
})), indexController.addItem)

app.delete('/items', privateRoute, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
})), indexController.removeItem)

app.get('/embeddings', validator.query(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().optional(),
  categories: Joi.array().items(Joi.string()).optional(),
  skip: Joi.number().integer().min(0).optional(),
  take: Joi.number().integer().min(1).optional()
})), indexController.listEmbeddings);

app.post('/embeddings', privateRoute, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  modelName: Joi.string().required(),
  vector: Joi.array().items(Joi.number()).required(),
  context: Joi.string().optional(),
  description: Joi.string().required(),
  category: Joi.string().optional()
})), indexController.createEmbedding);

app.patch('/embeddings', privateRoute, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  vector: Joi.array().items(Joi.number()).optional(),
  modelName: Joi.string().required().optional(),
  description: Joi.string().optional(),
  category: Joi.string().optional()
})), indexController.updateEmbedding);

app.delete('/embeddings', privateRoute, validator.body(Joi.object({
  indexId: Joi.custom(isStreamID, "Index ID").required(),
  itemId: Joi.custom(isStreamID, "Stream ID").required(),
  category: Joi.string().required()
})), indexController.deleteEmbedding);

app.post('/web2-migrate', privateRoute, validator.body(Joi.object({
  url: Joi.string().required(),
  modelId: Joi.string().required(),
  context: Joi.string().optional()
})), helperService.migrateWeb2);


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

  //await redis.connect()
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
