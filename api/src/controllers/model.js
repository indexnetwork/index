import { createClient } from "redis";
import { indexNewModel } from "../libs/composedb.js";

export const info = async (req, res) => {
  const runtimeDefinition = req.app.get("runtimeDefinition");
  const modelFragments = req.app.get("modelFragments");

  res.json({
    runtimeDefinition,
    modelFragments,
  });
};

export const deploy = async (req, res, next) => {
  const pubClient = createClient({
    url: process.env.REDIS_CONNECTION_STRING,
  });
  await pubClient.connect();
  await indexNewModel(req.app, req.params.id);
  pubClient.publish("newModel", req.params.id);
  res.json(`OK!`);
};
