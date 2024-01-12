import { IndexService } from "../services/index.js";
import { DIDService } from "../services/did.js";

export const getIndexById = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.getIndexById(req.params.id);
        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const createIndex = async (req, res, next) =>  {
    try {
        const indexService = new IndexService().setDID(req.pkpDID); //PKP
        const newIndex = await indexService.createIndex(req.body);

        const didService = new DIDService().setDID(req.personalDID); //Personal
        const newIndexDID = await didService.addIndex(newIndex.id, "owner");

        res.status(201).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}
export const updateIndex = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.updateIndex(req.params.id, req.body);
        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
export const deleteIndex = async (req, res, next) => {
    try {
        const indexService = new IndexService().setDID(req.user);
        const newIndex = await indexService.deleteIndex(req.params.id);
        res.status(200).json(newIndex);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};
