import { getMetadata } from '../libs/crawl.js'
import { WebPageService } from "../services/webpage.js";
import { ItemService } from "../services/item.js";
import { IndexService } from "../services/index.js";
import { getPKPSession } from "../libs/lit/index.js";

export const indexWebPage = async (req, res, next) => {

    let params = req.body;
    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);

    const pkpSession = await getPKPSession(auth.session, auth.indexId);
    const webPageService = new WebPageService().setSession(pkpSession);
    const itemService = new ItemService().setSession(pkpSession);

    if(!params.title || !params.favicon){
      const metaData = await getMetadata(params.url)
      if(metaData.title){
        params.title = metaData.title
      }
      if(metaData.favicon){
        params.favicon = metaData.favicon
      }
    }

    if(!params.content){
      try{
          const crawlResponse = await axios.post(`${process.env.LLM_INDEXER_HOST}/indexer/crawl`, {
              url: params.url
          })
          if (crawlResponse && crawlResponse.data && crawlResponse.data.content) {
              params = { content: crawlResponse.data.content, ... params }
          }
      } catch(e) {
          console.log("Crawling error", req.body.url, e)
      }
    }

    const webPage = await webPageService.createWebPage(params);

    const item = await itemService.addItem(auth.indexId, webPage.id);

    return res.json(item);
};

export const authenticate = async (req, res, next) => {

    const sessionStr = Buffer.from(req.headers.authorization, "base64").toString("utf8");
    const auth = JSON.parse(sessionStr);

    const indexService = new IndexService()
    const index = await indexService.getIndexById(auth.indexId)
    return res.json(index);
};
