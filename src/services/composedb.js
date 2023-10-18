import * as composedb from '../libs/composedb.js';
import { getQueue, getMetadata } from '../libs/crawl.js'


export const get_index = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};


export const get_index_link = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexLinkById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};



export const post_link = async (req, res, next) => {

    const { id } = req.params;

    const index = await composedb.getIndexLinkById(id)
    if(!index){
        return res.status(404).end();
    }
    return res.json(index);
};

const isValidURL = (url) => {
    try {
        new URL(url);
        return true;
    } catch (error) {
        return false;
    }
};

export const zapier_index_link = async (req, res, next) => {

    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);
    const payload = req.body;
    if(!payload.url || !isValidURL(payload.url)){
        return res.json({error: "No valid URL provided"});
    }
    let linkData = await getMetadata(payload.url);
    linkData.tags = [];
    if (payload.content) linkData.content = payload.content;
    if (payload.title) linkData.title = payload.title;

    const link = await composedb.addLink(linkData, auth.session.personal);
    const indexLink = await composedb.addIndexLink(auth.indexId, link.id, auth.session.index);
    return res.json(indexLink);
};

export const zapier_auth = async (req, res, next) => {

    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);
    const index = await composedb.getIndexById(auth.indexId);
    return res.json(index);
};


