import {ItemService} from "../services/item.js";
import {IndexService} from "../services/index.js";
import {getPKPSession} from "../libs/lit/index.js";

export const listItems = async (req, res, next) => {
    //Todo without embeddings, use chromadb filters, accepts query param.
};

export const addItem = async (req, res, next) => {
    const {indexId, itemId} = req.body;
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(indexId);
        const pkpSession = await getPKPSession(req.session, index);

        const itemService = new ItemService().setSession(pkpSession);
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

        const indexService = new IndexService();
        const index = await indexService.getIndexById(indexId);
        const pkpSession = await getPKPSession(req.session, index);

        const itemService = new ItemService().setSession(pkpSession);
        const item = await itemService.removeItem(indexId, itemId);
        res.status(200).json(item);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
    //Queue embeddings
};
