import { DIDService } from "../services/did.js";
import {IndexService} from "../services/index.js";

export const getIndexes = async (req, res, next) => {

    try {
        const didService = new DIDService()
        const {type} = req.body;
        const newIndex = await didService.getIndexes(req.params.id, type)
        res.status(201).json({
            message: "Index found successfully",
            document: newIndex
        });
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
        res.status(201).json({
            message: "Index DID created successfully",
            document: newIndex
        });
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
        res.status(201).json({
            message: "Index DID created successfully",
            document: newIndex
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
