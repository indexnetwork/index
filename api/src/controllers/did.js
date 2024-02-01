import { DIDService } from "../services/did.js";
export const getIndexes = async (req, res, next) => {
    // sendLit(req.params.id) //TODO Fix later.

    try {
        const didService = new DIDService().setSession(req.session)
        const { type, did } = req.params;
        const indexes = await didService.getIndexes(did, type)
        res.status(200).json(indexes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const addIndex = async (req, res, next) => {

    if(req.params.did !== req.session.did.parent) {
        return res.status(500).json({ error: "Authorization error" });
    }
    const type = req.params.type === 'own' ? 'owned' : 'starred';
    const { indexId } = req.params;
    try {
        const didService = new DIDService().setSession(req.session);
        const newIndex = await didService.addIndex(indexId, type)
        res.status(201).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const removeIndex = async (req, res, next) => {

    if(req.params.did !== req.session.did.parent) {
        return res.status(500).json({ error: "Authorization error" });
    }

    const type = req.params.type === 'own' ? 'owned' : 'starred';
    const {indexId } = req.params;
    try {
        const didService = new DIDService().setSession(req.session)
        const newIndex = await didService.removeIndex(indexId, type)
        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};


export const createProfile = async (req, res, next) => {
    if(req.params.did !== req.session.did.parent) {
        return res.status(500).json({ error: "Authorization error" });
    }
    try {
        const didService = new DIDService().setSession(req.session);
        const profile = await didService.createProfile(req.body)
        res.status(201).json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getProfile = async (req, res, next) => {
    try {
        const didService = new DIDService()
        let profile = await didService.getProfile(req.params.did)

        if(!profile){
            profile = {
                id: req.params.did,
            }
        }

        res.status(200).json(profile);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
