import { ComposeDBService } from "../services/composedb.js";

export const createNode = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const fragment = modelFragments.filter(
    (fragment) => fragment.id === req.params.modelId,
  )[0];

  try {
    const composeDbService = new ComposeDBService(
      definition,
      fragment,
    ).setSession(req.session);
    const node = await composeDbService.createNode(req.body);
    res.status(201).json(node);
  } catch (error) {
    res.status(500).json({ error: error.message, input: req.body });
  }
};

export const updateNode = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const fragment = modelFragments.filter(
    (fragment) => fragment.id === req.params.modelId,
  )[0];
  try {
    const composeDbService = new ComposeDBService(
      definition,
      fragment,
    ).setSession(req.session);
    const node = await composeDbService.updateNode(req.params.nodeId, req.body);
    res.status(201).json(node);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getNodeById = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const fragment = modelFragments.filter(
    (fragment) => fragment.id === req.params.modelId,
  )[0];
  try {
    const composeDbService = new ComposeDBService(definition, fragment);
    const node = await composeDbService.getNodeById(req.params.nodeId);

    res.status(200).json(node);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
