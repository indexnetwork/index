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

    let payload = removeMentionedProfiles(req.body.data);
    delete payload.event_timestamp;
    const isProcessed = await redis.hIncrBy(`casts`, payload.hash, 1);
    if (isProcessed && isProcessed > 1) {
      console.log(
        `Cast ${payload.hash} already processed ${isProcessed} times. Skipping...`,
      );
      return res.status(200).json({ message: "Cast already processed" });
    } else {
      console.log(`Cast ${payload.hash} is processing...`);
    }

    payload.embeds = payload.embeds.map((e) => {
      e.cast_id.fid = e.cast_id.fid.toString();
      return e;
    });

    if (payload.author) {
      payload.warpcast_url = `https://warpcast.com/${payload.author.username}/${payload.thread_hash.substring(0, 12)}`;
      payload.author.warpcast_url = `https://warpcast.com/${payload.author.username}`;
    }

    if (payload.channel) {
      payload.channel.warpcast_url = `https://warpcast.com/~/channel/${payload.channel.id}`;
    }
    const cast = await composeDBService.createNode({
      ...payload,
    });

    let indexId = await redis.hGet(`farcaster:channels`, payload.parent_url);
    if (!indexId) {
      const channelName = payload.channel.name;
      const didIndexes = await didService.getIndexes(
        session.did.parent,
        `owned`,
      );

      let channelIndex = didIndexes.find(
        (index) => index.title === channelName,
      );

      if (!channelIndex) {
        const indexService = new IndexService(definition).setSession(session);
        channelIndex = await indexService.createIndex({
          title: channelName,
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
    res.status(201).json({ did: session.did.parent, cast, item, indexId });
  } catch (error) {
    res.status(500).json({ error: error.message, input: req.body.data });
  }
};
