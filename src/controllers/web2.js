import {WebPageService} from "../services/webpage.js";

export const migrateURL = async (req, res, next) => {
    if(req.did){

    }
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
