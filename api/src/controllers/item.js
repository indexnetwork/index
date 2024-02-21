import {ItemService} from "../services/item.js";
import {IndexService} from "../services/index.js";
import {getPKPSession} from "../libs/lit/index.js";
import axios from "axios";
export const listItems = async (req, res, next) => {
    const { indexId } = req.params;
    const { query, cursor, limit } = req.query;
    try {
        let response = {endCursor: null, items: []};
        if(query){
          try {
            const searchRequest = {
              indexIds: [indexId],
              query,
              page: 1,
              limit,
            }

            let res = await axios.post(
              `${process.env.LLM_INDEXER_HOST}/search/query`,
              searchRequest)
            console.log(res.data);
            if(res.data.items.length > 0){
                const itemService = new ItemService()
                console.log(res.data.items.map(i => i.id));
                response = await itemService.getIndexItemsByIds(res.data.items.map(i => i.webPageId), null, 240, true)
            }
          } catch (error) {
            return res.status(400).json({ error: error.message });
          }
        }else{
          const itemService = new ItemService();
          response = await itemService.getIndexItems(indexId, cursor, limit)
        }


        return res.status(200).json(response);

    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
};

export const addItem = async (req, res, next) => {
    const {indexId, itemId} = req.params;
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(indexId);
        const pkpSession = await getPKPSession(req.session, index);

        const itemService = new ItemService().setSession(pkpSession);
        const item = await itemService.addItem(indexId, itemId);
        res.status(201).json(item);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
    //Queue embeddings.
};
export const removeItem = async (req, res, next) => {
    const {indexId, itemId} = req.params;
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(indexId);
        const pkpSession = await getPKPSession(req.session, index);

        const itemService = new ItemService().setSession(pkpSession);
        await itemService.removeItem(indexId, itemId);
        res.sendStatus(204);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
    //Queue embeddings
};

export const getIndexesByItemId = async (req, res, next) => {
    const { itemId } = req.params;
    try {

        const itemService = new ItemService();
        const items = await itemService.getIndexesByItemId(itemId, null, 24, false);


        return res.json(items);
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
    //Queue embeddings
};
