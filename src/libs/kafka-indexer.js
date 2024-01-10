import dotenv from 'dotenv'
import axios from 'axios'
import {ItemService} from "../services/item.js";
import {EmbeddingService} from "../services/embedding.js";
import {getPKPSession} from "../controllers/lit-protocol.js";

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}

export const createIndexItemEvent = async (id) => {
    console.log("createIndexItemEvent", id)

    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id);

    try {

        const indexSession = await getPKPSession(indexItem.index);
        await indexSession.did.authenticate();

        const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/embeddings`, {
            text: indexItem.item.content
        })
        const embeddingService = new EmbeddingService().setDID(indexSession.did)
        const embedding = await embeddingService.createEmbedding({
            "indexId": indexItem.indexId,
            "itemId": indexItem.itemId,
            "modelName": embeddingResponse.data.model,
            "category": "document",
            "vector": embeddingResponse.data.vector,
            "description": "Default document embeddings",
        });

        console.log("Embedding created", embedding.id)

    } catch (e) {
        console.log("Indexer error:", e.message);
    }

}
export const updateIndexItemEvent = async (id) => {
    console.log("updateIndexItemEvent", id)
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
        const indexResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/index`, payload)
    } catch (e) {
        console.log(e)
    }

    console.log("IndexItem Indexed with it's content and embeddings.")

}

export const updateEmbeddingEvent = async (id) => {
    console.log("updateEmbeddingEvent", id)
}

