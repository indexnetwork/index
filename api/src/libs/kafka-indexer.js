import dotenv from 'dotenv'
import axios from 'axios'
import { ItemService } from "../services/item.js";
import { WebPageService } from "../services/webpage.js";
import { EmbeddingService } from "../services/embedding.js";
import { getPKPSession, getPKPSessionForIndexer } from "../libs/lit/index.js";
import RedisClient from '../clients/redis.js';
import e from 'express';

import Logger from '../utils/logger.js';


const logger = Logger.getInstance();

const redis = RedisClient.getInstance();

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

// Index Item (C)
export const createIndexItemEvent = async (id) => {

    logger.info("Step [0]: createIndexItemEvent trigger for id:", id)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        const indexSession = await getPKPSessionForIndexer(indexItem.index);
        await indexSession.did.authenticate();

        Logger.debug("Step [0]: Indexer session created for index:", indexItem.index.id)

        if (indexItem.item.content) {

            const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/embeddings`, {
                content: indexItem.item.content
            })
    
            const embeddingService = new EmbeddingService().setSession(indexSession)
            const embedding = await embeddingService.createEmbedding({
                "indexId": indexItem.indexId,
                "itemId": indexItem.itemId,
                "modelName": embeddingResponse.data.model,
                "category": "document",
                "vector": embeddingResponse.data.vector,
                "description": "Default document embeddings",
            });
    
            logger.info("Step [0]: EmbeddingEvent trigger successfull for id:", embedding.id);
        }

        logger.warn('Step [0]: No content found, createIndexItem event incomplete')

    } catch (e) {
        logger.error(`Step [0]: Indexer createIndexItemEvent error: ${e.message}`);
    }

}

// Index item (UD)
export const updateIndexItemEvent = async (id) => {

    logger.info(`Step [1]: UpdateIndexItemEvent trigger for id: ${id}`)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        const indexSession = await getPKPSessionForIndexer(indexItem.index);
        await indexSession.did.authenticate();

        logger.info(`Step [1]: Indexer session created for index: ${indexItem.index.id}`)

        const updateURL = `${process.env.LLM_INDEXER_HOST}/indexer/item?indexId=${indexItem.indexId}&indexItemId=${indexItem.itemId}`
        
        if (indexItem.deletedAt !== null) { 

            logger.info(`Step [1]: IndexItem DeleteEvent trigger for id: ${id}`)

            const deleteResponse = await axios.delete(updateURL);

            // logger.info("IndexItem Delete Response", deleteResponse)
            
            if (deleteResponse.status === 200) {
                logger.info(`Step [1]: IndexItem Delete Success for id: ${id}`)
            } else {
                logger.debug(`Step [1]: IndexItem Delete Failed for id: ${id}`)
            }
            
        } else {

            logger.info(`Step [1]: IndexItem UpdateEvent trigger for id: ${id}`)

            const updateResponse = await axios.put(
                `${process.env.LLM_INDEXER_HOST}/indexer/index`, 
                {
                    embedding: indexItem.embedding,
                    metadata: {

                        indexTitle: embedding.index.title,
                        indexCreatedAt: embedding.index.createdAt,
                        indexUpdatedAt: embedding.index.updatedAt,
                        indexDeletedAt: embedding.index.deletedAt,
                        indexOwnerDID: embedding.index.ownerDID.id,
                
                        webPageId: embedding.item.id,
                        webPageTitle: embedding.item.title,
                        webPageUrl: embedding.item.url,
                        webPageContent: embedding.item.content,
                        webPageCreatedAt: embedding.item.createdAt,
                        webPageUpdatedAt: embedding.item.updatedAt,
                        webPageDeletedAt: embedding.item.deletedAt,
                    },
                });
    
            if (updateResponse.status === 200) {
                logger.info(`Step [1]: IndexItem Update Success for id: ${id}`)
            } else {
                logger.warn(`Step [1]: IndexItem Update Failed for id: ${id}`)
            } 
        }

    } catch (e) {
        logger.error(`Step [1]: Indexer updateIndexItemEvent with error: ${e.message}`);
    }
}

export const updateWebPageEvent = async (id) => {

    logger.info(`Step [2]: `)

    const webPage = new WebPageService()
    const webPageItem = await webPage.getWebPageById(id, false);

    try {
        
        Logger.info("Step [2]: UpdateWebPageEvent trigger for id:", id)

        if (webPageItem && webPageItem.content) {

            const itemSession = new ItemService()
            const indexItems = await itemSession.getIndexesByItemId(webPageItem.id, null, 24, false);
            
            for (let indexItem of indexItems.items) {
                
                logger.info("Step [2]: IndexItem UpdateEvent trigger for id:", indexItem.id)

                const indexSession = await getPKPSessionForIndexer(indexItem.index);

                const embeddingService = new EmbeddingService().setSession(indexSession)

                const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/embeddings`, {
                    content: webPageItem.content
                })

                logger.info("Step [2]: Embedding created for indexItem:", indexItem.id, "with vector:", embeddingResponse.data.vector?.length)
                
                const embedding = await embeddingService.createEmbedding({
                    "indexId": indexItem.index.id,
                    "itemId": indexItem.item.id,
                    "modelName": embeddingResponse.data.model,
                    "category": "document",
                    "vector": embeddingResponse.data.vector,
                    "description": "Default document embeddings",
                });

        
                logger.info("Step [2]: EmbeddingEvent trigger successfull for id:", embedding.id);

                // Cache updated questions to reddis
                try {

                    let response = await axios.get(`${process.env.LLM_INDEXER_HOST}/chat/generate?indexId=${req.params.id}`)
                    redis.set(`questions:${req.params.id}`, JSON.stringify(response.data), { EX: 86400 } );

                    Logger.info("Step [2]: Questions updated for index:", req.params.id, "with", response.data.length, "questions")

                } catch (error) {
                    logger.warn("Step [2]: Error at updating questions for index", req.param.id, "with", error.message);
                }

            }
        }

    } catch (e) {
        logger.error("Step [2]: Indexer updateWebPageEvent with error:", e.message);
    }

}

