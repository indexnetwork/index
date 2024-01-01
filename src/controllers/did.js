import { DIDService } from "../services/did.js";

export const getIndexes = async (req, res, next) => {

    try {
        const didService = new DIDService()
        const { type } = req.query;
        const indexes = await didService.getIndexes(req.params.id, type)
        res.status(200).json(indexes);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const addIndex = async (req, res, next) => {

    if(req.params.id !== req.user.parent) {
        return res.status(500).json({ error: "Authorization error" });
    }
    const {indexId, type} = req.body;
    try {
        const didService = new DIDService().setDID(req.user);
        const newIndex = await didService.addIndex(indexId, type)
        res.status(201).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const removeIndex = async (req, res, next) => {

    if(req.params.id !== req.user.parent) {
        return res.status(500).json({ error: "Authorization error" });
    }

    const {indexId, type} = req.body;
    try {
        const didService = new DIDService().setDID(req.user);
        const newIndex = await didService.removeIndex(indexId, type)
        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
