import { IndexService } from "../services/index.js";
import { DIDService } from "../services/did.js";
import {getPKPSession, getRolesFromSession} from "../libs/lit/index.js";
import axios from "axios";
import RedisClient from '../clients/redis.js';

const redis = RedisClient.getInstance();

export const getIndexById = async (req, res, next) => {
    try {
        const indexService = new IndexService().setSession(req.session);
        const index = await indexService.getIndexById(req.params.id);

        const { roles }  = req.query

        if(req.session) {

          Object.assign(index, {roles: {
            owner: index.ownerDID.id === req.session.did.parent,
          }});

          if( roles ) {
            const pkpSession = await getPKPSession(req.session, index);
            if(pkpSession){
              const userRoles =  getRolesFromSession(pkpSession);
              Object.assign(index, {roles: userRoles});
            }
          }
        } else {
          Object.assign(index, {roles: {owner: false, creator: false}});
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
        if(!newIndex){
          return res.status(500).json({ error: "Create index error" });
        }

        //Cache pkp session after index creation.
        const sessionCacheKey = `${req.session.did.parent}:${newIndex.id}:${newIndex.signerFunction}`
        await redis.hSet("sessions", sessionCacheKey, pkpSession.serialize());

        const didService = new DIDService().setSession(req.session); //Personal
        const newIndexDID = await didService.addIndex(newIndex.id, "owned");
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

        return await getIndexById(req, res, next);

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
export const getQuestions = async (req, res, next) => {
    try {

        const indexService = new IndexService();
        const index = await indexService.getIndexById(req.params.id);
        if (!index) {
            return res.status(404).json({ error: "Index not found" });
        }

        const question_cache = await redis.get(`questions:${req.params.id}`)

        if (question_cache) { return res.status(200).json(JSON.parse(question_cache)); }

        try {
            let response = await axios.get(`${process.env.LLM_INDEXER_HOST}/chat/generate?indexId=${req.params.id}`)
            redis.set(`questions:${req.params.id}`, JSON.stringify(response.data), { EX: 86400 } );
            res.status(200).json(response.data);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
