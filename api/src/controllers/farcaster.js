import { DIDSession } from "did-session";
import { getPKPSession } from "../libs/lit/index.js";
import { ComposeDBService } from "../services/composedb.js";
import { IndexService } from "../services/index.js";
import { ItemService } from "../services/item.js";

export const createCast = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const castFragment = modelFragments.filter(
    (fragment) => fragment.name === "Cast",
  )[0];

  //todo get fragment
  try {
    const session = await DIDSession.fromSession(process.env.FARCASTER_SESSION);
    await session.did.authenticate();

    const composeDBService = new ComposeDBService(
      definition,
      castFragment,
    ).setSession(session);

    const cast = await composeDBService.createNode({
      ...req.body.data,
    });

    const indexId = `kjzl6kcym7w8y97yfoer7bb20k4j3x3jb64t6nk714879q9cqyr3s8kuhpg9b84`;
    const indexService = new IndexService(definition);
    const index = await indexService.getIndexById(indexId);
    const pkpSession = await getPKPSession(session, index);

    const itemService = new ItemService(definition).setSession(pkpSession);
    const item = await itemService.addItem(indexId, cast.id);

    res.status(201).json({ cast, item });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
