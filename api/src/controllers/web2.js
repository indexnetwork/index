import {WebPageService} from "../services/webpage.js";
import {getMetadata} from "../libs/crawl.js";
import axios from "axios";
export const crawlMetadata = async (req, res, next) => {
    let { url } = req.query;
    let response = await getMetadata(url)
    res.json(response)
};

export const createWebPage = async (req, res, next) => {
    try {
        const webPageService = new WebPageService().setSession(req.session);
        const webPage = await webPageService.createWebPage(req.body);
        res.status(201).json(webPage);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const crawlWebPage = async (req, res, next) => {
    try {
        const webPageService = new WebPageService().setSession(req.session);
        let params = req.body;
        try{
            const crawlResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/crawl`, {
                url: params.url
            })
            if (crawlResponse && crawlResponse.data && crawlResponse.data.content) {
                params = {content: crawlResponse.data.content, ... params}
            }
        } catch(e) {
            console.log("Crawling error", req.body.url, e)
        }

        const webPage = await webPageService.createWebPage(params);
        res.status(201).json(webPage);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

