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

        const embeddingResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/embeddings`, {url: indexItem.item.url})
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
}

export const updateEmbeddingEvent = async (id) => {
    console.log("updateEmbeddingEvent", id)
}

