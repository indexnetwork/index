import { getAddress } from "@ethersproject/address";
import axios from "axios";
import RedisClient from '../clients/redis.js';
import { getPKPSession, getRolesFromSession, mintPKP, writeAuthMethods } from "../libs/lit/index.js";
import { getAuthSigFromDIDSession } from "../utils/helpers.js";
import { DIDService } from "../services/did.js";
import { IndexService } from "../services/index.js";

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

        const indexParams = req.body;

        const ownerWallet = req.session.did.parent.split(":").pop();
        const newPKP = await mintPKP(ownerWallet, req.body.signerFunction);
        console.log("Superlog" , newPKP)
        indexParams.signerPublicKey = newPKP.pkpPublicKey;

        const pkpSession = await getPKPSession(req.session, indexParams);

        const indexService = new IndexService().setSession(pkpSession); //PKP
        let newIndex = await indexService.createIndex(indexParams);
        if(!newIndex){
          return res.status(500).json({ error: "Create index error" });
        }

        //Cache pkp session after index creation.
        const sessionCacheKey = `${req.session.did.parent}:${newIndex.id}:${newIndex.signerFunction}`
        await redis.hSet("sessions", sessionCacheKey, pkpSession.serialize());

        const didService = new DIDService().setSession(req.session); //Personal
        const newIndexDID = await didService.setDIDIndex(newIndex.id, "owned");
        newIndex = await indexService.getIndexById(newIndex.id);

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
        let index = await indexService.getIndexById(req.params.id);

        if(req.body.signerFunction){

          const userAuthSig = getAuthSigFromDIDSession(req.session)
          const vals = await writeAuthMethods({
            userAuthSig: userAuthSig,
            signerPublicKey: index?.signerPublicKey,
            prevCID: index.signerFunction,
            newCID: req.body.signerFunction,
          });
          console.log(vals)

          console.log("updated!");
          index.signerFunction = req.body.signerFunction;
        }

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
