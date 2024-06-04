import { getRolesFromSession } from "../libs/lit/index.js";
import { DIDService } from "../services/did.js";
import { IndexService } from "../services/index.js";

export const getIndexById = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");

  try {
    const indexService = new IndexService(definition).setSession(req.session);
    const index = await indexService.getIndexById(req.params.id);

    if (req.session) {
      const userRoles = getRolesFromSession(req.session, definition);
      Object.assign(index, { roles: userRoles });
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

    const indexService = new IndexService(definition).setSession(req.session); //PKP
    let newIndex = await indexService.createIndex(indexParams);

    if (!newIndex) {
      return res.status(500).json({ error: "Create index error" });
    }

    const didService = new DIDService(definition).setSession(req.session); //Personal
    await didService.setDIDIndex(newIndex.id, "owned");

    newIndex = await indexService.getIndexById(newIndex.id);

    newIndex.did = {
      owned: true,
      starred: false,
    };
    newIndex.roles = {
      owner: true,
      creator: false,
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

    const newIndex = await indexService
      .setSession(req.session)
      .updateIndex(req.params.id, req.body);

    return res.status(200).json(newIndex);
  } catch (error) {
    console.log(error);
    res.status(500).json({ error: error.message });
  }
};

export const transferIndex = async (req, res, next) => {
  return res.status(400).json({ error: `Not implemented yet!` });
};

export const deleteIndex = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const indexService = new IndexService(definition);

    const deletedIndex = await indexService
      .setSession(req.session)
      .deleteIndex(req.params.id);

    res.status(200).json(deletedIndex);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
