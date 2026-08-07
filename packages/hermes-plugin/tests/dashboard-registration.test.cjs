"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const bundle = fs.readFileSync(
  path.resolve(__dirname, "../dashboard/dist/index.js"),
  "utf8",
);

async function runBundle(rawMode) {
  const registrations = [];
  const requests = [];
  const isFull = rawMode === undefined || rawMode === "" || rawMode === "full";
  const window = {
    __HERMES_PLUGIN_SDK__: {
      React: {},
      fetchJSON(requestPath) {
        requests.push(requestPath);
        if (!isFull) {
          return Promise.reject(new Error("404: dashboard mode endpoint is unavailable"));
        }
        return Promise.resolve({ success: true, mode: "full" });
      },
    },
    __HERMES_PLUGINS__: {
      register(name, component) {
        registrations.push({ name, component });
      },
    },
  };
  const context = {
    window,
    document: {
      currentScript: null,
      querySelectorAll() { return []; },
    },
    console: { warn() {}, error() {}, info() {}, log() {} },
    Promise,
    setTimeout,
    clearTimeout,
  };

  vm.runInNewContext(bundle, context, { filename: "dashboard/dist/index.js" });
  await new Promise((resolve) => setImmediate(resolve));
  return { registrations, requests };
}

(async () => {
  const cases = [
    { label: "absent", rawMode: undefined, expectedRegistrations: 1 },
    { label: "empty", rawMode: "", expectedRegistrations: 1 },
    { label: "full", rawMode: "full", expectedRegistrations: 1 },
    { label: "negotiator", rawMode: "negotiator", expectedRegistrations: 0 },
    { label: "unknown", rawMode: "unexpected-non-empty-mode", expectedRegistrations: 0 },
    { label: "whitespace-only", rawMode: "   ", expectedRegistrations: 0 },
    { label: "whitespace-padded", rawMode: " full ", expectedRegistrations: 0 },
  ];

  for (const testCase of cases) {
    const result = await runBundle(testCase.rawMode);
    assert.deepEqual(
      result.requests,
      ["/api/plugins/index-network/mode"],
      `${testCase.label}: the bundle must ask the gated backend before registering`,
    );
    assert.equal(
      result.registrations.length,
      testCase.expectedRegistrations,
      `${testCase.label}: unexpected dashboard registration count`,
    );
    if (testCase.expectedRegistrations === 1) {
      assert.equal(result.registrations[0].name, "index-network");
      assert.equal(typeof result.registrations[0].component, "function");
    }
  }

  console.log("dashboard registration mode gate: PASS (7 cases)");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
