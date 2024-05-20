import RedisClient from "../clients/redis.js";
import {
  getPKPSession,
  getRolesFromSession,
  mintPKP,
  transferOwnership,
  writeAuthMethods,
} from "../libs/lit/index.js";
import { getAuthSigFromDIDSession } from "../utils/helpers.js";
import { DIDService } from "../services/did.js";
import { IndexService } from "../services/index.js";

const redis = RedisClient.getInstance();

export const getIndexById = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");

  try {
    const indexService = new IndexService(definition).setSession(req.session);
    const index = await indexService.getIndexById(req.params.id);

    const { roles } = req.query;

    if (req.session) {
      Object.assign(index, {
        roles: {
          owner: index.ownerDID.id === req.session.did.parent,
        },
      });

      if (roles) {
        const pkpSession = await getPKPSession(req.session, index);
        if (pkpSession) {
          const userRoles = getRolesFromSession(pkpSession, definition);
          Object.assign(index, { roles: userRoles });
        }
      }
    } else {
      Object.assign(index, { roles: { owner: false, creator: false } });
    }

    res.status(200).json(index);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
export const createIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");

  try {
    const indexParams = req.body;

    if (!indexParams.signerFunction) {
      indexParams.signerFunction = process.env.DEFAULT_SIGNER_FUNCTION;
    }

    const ownerWallet = req.session.did.parent.split(":").pop();

    const newPKP = await mintPKP(ownerWallet, req.body.signerFunction);
    indexParams.signerPublicKey = newPKP.pkpPublicKey;

    const pkpSession = await getPKPSession(req.session, indexParams);

    const indexService = new IndexService(definition).setSession(pkpSession); //PKP
    let newIndex = await indexService.createIndex(indexParams);

    console.log(newIndex);
    if (!newIndex) {
      return res.status(500).json({ error: "Create index error" });
    }

    //Cache pkp session after index creation.
    const sessionCacheKey = `${req.session.did.parent}:${ownerWallet}:${newIndex.id}:${newIndex.signerFunction}`;
    await redis.hSet("sessions", sessionCacheKey, pkpSession.serialize());

    const didService = new DIDService(definition).setSession(req.session); //Personal
    await didService.setDIDIndex(newIndex.id, "owned");

    newIndex = await indexService.getIndexById(newIndex.id);

    newIndex.did = {
      owned: true,
      starred: false,
    };
    newIndex.roles = {
      owner: true,
      creator: true,
    };

    res.status(201).json(newIndex);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
};
export const updateIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const indexService = new IndexService(definition);
    let index = await indexService.getIndexById(req.params.id);

    if (req.body.signerFunction) {
      const userAuthSig = getAuthSigFromDIDSession(req.session);
      const vals = await writeAuthMethods({
        userAuthSig: userAuthSig,
        signerPublicKey: index?.signerPublicKey,
        prevCID: index.signerFunction,
        newCID: req.body.signerFunction,
      });
      if (vals) {
        index.signerFunction = req.body.signerFunction;
      } else {
        return res.status(500).json({ error: "Unauthorized" });
      }
    }

    //sign with executejs (transaction imzasi, session imzasi)
    //broadcast transaction
    //wait transaction (skip) (3-5s)
    //update index (fast)
    //get indexById
    const pkpSession = await getPKPSession(req.session, index);

    const newIndex = await indexService
      .setSession(pkpSession)
      .updateIndex(req.params.id, req.body);

    if (pkpSession) {
      const userRoles = getRolesFromSession(pkpSession);
      Object.assign(newIndex, { roles: userRoles });
    }

    return res.status(200).json(newIndex);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const transferIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const indexService = new IndexService(definition);
    let index = await indexService.getIndexById(req.params.id);

    const previousOwner = index.ownerDID.id.split(":").pop();
    const newOwnerWallet = req.body.newOwner.split(":").pop();

    const userAuthSig = getAuthSigFromDIDSession(req.session);
    const vals = await transferOwnership({
      userAuthSig: userAuthSig,
      signerPublicKey: index?.signerPublicKey,
      signerFunction: index.signerFunction,
      previousOwner: previousOwner.toLowerCase(),
      newOwner: newOwnerWallet.toLowerCase(),
    });

    if (vals) {
      const didService = new DIDService(definition).setSession(req.session); //Personal
      await didService.setDIDIndex(index.id, "owned", true);
      await redis.hDel(`pkp:owner`, index.signerPublicKey);
    } else {
      return res.status(500).json({ error: "Unauthorized" });
    }

    return res.status(200).json(index);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const deleteIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const indexService = new IndexService(definition);
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
