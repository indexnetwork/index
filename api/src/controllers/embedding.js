import { EmbeddingService } from "../services/embedding.js";

export const listEmbeddings = async (req, res, next) => {};
export const createEmbedding = async (req, res, next) => {
  const definition = req.app.get("runtimeDefinition");
  try {
    const embeddingService = new EmbeddingService(definition).setSession(
      req.session,
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
    const embeddingService = new EmbeddingService(definition).setSession(
      req.session,
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
    const embeddingService = new EmbeddingService(definition).setSession(
      req.session,
    );
    const embedding = await embeddingService.deleteEmbedding(req.body);
    res.status(200).json(embedding);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
  //Kafka listener
  //Authorizes with lit, caches session, and creates embeddings
};
