import { DIDService } from "../services/did.js";
import crypto from 'crypto';
import axios from "axios";


export const getIndexes = async (req, res) => {
  // sendLit(req.params.id) // TODO Fix later.
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition);
    const { type, did } = req.params;
    const indexes = await didService.getIndexes(did, type);
    res.status(200).json(indexes);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const addIndex = async (req, res) => {
  const definition = req.app.get("runtimeDefinition");
  if (req.params.did !== req.session.did.parent) {
    return res.status(500).json({ error: "Authorization error" });
  }
  const type = req.params.type === "own" ? "owned" : "starred";
  const { indexId } = req.params;
  try {
    const didService = new DIDService(definition).setSession(req.session);
    const newIndex = await didService.setDIDIndex(indexId, type);
    res.status(201).json(newIndex);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const removeIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  if (req.params.did !== req.session.did.parent) {
    return res.status(500).json({ error: "Authorization error" });
  }

  const type = req.params.type === "own" ? "owned" : "starred";
  const { indexId } = req.params;
  try {
    const didService = new DIDService(definition).setSession(req.session);
    const newIndex = await didService.setDIDIndex(indexId, type, true);
    res.status(200).json(newIndex);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const createProfile = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition).setSession(req.session);
    const profile = await didService.createProfile(req.body);
    res.status(201).json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getProfileByDID = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition);
    let profile = await didService.getProfile(req.params.did);

    if (!profile) {
      profile = {
        id: req.params.did,
      };
    }

    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getProfileFromSession = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition);
    let profile = await didService.getProfile(req.session.did.parent);

    if (!profile) {
      profile = {
        id: req.params.did,
      };
    }
    
    profile.hmac = crypto.createHmac('sha256', process.env.MAGICBELL_API_SECRET)
    .update(req.session.did.parent)
    .digest('base64');

    await axios.post('https://api.magicbell.com/users', {
      user: {
        external_id: req.session.did.parent
      }
    }, {
      headers: {
        'X-MAGICBELL-API-KEY': process.env.MAGICBELL_API_KEY,
        'X-MAGICBELL-API-SECRET': process.env.MAGICBELL_API_SECRET
      }
    });

    res.status(200).json(profile);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
