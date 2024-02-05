import { IndexService } from "../services/index.js";
import { DIDService } from "../services/did.js";
import {getPKPSession, getRolesFromSession} from "../libs/lit/index.js";

export const getIndexById = async (req, res, next) => {
    try {
        const indexService = new IndexService().setSession(req.session);
        const index = await indexService.getIndexById(req.params.id);

        if(req.session){
            const pkpSession = await getPKPSession(req.session, index);
            if(pkpSession){
                const roles = getRolesFromSession(pkpSession);
                Object.assign(index, {roles});
            }else{
                Object.assign(index, {roles: owner: false, creator: false});
            }
        }

        res.status(200).json(index);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const createIndex = async (req, res, next) =>  {
    try {

        const pkpSession = await getPKPSession(req.session, req.body);

        const indexService = new IndexService().setSession(pkpSession); //PKP
        const newIndex = await indexService.createIndex(req.body);

        const didService = new DIDService().setSession(req.session); //Personal
        const newIndexDID = await didService.addIndex(newIndex.id, "owner");
        newIndex.did = {
            owned: true,
            starred: false
        };
        newIndex.roles = {
          owner: true,
          creator: true
        }

        res.status(201).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const updateIndex = async (req, res, next) => {
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(req.params.id);
        const pkpSession = await getPKPSession(req.session, index);

        const newIndex = await indexService
            .setSession(pkpSession)
            .updateIndex(req.params.id, req.body);

        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
export const deleteIndex = async (req, res, next) => {
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(req.params.id);
        const pkpSession = await getPKPSession(req.session, index);

        const deletedIndex = await indexService
            .setSession(pkpSession)
            .deleteIndex(req.params.id);

        res.status(200).json(deletedIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
