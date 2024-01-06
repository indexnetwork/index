import dotenv from 'dotenv'
import axios from 'axios'
import {ItemService} from "../services/item.js";

if(process.env.NODE_ENV !== 'production'){
    dotenv.config()
}



export const createIndexItem = async (id) => {
    console.log("createIndexItem", id)
    const itemService = new ItemService()
    const indexItem = await itemService.getIndexItemById(id);
    console.log(indexItem.item.url)
    try {
        await axios.post(`http://llm-indexer.testnet/embeddings`, {url: indexItem.item.url})
    } catch (e) {
        console.log("Indexer error:", e.message);
    }
    //Get item url
    //Get embeddings
    //Save embeddings
    //Index embeddings
    /*


     */

}
export const updateIndexItem = async (id) => {

}