export const createEmbeddingEvent = async (id) => {

    logger.info("Step [3]: createEmbeddingEvent is triggered for id:", id)

    const embeddingService = new EmbeddingService()
    const embedding = await embeddingService.getEmbeddingById(id);

    const payload = {

        indexId: embedding.index.id,
        indexTitle: embedding.index.title,
        indexCreatedAt: embedding.index.createdAt,
        indexUpdatedAt: embedding.index.updatedAt,
        indexDeletedAt: embedding.index.deletedAt,
        indexOwnerDID: embedding.index.ownerDID.id,

        webPageId: embedding.item.id,
        webPageTitle: embedding.item.title,
        webPageUrl: embedding.item.url,
        webPageContent: embedding.item.content,
        webPageCreatedAt: embedding.item.createdAt,
        webPageUpdatedAt: embedding.item.updatedAt,
        webPageDeletedAt: embedding.item.deletedAt,

        vector: embedding.vector,
    };


    if(embedding.index.ownerDID.name){
        payload.indexOwnerName = embedding.index.ownerDID.name
    }
    if(embedding.index.ownerDID.bio){
        payload.indexOwnerBio = embedding.index.ownerDID.bio
    }

    try {
        const indexResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/index?indexId=${embedding.item.id}`, payload)
        logger.info(`Step [3]: IndexItem ${payload.webPageId} with ${payload.webPageUrl} Indexed with it's content and embeddings`)
    } catch (e) {
        logger.error("Step [3]: Indexer createEmbeddingEvent with error:", e.message);
    }
}

export const updateEmbeddingEvent = async (id) => {
    logger.info("updateEmbeddingEvent", id)
}
