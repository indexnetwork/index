import dotenv from "dotenv";
import Moralis from "moralis";
import express from "express";

import Joi from "joi";
import * as ejv from "express-joi-validation";

import RedisClient from "../clients/redis.js";

import { createProxyMiddleware } from "http-proxy-middleware";

const app = express();

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const port = process.env.PORT || 3001;

const redis = RedisClient.getInstance();
const pubSubClient = RedisClient.getPubSubInstance();

import * as indexController from "../controllers/index.js";
import * as itemController from "../controllers/item.js";
import * as embeddingController from "../controllers/embedding.js";
import * as conversationController from "../controllers/conversation.js";
import * as didController from "../controllers/did.js";
import * as discoveryController from "../controllers/discovery.js";

import * as farcasterController from "../controllers/farcaster.js";

import * as litProtocol from "../controllers/lit-protocol.js";

import * as fileController from "../controllers/file.js";
import * as web2Controller from "../controllers/web2.js";

import * as composeDbController from "../controllers/composedb.js";

import * as zapierController from "../controllers/zapier.js";

import * as siteController from "../controllers/site.js";

import * as metaController from "../controllers/meta.js";

import * as modelController from "../controllers/model.js";

import {
  authenticateMiddleware,
  errorMiddleware,
  authCheckMiddleware,
} from "../middlewares/index.js";

import { setIndexedModelParams } from "../libs/composedb.js";

import {
  isImage,
  isPKPPublicKey,
  isCID,
  isDID,
  isStreamID,
} from "../types/validators.js";

app.use(/^\/(?!chroma).*/, express.json());

const validator = ejv.createValidator({
  passError: true,
});

// Authenticate
app.use(authenticateMiddleware);

const simpleRequestLogger = (proxyServer, options) => {
  proxyServer.on("proxyReq", (proxyReq, req, res) => {
    console.log(`[HPM] [${req.method}] ${req.url}`); // outputs: [HPM] GET /users
  });
};

// Chroma Proxy
app.use(
  "/chroma",
  createProxyMiddleware({
    target: process.env.CHROMA_URL,
    changeOrigin: true,
    plugins: [simpleRequestLogger],
  }),
);

// DIDs
app.get(
  "/dids/:did/indexes/:type?",
  validator.params(
    Joi.object({
      did: Joi.custom(isDID, "DID").required(),
      type: Joi.string().valid("own", "star").optional(),
    }),
  ),
  didController.getIndexes,
);

app.put(
  "/dids/:did/indexes/:indexId/:type",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      did: Joi.custom(isDID, "DID").required(),
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      type: Joi.string().valid("own", "star").required(),
    }),
  ),
  didController.addIndex,
);

app.delete(
  "/dids/:did/indexes/:indexId/:type",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      did: Joi.custom(isDID, "DID").required(),
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      type: Joi.string().valid("own", "star").required(),
    }),
  ),
  didController.removeIndex,
);

app.patch(
  "/profile",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      name: Joi.string().optional(),
      bio: Joi.string().empty(["", null]).optional(),
      avatar: Joi.custom(isCID, "Avatar").optional().allow(null),
    }).or("name", "bio", "avatar"),
  ),
  didController.createProfile,
);

app.get("/profile", authCheckMiddleware, didController.getProfileFromSession);

app.get(
  "/dids/:did/profile",
  validator.params(
    Joi.object({
      did: Joi.custom(isDID, "DID").required(),
    }),
  ),
  didController.getProfileByDID,
);

// Indexes
app.get(
  "/indexes/:id",
  validator.query(
    Joi.object({
      roles: Joi.boolean().default(false).optional(),
    }),
  ),
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  indexController.getIndexById,
);

app.post(
  "/indexes",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      title: Joi.string().required(),
      signerFunction: Joi.custom(isCID, "IPFS CID").optional(),
    }),
  ),
  indexController.createIndex,
);

app.patch(
  "/indexes/:id",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      title: Joi.string().optional(),
      signerFunction: Joi.custom(isCID, "IPFS CID").optional(),
    }).or("title", "signerFunction"),
  ),
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  indexController.updateIndex,
);

app.patch(
  "/indexes/:id/transfer",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      newOwner: Joi.custom(isDID, "DID").required(),
    }).or("newOwner"),
  ),
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  indexController.transferIndex,
);

app.delete(
  "/indexes/:id",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  indexController.deleteIndex,
);

