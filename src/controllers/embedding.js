import {EmbeddingService} from "../services/embedding.js";

export const listEmbeddings = async (req, res, next) => {};
export const createEmbedding = async (req, res, next) => {
    const {indexId, itemId} = req.body;
    try {
        const embeddingService = new EmbeddingService().setDID(req.user);
        const newItem = await embeddingService.addItem(indexId, itemId);
        res.status(201).json(newItem);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    //Queue embeddings.
    //Kafka listener
    //Authorizes with lit, caches session, and creates embeddings
};
export const updateEmbedding = async (req, res, next) => {
    //Kafka listener
    //Authorizes with lit, caches session, and creates embeddings
};
export const deleteEmbedding = async (req, res, next) => {
    //Kafka listener
    //Authorizes with lit, caches session, and creates embeddings
};


