import { DIDSession } from "did-session";
import { getMetadata } from '../libs/crawl.js'
import { isValidURL } from "../types/validators.js";
import { WebPageService } from "../services/webpage.js";
import { ItemService } from "../services/item.js";
import { IndexService } from "../services/index.js";

export const indexLink = async (req, res, next) => {

    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);
    const payload = req.body;
    if(!payload.url || !isValidURL(payload.url)){
        return res.json({error: "No valid URL provided"});
    }

    let linkData = await getMetadata(payload.url);
    if (payload.content) linkData.content = payload.content;
    if (payload.title) linkData.title = payload.title;
    //TODO Refactor new client
    //Create user owned webpage object.
    const personalSesssion = await DIDSession.fromSession(auth.session.personal);
    await personalSesssion.did.authenticate();

    const webPageService = new WebPageService().setSession(personalSesssion);
    const webPage = await webPageService.createWebPage(payload);

    //Index webpage object.
    const indexSession = await DIDSession.fromSession(auth.session.index);
    await indexSession.did.authenticate();

    const itemService = new ItemService().setSession(indexSession);
    const item = await itemService.addItem(auth.indexId, webPage.id);

    return res.json(item);
};

export const authenticate = async (req, res, next) => {

    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);

    const indexService = new IndexService()
    const index = await indexService.getIndexById(auth.indexId)
    return res.json(index);
};


