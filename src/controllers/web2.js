import {WebPageService} from "../services/webpage.js";
import {getMetadata} from "../libs/crawl.js";
export const crawlMetadata = async (req, res, next) => {
    let { url } = req.query;

    let response = await getMetadata(url)

    res.json(response)
};

export const createWebPage = async (req, res, next) => {
    try {
        const webPageService = new WebPageService().setDID(req.user);
        const webPage = await webPageService.createWebPage(req.body);
        res.status(201).json(webPage);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
