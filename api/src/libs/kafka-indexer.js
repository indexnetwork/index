import dotenv from 'dotenv'
import axios from 'axios'
import { ItemService } from "../services/item.js";
import { EmbeddingService } from "../services/embedding.js";
import { getPKPSession, getPKPSessionForIndexer } from "../libs/lit/index.js";

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

// Index Item (C)
export const createIndexItemEvent = async (id) => {
    console.log("createIndexItemEvent", id)

    console.log("Creating index", process.env.LLM_INDEXER_HOST)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        const indexSession = await getPKPSessionForIndexer(indexItem.index);

        await indexSession.did.authenticate();

        console.log("Indexer Item URL", `${process.env.LLM_INDEXER_HOST}/indexer/embeddings`)
        
        if (indexItem.content) {

            const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/embeddings`, {
                content: indexItem.content
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

        console.log('No content found not indexing document')

    } catch (e) {
        console.log("Indexer error:", e.message);
    }

}

// Index item (UD)
export const updateIndexItemEvent = async (id) => {
    console.log("updateIndexItemEvent", id)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id, false);

    try {

        console.log("Logging PKP Session", indexItem)
        const indexSession = await getPKPSessionForIndexer(indexItem.index);
        await indexSession.did.authenticate();
        console.log("Logged PKP Session")

        const updateURL = `${process.env.LLM_INDEXER_HOST}/indexer/item?indexId=${indexItem.indexId}&indexItemId=${indexItem.itemId}`
        console.log("IndexItem Update URL", updateURL)
        
        if (indexItem.deletedAt !== null) { 

            console.log("IndexItem Deleting.")

            const deleteResponse = await axios.delete(updateURL);

            console.log("IndexItem Delete Response", deleteResponse)
            
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
        const indexResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/index`, payload)
        console.log("IndexItem Indexed with it's content and embeddings.")
    } catch (e) {
        console.log(e)
    }
}

export const updateEmbeddingEvent = async (id) => {
    console.log("updateEmbeddingEvent", id)
}
