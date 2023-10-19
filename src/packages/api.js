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


const chatStreamSchema = Joi.object({
    id: Joi.string().required(),
    did: Joi.string().optional(),
    indexes: Joi.array().items(Joi.string()).optional(),
    messages: Joi.array().required(),
})

const zapierTestLoginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
})


app.post('/search/did', validator.body(didSearchSchema), search.did)
app.post('/search/indexes', validator.body(indexSearchSchema), search.index)
app.post('/search/links', validator.body(linkSearchSchema), search.link)
app.post('/search/user_indexes', validator.body(userIndexSchema), search.user_index)

app.post('/chat_stream', validator.body(chatStreamSchema), async (req, res) => {
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
app.post('/zapier/testlogin', validator.body(zapierTestLoginSchema), async (req, res) => {

  let { email, password } = req.body;
  if(email === process.env.ZAPIER_TEST_EMAIL && password === process.env.ZAPIER_TEST_PASSWORD){
    return res.json({success: true, sessionData: process.env.ZAPIER_TEST_SESSION})
  }else{
    return res.json({error: 'Invalid credentials'})
  }

});

app.get('/indexes/:id', composedb.get_index)
app.get('/index_link/:id', composedb.get_index_link)

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