// Items
app.get(
  "/indexes/:indexId/items",
  validator.query(
    Joi.object({
      query: Joi.string().min(1).optional(),
      cursor: Joi.string().optional(),
      limit: Joi.number().default(24),
    }),
  ),
  validator.params(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  itemController.listItems,
);

app.post(
  "/indexes/:indexId/items/:itemId",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
    }),
  ),
  itemController.addItem,
);

app.delete(
  "/indexes/:indexId/items/:itemId",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
    }),
  ),
  itemController.removeItem,
);

app.get(
  "/items/:itemId/indexes",
  validator.params(
    Joi.object({
      itemId: Joi.custom(isStreamID, "Item ID").required(),
    }),
  ),
  itemController.getIndexesByItemId,
);

app.get(
  "/embeddings",
  validator.query(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
      modelName: Joi.string().optional(),
      categories: Joi.array().items(Joi.string()).optional(),
      skip: Joi.number().integer().min(0).optional(),
      take: Joi.number().integer().min(1).optional(),
    }),
  ),
  embeddingController.listEmbeddings,
);

app.post(
  "/embeddings",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
      modelName: Joi.string().required(),
      category: Joi.string().required(),
      context: Joi.string().optional(),
      vector: Joi.array().items(Joi.number()).required(),
      description: Joi.string().required(),
    }),
  ),
  embeddingController.createEmbedding,
);

app.patch(
  "/embeddings",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
      modelName: Joi.string().required(),
      category: Joi.string().required(),
      context: Joi.string().optional(),
      vector: Joi.array().items(Joi.number()).required(),
      description: Joi.string().optional(),
    }),
  ),
  embeddingController.updateEmbedding,
);

app.delete(
  "/embeddings",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
      itemId: Joi.custom(isStreamID, "Stream ID").required(),
      modelName: Joi.string().required(),
      category: Joi.string().required(),
    }),
  ),
  embeddingController.deleteEmbedding,
);

// Discovery
app.post(
  "/discovery/search",
  validator.body(
    Joi.object({
      query: Joi.string().required(),
      indexIds: Joi.array().items(Joi.string()).required(),
      page: Joi.number().default(1),
      limit: Joi.number().default(24),
      filters: Joi.array().items(Joi.object()).optional(),
      sort: Joi.string().optional(),
      desc: Joi.bool().optional(),
    }),
  ),
  discoveryController.search,
);

app.post(
  "/discovery/chat",
  validator.body(
    Joi.object({
      id: Joi.string().required(),
      messages: Joi.array().required(),
      temperature: Joi.number().optional(),
      avg_log_prob: Joi.number().optional(),
      maxTokens: Joi.number().optional(),
      maxRetries: Joi.number().optional(),
      sources: Joi.array().items(Joi.string()).required(),
    }),
  ),
  discoveryController.chat,
);

app.post(
  "/discovery/questions",
  validator.body(
    Joi.object({
      sources: Joi.array().items(Joi.string()).required(),
    }),
  ),
  discoveryController.questions,
);

app.get(
  "/discovery/updates",
  validator.query(
    Joi.object({
      sources: Joi.array().items(Joi.string()).required(),
      query: Joi.string().min(1).optional(),
    }),
  ),
  discoveryController.updates,
);

app.post(
  "/web2/webpage",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      title: Joi.string().required(),
      favicon: Joi.string().optional(),
      url: Joi.string().uri().required(),
      content: Joi.string().required(),
    }),
  ),
  web2Controller.createWebPage,
);

app.get(
  "/web2/webpage/:id",
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "WebPage ID").required(),
    }),
  ),
  web2Controller.getWebPageById,
);

app.post(
  "/web2/webpage/crawl",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      title: Joi.string().optional(),
      favicon: Joi.string().optional(),
      url: Joi.string().uri().required(),
    }),
  ),
  web2Controller.crawlWebPage,
);

app.get(
  "/web2/webpage/metadata",
  validator.query(
    Joi.object({
      url: Joi.string().uri().required(),
    }),
  ),
  web2Controller.crawlMetadata,
);

app.get("/composedb/:modelId/:nodeId", composeDbController.getNodeById);

app.post(
  "/composedb/:modelId",
  authCheckMiddleware,
  composeDbController.createNode,
);

app.patch(
  "/composedb/:modelId/:nodeId",
  authCheckMiddleware,
  composeDbController.updateNode,
);

app.get(
  "/conversations",
  authCheckMiddleware,
  conversationController.listConversations,
);

app.get(
  "/conversations/:id",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  conversationController.getConversation,
);

app.get(
  "/conversations/:id/summary",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  conversationController.refreshSummary,
);

