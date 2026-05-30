import { test, expect } from "bun:test";

import {
  DIGEST_CRON_SPECS,
  cronCreateArgs,
  isValidCron,
  resolveCronSchedule,
} from "../install_index";

test("two digest cron specs: prepare (02:00, no deliver) then send (08:00, deliver telegram)", () => {
  expect(DIGEST_CRON_SPECS).toHaveLength(2);
  const [prepare, send] = DIGEST_CRON_SPECS;
  expect(prepare.schedule).toBe("0 2 * * *");
  expect(prepare.name).toBe("Edge — digest prepare");
  expect(prepare.promptFile).toBe("prepare.md");
  expect(prepare.deliver).toBe(false);
  expect(send.schedule).toBe("0 8 * * *");
  expect(send.name).toBe("Edge — daily digest");
  expect(send.promptFile).toBe("send.md");
  expect(send.deliver).toBe(true);
});

test("prepare runs scheduled; send is created paused", () => {
  const [prepare, send] = DIGEST_CRON_SPECS;
  expect(prepare.paused).toBe(false);
  expect(send.paused).toBe(true);
});

test("prepare cron args omit --deliver; send cron args include --deliver telegram", () => {
  const home = "/home/x/.hermes";
  const [prepare, send] = DIGEST_CRON_SPECS;

  expect(cronCreateArgs(prepare, "PREP_BODY", home)).toEqual([
    "cron", "create", "0 2 * * *", "PREP_BODY",
    "--name", "Edge — digest prepare", "--workdir", home,
  ]);

  expect(cronCreateArgs(send, "SEND_BODY", home)).toEqual([
    "cron", "create", "0 8 * * *", "SEND_BODY",
    "--name", "Edge — daily digest", "--deliver", "telegram", "--workdir", home,
  ]);
});

test("each spec declares its install-time override flag + env var", () => {
  const [prepare, send] = DIGEST_CRON_SPECS;
  expect(prepare.overrideFlag).toBe("--digest-prepare-cron");
  expect(prepare.overrideEnv).toBe("DIGEST_PREPARE_CRON");
  expect(send.overrideFlag).toBe("--digest-send-cron");
  expect(send.overrideEnv).toBe("DIGEST_SEND_CRON");
});

test("isValidCron accepts 5-field expressions and rejects malformed ones", () => {
  expect(isValidCron("0 2 * * *")).toBe(true);
  expect(isValidCron("30 9 * * 1-5")).toBe(true);
  expect(isValidCron("*/15 0 1,15 * *")).toBe(true);
  expect(isValidCron("0 2 * *")).toBe(false); // too few fields
  expect(isValidCron("0 2 * * * *")).toBe(false); // too many fields
  expect(isValidCron("not a cron")).toBe(false);
  expect(isValidCron("")).toBe(false);
});

test("resolveCronSchedule returns the default when no override is set", () => {
  const [prepare] = DIGEST_CRON_SPECS;
  expect(resolveCronSchedule(prepare, [], {})).toBe("0 2 * * *");
});

test("resolveCronSchedule honors flag, then env, with flag winning over env", () => {
  const [prepare, send] = DIGEST_CRON_SPECS;

  expect(
    resolveCronSchedule(prepare, ["bun", "install", "--digest-prepare-cron", "0 3 * * *"], {}),
  ).toBe("0 3 * * *");

  expect(resolveCronSchedule(send, [], { DIGEST_SEND_CRON: "0 9 * * *" })).toBe("0 9 * * *");

  expect(
    resolveCronSchedule(
      prepare,
      ["bun", "--digest-prepare-cron", "15 4 * * *"],
      { DIGEST_PREPARE_CRON: "0 6 * * *" },
    ),
  ).toBe("15 4 * * *");
});

test("resolveCronSchedule ignores an invalid override and uses the default", () => {
  const [prepare] = DIGEST_CRON_SPECS;
  expect(resolveCronSchedule(prepare, ["bun", "--digest-prepare-cron", "garbage"], {})).toBe("0 2 * * *");
  expect(resolveCronSchedule(prepare, [], { DIGEST_PREPARE_CRON: "0 2 * *" })).toBe("0 2 * * *");
});
