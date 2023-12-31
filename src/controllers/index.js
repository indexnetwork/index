import * as indexService from '../services/index.js';
import {IndexService} from "../services/index.js";


export const getIndexById = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.getIndexById(req.params.id);
        res.status(201).json({
            message: "Index retrieved successfully",
            document: newIndex
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const createIndex = async (req, res, next) =>  {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.createIndex(req.body);
        res.status(201).json({
            message: "Index created successfully",
            document: newIndex
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const updateIndex = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.updateIndex(req.params.id, req.body);
        res.status(201).json({
            message: "Index updated successfully",
            document: newIndex
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
export const deleteIndex = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.deleteIndex(req.params.id);
        res.status(201).json({
            message: "Index deleted successfully",
            document: newIndex
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const listItems = async (req, res, next) => {
    //Todo without embeddings, use chromadb filters, accepts query param.
};
export const addItem = async (req, res, next) => {
    //Add item first
    //Then queue embeddings to kafka
};
export const removeItem = async (req, res, next) => {
    //Remove item
    //Remove embeddings
};

export const listEmbeddings = async (req, res, next) => {};
export const createEmbedding = async (req, res, next) => {
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

