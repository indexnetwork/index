import { getMetadata } from "../libs/crawl.js";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import axios from "axios";
import { DIDService } from "../services/did.js";
import { getCurrentDateTime } from "../utils/helpers.js";

export const indexWebPage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const webPageFragment = modelFragments.filter(
    (fragment) => fragment.name === "WebPage",
  )[0];

  let params = req.body;
  let { indexId } = req.params;

  const composeDBService = new ComposeDBService(
    definition,
    webPageFragment,
  ).setSession(req.session);
  const itemService = new ItemService(definition).setSession(req.session);

  if (!params.title || !params.favicon) {
    const metaData = await getMetadata(params.url);
    if (metaData.title) {
      params.title = metaData.title;
    }
    if (metaData.favicon) {
      params.favicon = metaData.favicon;
    }
  }

  if (!params.content) {
    try {
      const crawlResponse = await axios.post(
        `${process.env.LLM_INDEXER_HOST}/indexer/crawl`,
        {
          url: params.url,
        },
      );
      if (crawlResponse && crawlResponse.data && crawlResponse.data.content) {
        params = { content: crawlResponse.data.content, ...params };
      }
    } catch (e) {
      console.log("Crawling error", req.body.url, e);
    }
  }

  const webPage = await composeDBService.createNode({
    ...params,
    createdAt: getCurrentDateTime(),
    updatedAt: getCurrentDateTime(),
  });

  const item = await itemService.addItem(indexId, webPage.id);

  return res.json(item);
};

export const authenticate = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition);
    let profile = await didService.getProfile(req.session.did.parent);

    if (!profile || !profile.id) {
      profile = {
        id: req.session.did.parent,
      };
    }

    res
      .status(200)
      .json({ label: profile.name || profile.id, didKey: profile.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const indexes = async (req, res) => {
  // sendLit(req.params.id) // TODO Fix later.
  const definition = req.app.get("runtimeDefinition");
  try {
    const didService = new DIDService(definition);
    const indexes = await didService.getIndexes(req.session.did.parent);
    res.status(200).json(
      indexes.map((index) => {
        return { id: index.id, label: index.title };
      }),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
