import { OpenAI } from "openai";
import * as hub from "langchain/hub";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import { observeOpenAI } from "langfuse";

import { DIDSession } from "did-session";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import RedisClient from "../clients/redis.js";
import { getOpenRank } from "../libs/openrank.js";

const redis = RedisClient.getInstance();

const isWorthwhile = async (update) => {

  const decisionSchema = z.object({
    decision: z.enum(['spam', 'worthwhile']),
    rationale: z.string().optional().describe("Rationale for the decision."),
  });

  const spamPrompt = await hub.pull("v2_farcaster_spam_filter");
  const spamPromptText = spamPrompt.promptMessages[0].prompt.template;
  
  const updatePrompt = `No carefully evaluate this update: 
  ${update.text}
`
  const aiResponse = await observeOpenAI(new OpenAI({ apiKey: process.env.OPENAI_API_KEY }), {
    metadata: {
      cast_hash: update.hash,
      function: "is_worthwhile",
    }
  }).chat.completions.create({
      model: process.env.MODEL_SPAM_FILTER,
      messages: [{ role: "system", content: spamPromptText }, {
        role: "user", content: updatePrompt
      }],
      response_format: zodResponseFormat(decisionSchema, "spam_filter"),
      stream: false,
  });

  const response = JSON.parse(aiResponse.choices[0].message.content);
  if (response.decision == "spam") {
    return false
  }
  return true
}

const cleanPayload = (payload) => {
  // Remove fields not in schema
  delete payload.author_channel_context;
  
  // Clean and validate embed URLs and cast_ids
  if (payload.embeds?.length) {
    payload.embeds = payload.embeds.map(embed => {
      const cleanEmbed = {};
      
      if (embed.url) {
        // Clean URLs
        if (!embed.url.includes('…')) {
          cleanEmbed.url = embed.url.startsWith('https://') ? 
            embed.url : embed.url.replace('http://', 'https://');
        }
      }

      if (embed.cast_id) {
        cleanEmbed.cast_id = {
          ...embed.cast_id,
          fid: embed.cast_id.fid?.toString() // Convert fid to string
        };
      }

      return cleanEmbed;
    }).filter(embed => Object.keys(embed).length > 0); // Remove empty embeds
  }

  return payload;
};

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
      const cleanBio = (profile) => {
        if (profile?.profile?.bio) {
          const bioText = profile.profile.bio.text;
          profile.profile.bio = { text: bioText };
        }
      };
      cleanBio(obj.author);
      obj.mentioned_profiles?.forEach(cleanBio);
      return obj;
    };

    console.log(req.body.data)
    let payload = removeMentionedProfiles(req.body.data);
    delete payload.event_timestamp;

    if (payload.parent_hash) {
      return res.status(200).json({ status: 'rejected', message: 'No replies' });
    }

    if (payload.text.length < 40) {
      return res.status(200).json({ status: 'rejected', message: 'Short text' });
    }

    if (payload.text.toLowerCase().includes('moxie')) {
      return res.status(200).json({ status: 'rejected', message: 'Contains moxie' });
    }

    let pass = false;
    if (payload.channel) {
      const permittedChannels = ["ai", "event-pass", "launchcaster", "new-york", "farcaster", "news", "podcasts", "sf", "usv", "base", "devcon", "founders"];
      if (permittedChannels.includes(payload.channel.id)) {
        pass = true;
      }
    }

    if (!pass) {
      const openRankPercentile = await getOpenRank(payload.author.fid);
      if (!openRankPercentile || openRankPercentile < 97) {
        return res.status(200).json({ status: 'rejected', message: 'Spam' });
      }
    }

    if (!await isWorthwhile(payload)) {
      return res.status(200).json({ status: 'rejected', message: 'Spam' });
    }

    const key = `processed_cast:${payload.hash}`;
    const result = await redis.set(key, 'true', 'NX', 'EX', 86400);
    if (!result) {
      return res.status(200).json({ status: 'rejected', message: 'Duplicate item, skipped processing' });
    }

    if (payload.author) {
      if (payload.author.verified_addresses) {
        payload.author.verified_addresses = {
          eth_addresses: payload.author.verified_addresses.eth || [],
          sol_addresses: payload.author.verified_addresses.sol || []
        };
      }

      if (payload.author.profile) {
        const profile = payload.author.profile;
        if (profile.location) {
          profile.location = {
            latitude: profile.location.latitude || null,
            longitude: profile.location.longitude || null,
            address: {
              city: profile.location.city || null,
              state: profile.location.state || null,
              state_code: profile.location.state_code || null,
              country: profile.location.country || null,
              country_code: profile.location.country_code || null
            }
          };
        }
      }

      // Remove fields not in Author schema
      delete payload.author.verified_accounts;
      delete payload.author.experimental;
    }

    payload = cleanPayload(payload);

    if (payload.reactions) {
      payload.reactions = {
        likes_count: payload.reactions.likes_count || 0,
        recasts_count: payload.reactions.recasts_count || 0,
        likes: (payload.reactions.likes || []).slice(0, 8),
        recasts: (payload.reactions.recasts || []).slice(0, 8)
      };
    }

    if (payload.replies) {
      payload.replies = {
        count: payload.replies.count || 0
      };
    }


    if (payload.author) {
      payload.warpcast_url = `https://warpcast.com/${payload.author.username}/${payload.thread_hash.substring(0, 12)}`;
      payload.author.warpcast_url = `https://warpcast.com/${payload.author.username}`;
    }

    if (payload.channel) {
      payload.channel.warpcast_url = `https://warpcast.com/~/channel/${payload.channel.id}`;
    }
    console.log(payload)
    const cast = await composeDBService.createNode({
      ...payload,
    });

    
    console.log(cast)

    const itemService = new ItemService(definition).setSession(session);
    const item = await itemService.addItem("kjzl6kcym7w8y75v5w44wgqe85eorq339wzndczlvgm7vzc3ebu743sgdwaeyhd", cast.id);

    console.log(item)
    res.status(201).json({ did: session.did.parent, cast, item, indexId });
  } catch (error) {
    res.status(500).json({ error: error.message, input: req.body.data });
  }
};
