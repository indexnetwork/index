import { afterEach, describe, expect, test } from "bun:test";
import { isIntroducerDiscoveryEnabled } from "../opportunity.introducer-feature.js";

const original = process.env.INTRODUCER_DISCOVERY_ENABLED;
afterEach(() => {
  if (original === undefined) delete process.env.INTRODUCER_DISCOVERY_ENABLED;
  else process.env.INTRODUCER_DISCOVERY_ENABLED = original;
});

describe("isIntroducerDiscoveryEnabled", () => {
  test.each([undefined, "false", "TRUE", "1", "on", ""])("defaults off for %p", (value) => {
    if (value === undefined) delete process.env.INTRODUCER_DISCOVERY_ENABLED;
    else process.env.INTRODUCER_DISCOVERY_ENABLED = value;
    expect(isIntroducerDiscoveryEnabled()).toBe(false);
  });

  test("enables only for true", () => {
    process.env.INTRODUCER_DISCOVERY_ENABLED = "true";
    expect(isIntroducerDiscoveryEnabled()).toBe(true);
  });
});
