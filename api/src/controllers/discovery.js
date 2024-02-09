import axios from 'axios';
import { DIDService } from '../services/did.js';

export const chat = async (req, res, next) => {

  const { id, messages, indexIds, did, type } = req.body;
  let reqIndexIds = [];
  if(did){
    const didService = new DIDService();
    const indexes = await didService.getIndexes(did, type);
    reqIndexIds = indexes.map(i => i.id)
  }else {
    reqIndexIds = indexIds
  }
  try {
    const chatRequest = {
      indexIds: reqIndexIds,
      input: {
        question: messages.at(-1).content,
        chat_history: [...messages.slice(0, -1)]
      }
    }
    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/chat/stream`,
      chatRequest,
      {
        responseType: 'stream'
      })
    res.set(resp.headers);
    resp.data.pipe(res);
  } catch (error) {
    // Handle the exception
    console.error('An error occurred:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const search = async (req, res, next) => {
  try {
    const searchRequest = {
      indexIds: req.body.indexIds,
      query: req.body.query,
      page: req.body.page || 1,
      limit: req.body.limit || 10,
      filters: req.body.filters || [],
    }

    let resp = await axios.post(
      `${process.env.LLM_INDEXER_HOST}/search/query`,
      searchRequest,
      {
        responseType: 'stream'
      })
    res.set(resp.headers);
    resp.data.pipe(res);
  } catch (error) {
    // Handle the exception
    console.error('An error occurred:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