app.get(
  "/conversations/:id/updates",
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  validator.query(
    Joi.object({
      session: Joi.string().required(),
    }),
  ),
  conversationController.updates,
);

app.post(
  "/conversations",
  authCheckMiddleware,
  validator.body(
    Joi.object({
      sources: Joi.array().items(Joi.string()).required(),
      members: Joi.array().items(Joi.custom(isDID, "DID")).optional(),
      summary: Joi.string().optional(),
    }),
  ),
  conversationController.createConversation,
);

app.put(
  "/conversations/:id",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  validator.body(
    Joi.object({
      sources: Joi.array().items(Joi.string()).optional(),
      summary: Joi.string().optional(),
    }),
  ),
  conversationController.updateConversation,
);

app.delete(
  "/conversations/:id",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  conversationController.deleteConversation,
);

app.post(
  "/conversations/:conversationId/messages",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      conversationId: Joi.custom(isStreamID, "Conversation ID").required(),
    }),
  ),
  validator.body(
    Joi.object({
      role: Joi.string().required(),
      content: Joi.string().required(),
    }),
  ),
  conversationController.createMessage,
);

app.put(
  "/conversations/:conversationId/messages/:messageId",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      conversationId: Joi.custom(isStreamID, "Conversation ID").required(),
      messageId: Joi.custom(isStreamID, "Message ID").required(),
    }),
  ),
  validator.query(
    Joi.object({
      deleteAfter: Joi.boolean().optional(),
    }),
  ),
  validator.body(
    Joi.object({
      role: Joi.string().required(),
      content: Joi.string().required(),
    }),
  ),
  conversationController.updateMessage,
);

app.delete(
  "/conversations/:conversationId/messages/:messageId",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      conversationId: Joi.custom(isStreamID, "Conversation ID").required(),
      messageId: Joi.custom(isStreamID, "Message ID").required(),
    }),
  ),
  validator.query(
    Joi.object({
      deleteAfter: Joi.boolean().optional(),
    }),
  ),
  conversationController.deleteMessage,
);

//Todo refactor later.
app.post(
  "/zapier/index/:indexId/webpage",
  authCheckMiddleware,
  validator.params(
    Joi.object({
      indexId: Joi.custom(isStreamID, "Index ID").required(),
    }),
  ),
  validator.body(
    Joi.object({
      title: Joi.string().required(),
      favicon: Joi.string().optional(),
      url: Joi.string().uri().required(),
      content: Joi.string().optional(),
    }),
  ),
  zapierController.indexWebPage,
);
app.get("/zapier/auth", authCheckMiddleware, zapierController.authenticate);
app.get("/zapier/indexes", authCheckMiddleware, zapierController.indexes);

//Todo refactor later.
app.get("/lit_actions/:cid", litProtocol.getAction);
app.post(
  "/lit_actions/",
  validator.body(
    Joi.array().items(
      Joi.object({
        tag: Joi.string()
          .valid("apiKey", "creator", "semanticIndex")
          .required(),
        value: Joi.object().required(),
      }),
    ),
  ),
  litProtocol.postAction,
);

//Todo refactor later.
app.get(
  "/nft/:chainName/:tokenAddress",
  metaController.getCollectionMetadataHandler,
);
app.get(
  "/nft/:chainName/:tokenAddress/:tokenId",
  metaController.getNftMetadataHandler,
);
app.get("/ens/:ensName", metaController.getWalletByENSHandler);

app.post(
  "/profile/upload_avatar",
  isImage.single("file"),
  fileController.uploadAvatar,
);

app.post(
  "/site/subscribe",
  validator.body(
    Joi.object({
      email: Joi.string().email().required(),
    }),
  ),
  siteController.subscribe,
);

app.get("/model/info", modelController.info);
app.post(
  "/model/:id",
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Model ID").required(),
    }),
  ),
  authCheckMiddleware,
  modelController.deploy,
);

app.post(
  "/model",
  authCheckMiddleware,
  modelController.create,
);

app.delete(
  "/model/:id",
  validator.params(
    Joi.object({
      id: Joi.custom(isStreamID, "Model ID").required(),
    }),
  ),
  authCheckMiddleware,
  modelController.remove,
);

// Validators
app.use(errorMiddleware);

app.post("/farcaster/updates", farcasterController.createCast);

const start = async () => {
  console.log("Starting API ...", port);
  await redis.connect();
  await pubSubClient.connect();

  await setIndexedModelParams(app);

  await Moralis.start({
    apiKey: process.env.MORALIS_API_KEY,
  });

  app.listen(port, async () => {
    console.log(`API listening on port ${port}`);
  });
};
start();
