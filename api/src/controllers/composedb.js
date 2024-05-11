import { ComposeDBService } from "../services/composedb.js";

export const createNode = async (req, res, next) => {
    try {
      const composeDbService = new ComposeDBService().setSession(req.session);;
      const node = await composeDbService.createNode(req.params.modelId, req.body);
        res.status(201).json(node);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const updateNode = async (req, res, next) => {
    try {
      const composeDbService = new ComposeDBService().setSession(req.session);;
      const node = await composeDbService.updateNode(req.params.modelId, req.params.nodeId, req.body);
        res.status(201).json(node);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

export const getNodeById = async (req, res, next) => {
  try {
    const composeDbService = new ComposeDBService();
    const node = await composeDbService.getNodeById(req.params.modelId, req.params.nodeId);

    res.status(200).json(node);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
