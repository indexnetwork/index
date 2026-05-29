import { test, expect } from "bun:test";

import { DIGEST_CRON_SPECS, cronCreateArgs } from "../install_index";

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
