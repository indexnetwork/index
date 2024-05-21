import { EmbeddingService } from "../services/embedding.js";
import { IndexService } from "../services/index.js";
import { getPKPSession } from "../libs/lit/index.js";

export const listEmbeddings = async (req, res, next) => {};
export const createEmbedding = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const { indexId } = req.body;
    const indexService = new IndexService(definition);
    const index = await indexService.getIndexById(indexId);
    const pkpSession = await getPKPSession(req.session, index);

    const embeddingService = new EmbeddingService(definition).setSession(
      pkpSession,
    );
    const embedding = await embeddingService.createEmbedding(req.body);
    res.status(201).json(embedding);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  //Queue embeddings.
  //Kafka listener
  //Authorizes with lit, caches session, and creates embeddings
};
export const updateEmbedding = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const { indexId } = req.body;
    const indexService = new IndexService(definition);
    const index = await indexService.getIndexById(indexId);
    const pkpSession = await getPKPSession(req.session, index);

    const embeddingService = new EmbeddingService(definition).setSession(
      pkpSession,
    );
    const embedding = await embeddingService.updateEmbedding(req.body);
    res.status(200).json(embedding);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  //Kafka listener
  //Authorizes with lit, caches session, and creates embeddings
};
export const deleteEmbedding = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const { indexId } = req.body;
    const indexService = new IndexService(definition);
    const index = await indexService.getIndexById(indexId);
    const pkpSession = await getPKPSession(req.session, index);

    const embeddingService = new EmbeddingService(definition).setSession(
      pkpSession,
    );
    const embedding = await embeddingService.deleteEmbedding(req.body);
    res.status(200).json(embedding);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  //Kafka listener
  //Authorizes with lit, caches session, and creates embeddings
};
