import { createClient } from "redis";
import { createNewModel, indexNewModel, stopIndexingModels } from "../libs/composedb.js";

export const info = async (req, res) => {
  const runtimeDefinition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");
  res.json({
    runtimeDefinition,
    modelFragments,
  });
};

export const create = async (req, res, next) => {
  const indexResult = await createNewModel(
    req.body.schema
  );
  res.json(indexResult);
};

export const deploy = async (req, res, next) => {

  const pubClient = createClient({
    url: process.env.REDIS_CONNECTION_STRING,
  });
  await pubClient.connect();
  const indexResult = await indexNewModel(
    req.app,
    req.params.id,
  );
  if (indexResult) {
    pubClient.publish("newModel", req.params.id);
  }
  res.json(indexResult);
};

export const remove = async (req, res, next) => {
  const pubClient = createClient({
    url: process.env.REDIS_CONNECTION_STRING,
  });
  await pubClient.connect();
  const indexResult = await stopIndexingModels(
    req.app,
    req.params.id,
  );
  if (indexResult) {
    pubClient.publish("newModel", req.params.id);
  }
  res.json(indexResult);
};
