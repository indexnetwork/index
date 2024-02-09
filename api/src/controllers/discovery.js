
export const chat = async (req, res, next) => {
  try{
    let resp = await axios.post(`${process.env.LLM_INDEXER_HOST}/chat/stream`, req.body, {
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
  try{
    let resp = await axios.post(`${process.env.LLM_INDEXER_HOST}/search/query`, req.body, {
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
