import { DIDSession } from "did-session";
import { ComposeDBService } from "../services/composedb.js";
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

    const removeMentionedProfiles = (obj) => {
      const cleanBio = (profile) =>
        profile?.profile?.bio && delete profile.profile.bio.mentioned_profiles;
      cleanBio(obj.author);
      obj.mentioned_profiles?.forEach(cleanBio);
      return obj;
    };

    const payload = removeMentionedProfiles(req.body.data);

    const cast = await composeDBService.createNode({
      ...payload,
    });

    const indexId = `kjzl6kcym7w8ya9ox2ppqrv44frwo971ryv925tammb7ikkfq599dypbfl6nccw`;

    const itemService = new ItemService(definition).setSession(session);
    const item = await itemService.addItem(indexId, cast.id);

    res.status(201).json({ cast, item });
  } catch (error) {
    res.status(500).json({ error: error.message, input: req.body.data });
  }
};
