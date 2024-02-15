import dotenv from 'dotenv'
import axios from 'axios'
import { ItemService } from "../services/item.js";
import { WebPageService } from "../services/webpage.js";
import { EmbeddingService } from "../services/embedding.js";
import { getPKPSession, getPKPSessionForIndexer } from "../libs/lit/index.js";
import RedisClient from '../clients/redis.js';
import e from 'express';

const redis = RedisClient.getInstance();

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

// Index Item (C)
export const createIndexItemEvent = async (id) => {

    console.log("createIndexItemEvent", id)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        const indexSession = await getPKPSessionForIndexer(indexItem.index);
        await indexSession.did.authenticate();

        // console.log("Indexing item at", `${process.env.LLM_INDEXER_HOST}/indexer/index?indexId=${indexItem.indexId}`, )
        // console.log("Indexing item", indexItem)

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
    
            console.log("Embedding created", embedding.id)
        }

        console.log('No content found, createIndexItem event incomplete')

    } catch (e) {
        console.log("Indexer createIndexItemEvent error:", e.message);
    }

}

// Index item (UD)
export const updateIndexItemEvent = async (id) => {

    console.log("updateIndexItemEvent", id)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        const indexSession = await getPKPSessionForIndexer(indexItem.index);
        await indexSession.did.authenticate();
        console.log("Logged PKP Session")

        const updateURL = `${process.env.LLM_INDEXER_HOST}/indexer/item?indexId=${indexItem.indexId}&indexItemId=${indexItem.itemId}`
        console.log("IndexItem Update URL", updateURL)
        
        if (indexItem.deletedAt !== null) { 

            console.log("IndexItem Deleting.")

            const deleteResponse = await axios.delete(updateURL);

            // console.log("IndexItem Delete Response", deleteResponse)
            
            if (deleteResponse.status === 200) {
                console.log("IndexItem Deleted.")
            } else {
                console.log("IndexItem Deletion Failed.")
            }
            
        } else {

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
                console.log("IndexItem Update.")
            } else {
                console.log("IndexItem Update Failed.")
            } 
        }

    } catch (e) {
        console.log("Indexer updateIndexItemEvent error:", e.message);
    }
}

export const updateWebPageEvent = async (id) => {

    console.log("updateWebPageEvent", id)

    const webPage = new WebPageService()
    const webPageItem = await webPage.getWebPageById(id, false);

    try {

        console.log("WebPageItem", webPageItem)
        console.log("WebPageItem", webPageItem.content)

        if (webPageItem && webPageItem.content) {

            const itemSession = new ItemService()
            const indexItems = await itemSession.getIndexesByItemId(webPageItem.id, null, 24, false);
            
            for (let indexItem of indexItems.items) {
                
                console.log("IndexItem", indexItem.index.title)

                const indexSession = await getPKPSessionForIndexer(indexItem.index);

                const embeddingService = new EmbeddingService().setSession(indexSession)

                const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/embeddings`, {
                    content: webPageItem.content
                })
                
                const embedding = await embeddingService.createEmbedding({
                    "indexId": indexItem.index.id,
                    "itemId": indexItem.item.id,
                    "modelName": embeddingResponse.data.model,
                    "category": "document",
                    "vector": embeddingResponse.data.vector,
                    "description": "Default document embeddings",
                });
        
                console.log("Embedding created", embedding.id);

                // Cache updated questions to reddis
                try {
                    let response = await axios.get(`${process.env.LLM_INDEXER_HOST}/chat/generate?indexId=${req.params.id}`)
                    redis.set(`questions:${req.params.id}`, JSON.stringify(response.data), { EX: 86400 } );
                } catch (error) {
                    console.log("Error updating questions", error.message);
                }

            }
        }

    } catch (e) {
        console.log("Update Web Page Error:", e.message);
    }

}

export const createEmbeddingEvent = async (id) => {

    console.log("createEmbeddingEvent", id)

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
        console.log(`IndexItem ${payload.webPageId} with ${payload.webPageUrl} Indexed with it's content and embeddings`)
    } catch (e) {
        console.log(e)
    }
}

export const updateEmbeddingEvent = async (id) => {
    console.log("updateEmbeddingEvent", id)



}
