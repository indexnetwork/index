import { DIDSession } from "did-session";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import RedisClient from "../clients/redis.js";

const redis = RedisClient.getInstance();

const cleanPayload = (payload) => {
  // Basic validation and cleaning of event data
  const cleanedPayload = {
    event_id: payload.event_id,
    title: payload.title?.trim(),
    description: payload.description?.trim(),
    start_time: payload.start_time,
    end_time: payload.end_time,
    location: payload.location?.trim(),
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

      let payload = cleanPayload(req.body);
      // Check for duplicate events
      const member = `${payload.title}_${payload.start_time}`;
      const exists = await redis.hGet(`processed_events`, member);
      if (exists) {
        console.log('Duplicate event, skipped processing');
        return res.status(200).json({ status: 'rejected', message: 'Duplicate event, skipped processing' });
      }
      await redis.hSet(`processed_events`, member, '1');
      

      const eventId = payload.event_id.split('@')[0];
      const response = await fetch(`https://api.lu.ma/event/get?event_api_id=${eventId}`, {
          headers: {
              'x-luma-api-key': process.env.LUMA_API_KEY
          }
      });
      const eventData = await response.json();

      if (eventData && eventData.event && eventData.event.geo_address_info && eventData.event.geo_address_info.city_state) {
        payload.location = eventData.event.geo_address_info.city_state;
      }else {
        return res.status(200).json({ status: 'rejected', message: 'Event not found in Luma' });
      }

      const event = await composeDBService.createNode({
        ...payload,
      });

      const itemService = new ItemService(definition).setSession(session);
      const item = await itemService.addItem("kjzl6kcym7w8y5fn848pe928cfklxny5rkez7t6riycs13ou4kbdvfxghjjlxtl", event.id);

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
