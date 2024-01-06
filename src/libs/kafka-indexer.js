import dotenv from 'dotenv'
import axios from 'axios'
import {ItemService} from "../services/item.js";

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}



export const createIndexItem = async (id) => {
    console.log("createIndexItem", id)
    const itemService = new ItemService()
    const item = await itemService.getIndexItemById(id);
    console.log(item)
    /*
    try {
        await axios.post(`http://llm-indexer.testnet/index/${indexLink.indexId}/links`, {url: indexLink.link.url})
    } catch (e) {
        console.log("Indexer error:", e.message);
    }

     */

}
export const updateIndexItem = async (id) => {

}
