import { DIDSession } from "did-session";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import RedisClient from "../clients/redis.js";

const redis = RedisClient.getInstance();

const cleanPayload = (payload) => {
  // Basic validation and cleaning of event data
  const cleanedPayload = {
    title: payload.title?.trim(),
    description: payload.description?.trim(),
    start_time: payload.start_time,
    end_time: payload.end_time,
    location: payload.location?.trim()
  };

  // Only add link if it's valid
  if (payload.link) {
    try {
      const url = new URL(payload.link);
      cleanedPayload.link = url.protocol === 'https:' ? 
        payload.link : url.href.replace('http://', 'https://');
    } catch (e) {
      console.log('Invalid URL in event link:', payload.link);
    }
  }

  return cleanedPayload;
};

export const createEvent = async (req, res, next) => {
  try {
    const definition = req.app.get("runtimeDefinition");
    const modelFragments = req.app.get("modelFragments");
    const eventFragment = modelFragments.filter(
      (fragment) => fragment.name === "Event",
    )[0];

    try {
      const session = await DIDSession.fromSession(process.env.LUMA_SESSION);
      await session.did.authenticate();

      const composeDBService = new ComposeDBService(
        definition,
        eventFragment,
      ).setSession(session);

      let payload = cleanPayload(req.body.data);

      // Check for duplicate events
      const key = `processed_event:${payload.title}_${payload.start_time}`;
      const result = await redis.set(key, 'true');
      if (!result) {
        return res.status(200).json({ status: 'rejected', message: 'Duplicate event, skipped processing' });
      }

      const event = await composeDBService.createNode({
        ...payload,
      });

      const itemService = new ItemService(definition).setSession(session);
      const item = await itemService.addItem("kjzl6hvfrbw6c9mxmf3qq4i4pcq0b26z7ns8drwsrr5hotcbmkwz7gobki2az9d", event.id);

      res.status(201).json({ did: session.did.parent, event, item });
    } catch (error) {
      console.error('Error creating event or item:', error);
      return res.status(400).json({ 
        status: 'error',
        message: 'Failed to create event or item',
        error: error.message 
      });
    }
  } catch (error) {
    console.error('Error in createEvent:', error);
    return res.status(500).json({ 
      status: 'error',
      message: 'Internal server error',
      error: error.message,
      input: req.body.data 
    });
  }
};
