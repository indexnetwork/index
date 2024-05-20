import { getMetadata } from "../libs/crawl.js";
import axios from "axios";
import { ComposeDBService } from "../services/composedb.js";
import { getCurrentDateTime } from "../utils/helpers.js";
export const crawlMetadata = async (req, res, next) => {
  let { url } = req.query;
  let response = await getMetadata(url);
  res.json(response);
};

export const createWebPage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const webPageFragment = modelFragments.filter(
    (fragment) => fragment.name === "WebPage",
  )[0];

  //todo get fragment
  try {
    const composeDBService = new ComposeDBService(
      definition,
      webPageFragment,
    ).setSession(req.session);

    const webPage = await composeDBService.createNode({
      ...req.body,
      createdAt: getCurrentDateTime(),
      updatedAt: getCurrentDateTime(),
    });

    res.status(201).json(webPage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const crawlWebPage = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const webPageFragment = modelFragments.filter(
    (fragment) => fragment.name === "WebPage",
  )[0];
  try {
    const composeDBService = new ComposeDBService(
      definition,
      webPageFragment,
    ).setSession(req.session);
    let params = req.body;

    if (!params.title || !params.favicon) {
      const metaData = await getMetadata(params.url);
      if (metaData.title) {
        params.title = metaData.title;
      }
      if (metaData.favicon) {
        params.favicon = metaData.favicon;
      }
    }

    const createdWebPage = await composeDBService.createNode({
      ...params,
      createdAt: getCurrentDateTime(),
      updatedAt: getCurrentDateTime(),
    });
    res.status(201).json(createdWebPage);
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
      await composeDBService.updateNode(createdWebPage.id, params);
    } catch (e) {
      console.log("Crawling error", req.body.url, e);
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const getWebPageById = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  const webPageFragment = modelFragments.filter(
    (fragment) => fragment.name === "WebPage",
  )[0];

  try {
    const composeDBService = new ComposeDBService(definition, webPageFragment);
    const webPage = await composeDBService.getNodeById(req.params.id);

    res.status(200).json(webPage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
