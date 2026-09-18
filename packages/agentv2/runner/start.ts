import { IndexClient } from "@indexnetwork/client";

import { ModelClient } from "../src/index.ts";

import { startRunner } from "./runner.ts";

const stamp = (): string => new Date().toLocaleTimeString("en-GB");

if (!process.env.INDEX_EXECUTOR_ID) {
  throw new Error("INDEX_EXECUTOR_ID is required. Register and select this external agent before starting agentv2.");
}
const client = new IndexClient();
const model = new ModelClient();

const me = await client.me();
console.log(`${stamp()} ${me.name ?? me.id} on ${process.env.INDEX_API_URL ?? "http://localhost:3001"}`);
console.log(`${stamp()} waking on events only. Ctrl-C to stop.`);

const runner = startRunner({
  client,
  model,
  log: (line) => { console.log(`${stamp()} ${line}`); },
  onError: (error) => { console.error(`${stamp()} error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`); },
});

process.on("SIGINT", () => {
  runner.stop();
  process.exit(0);
});
