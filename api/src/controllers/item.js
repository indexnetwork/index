import {ItemService} from "../services/item.js";

export const listItems = async (req, res, next) => {
    //Todo without embeddings, use chromadb filters, accepts query param.
};

export const addItem = async (req, res, next) => {
    const {indexId, itemId} = req.body;
    try {
        const itemService = new ItemService().setDID(req.pkpDID);
        const item = await itemService.addItem(indexId, itemId);
        res.status(201).json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    //Queue embeddings.
};
export const removeItem = async (req, res, next) => {
    const {indexId, itemId} = req.body;
    try {
        const itemService = new ItemService().setDID(req.pkpDID);
        const item = await itemService.removeItem(indexId, itemId);
        res.status(200).json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    //Queue embeddings
};
