import { ComposeDBService } from "../services/composedb.js";

export const createWebPage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const castFragment = modelFragments.filter(
    (fragment) => fragment.name === "FarcasterCast",
  )[0];

  //todo get fragment
  try {
    const composeDBService = new ComposeDBService(
      definition,
      castFragment,
    ).setSession(req.session);

    const cast = await composeDBService.createNode({
      ...req.body,
    });

    res.status(201).json(cast);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
