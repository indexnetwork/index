import axios from "axios";
import { DIDSession } from "did-session";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import { DIDService } from "../services/did.js";
import RedisClient from "../clients/redis.js";
import { IndexService } from "../services/index.js";

const redis = RedisClient.getInstance();

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

    const didService = new DIDService(definition, castFragment).setSession(
      session,
    );

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

    let indexId = await redis.hGet(`farcaster:channels`, payload.parent_url);
    if (!indexId) {
      const channelInfo = await axios.get(
        `https://api.neynar.com/v2/farcaster/channel?id=${payload.parent_url}&type=parent_url&viewer_fid=3`,
        {
          headers: {
            accept: "application/json",
            api_key: process.env.NEYNAR_API_KEY,
          },
        },
      );

      const channelName = channelInfo.data.channel.name;
      const didIndexes = await didService.getIndexes(
        session.did.parent,
        `owned`,
      );

      let channelIndex = didIndexes.find(
        (index) => index.title === `Farcaster - ${channelName}`,
      );

      if (!channelIndex) {
        const indexService = new IndexService(definition).setSession(session);
        channelIndex = await indexService.createIndex({
          title: `Farcaster - ${channelName}`,
        });
        await redis.hSet(`sessions`, channelIndex.id, session.serialize());
        await didService.setDIDIndex(channelIndex.id, "owned");
      }

      await redis.hSet(
        `farcaster:channels`,
        payload.parent_url,
        channelIndex.id,
      );
      indexId = channelIndex.id;
    }

    const itemService = new ItemService(definition).setSession(session);
    const item = await itemService.addItem(indexId, cast.id);
    console.log({ cast, item, indexId });
    res.status(201).json({ did: session.did.parent, cast, item, indexId });
  } catch (error) {
    res.status(500).json({ error: error.message, input: req.body.data });
  }
};
