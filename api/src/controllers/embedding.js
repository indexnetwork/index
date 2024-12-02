import { EmbeddingService } from "../services/embedding.js";
import { IndexService } from "../services/index.js";

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

export const findAndUpsertEmbeddingsByIndexIds = async (req, res, next) => {

  return res.status(500).json({ error: 'Disabled' });

  const definition = req.app.get("runtimeDefinition");
  try {
    const embeddingService = new EmbeddingService(definition);
    const embeddings = await embeddingService.findAndUpsertEmbeddingsByIndexIds([
      "kjzl6kcym7w8yb1lw37upcpbxllni7f5gqoonmp2i68ijfp37jitiy9ymm21pmu",
      "kjzl6kcym7w8yay64ivr2h7xc12d580nt5xes8ozqac356u7tbp8d8i755iz40l"
    ]);
    res.status(200).json(embeddings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
} 