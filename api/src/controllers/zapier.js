import { getMetadata } from "../libs/crawl.js";
import { ComposeDBService } from "../services/composedb.js";
import { ItemService } from "../services/item.js";
import { IndexService } from "../services/index.js";
import { getPKPSession } from "../libs/lit/index.js";
import { DIDSession } from "did-session";
import axios from "axios";

export const indexWebPage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const webPageFragment = modelFragments.filter(
    (fragment) => fragment.name === "WebPage",
  )[0];

  let params = req.body;
  const sessionStr = Buffer.from(req.headers.authorization, "base64").toString(
    "utf8",
  );
  const auth = JSON.parse(sessionStr);

  const indexService = new IndexService(definition);
  const index = await indexService.getIndexById(auth.indexId);

  const zapierSession = await DIDSession.fromSession(auth.session);

  const pkpSession = await getPKPSession(zapierSession, index);
  const composeDBService = new ComposeDBService(
    definition,
    webPageFragment,
  ).setSession(zapierSession);
  const itemService = new ItemService(definition).setSession(pkpSession);

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

  const webPage = await composeDBService.createWebPage({
    ...params,
    createdAt: getCurrentDateTime(),
    updatedAt: getCurrentDateTime(),
  });

  const item = await itemService.addItem(auth.indexId, webPage.id);

  return res.json(item);
};

export const authenticate = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const sessionStr = Buffer.from(req.headers.authorization, "base64").toString(
    "utf8",
  );
  const auth = JSON.parse(sessionStr);

  const indexService = new IndexService(definition);
  const index = await indexService.getIndexById(auth.indexId);
  return res.json(index);
};
