import { afterEach, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
	BlockedQuestionBridge,
	acknowledgeDelivered,
	claimOutstanding,
	outstandingCount,
	publishEvent,
	resolveIndexTarget,
	sessionDirectory,
	type OrchestratorEvent,
} from "../../.pi/extensions/orchestration-bridge.core";

const temporaryDirectories: string[] = [];

async function temporaryRoot(): Promise<string> {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "index-orchestration-bridge-"));
	temporaryDirectories.push(directory);
	return directory;
}

function event(id: string, targetSessionId = "index-session"): OrchestratorEvent {
	return {
		id,
		kind: "result",
		source: {
			workspaceId: "w13",
			paneId: "w13:p1",
			sessionId: "root-session",
		},
		targetSessionId,
		summary: "Committed the documentation change.",
		timestamp: "2026-07-22T00:00:00.000Z",
		durableResult: { location: "PR #1207" },
	};
}

afterEach(async () => {
	await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("orchestration bridge spool", () => {
	test("persists structured provenance and durable payload once for a stable id", async () => {
		const root = await temporaryRoot();
		const published = event("result-1207");
		const first = await publishEvent(root, published);
		const second = await publishEvent(root, published);

		expect(first).toBe("published");
		expect(second).toBe("duplicate");
		const claims = await claimOutstanding(root, "index-session", new Set());
		expect(claims.map(({ event: claimed }) => claimed)).toEqual([published]);
		expect(await outstandingCount(root, "index-session")).toBe(1);
		const mode = (await fs.stat(sessionDirectory(root, "index-session"))).mode & 0o777;
		expect(mode).toBe(0o700);
	});

	test("replays an unacknowledged claim and acknowledges it after persistent delivery", async () => {
		const root = await temporaryRoot();
		await publishEvent(root, event("result-replay"));

		const firstTurn = await claimOutstanding(root, "index-session", new Set());
		expect(firstTurn.map(({ event: claimed }) => claimed.id)).toEqual(["result-replay"]);
		expect(await outstandingCount(root, "index-session")).toBe(1);

		const restartedTurn = await claimOutstanding(root, "index-session", new Set());
		expect(restartedTurn.map(({ event: claimed }) => claimed.id)).toEqual(["result-replay"]);

		await acknowledgeDelivered(root, "index-session", new Set(["result-replay"]));
		expect(await outstandingCount(root, "index-session")).toBe(0);
		expect(await claimOutstanding(root, "index-session", new Set(["result-replay"]))).toEqual([]);
	});
});

describe("live index target resolution", () => {
	test("uses workspace label and reported Pi session rather than an agent name", () => {
		const target = resolveIndexTarget(
			{
				workspaces: [
					{ workspace_id: "wX", label: "index", focused: false, active_tab_id: "wX:t1" },
					{ workspace_id: "w13", label: "docs", focused: false, active_tab_id: "w13:t1" },
				],
			},
			{
				panes: [
					{
						workspace_id: "wX",
						pane_id: "wX:p1",
						tab_id: "wX:t1",
						agent: "pi",
						agent_status: "idle",
						agent_session: { value: "/sessions/current-index.jsonl" },
					},
				],
			},
		);
		expect(target).toEqual({
			workspaceId: "wX",
			paneId: "wX:p1",
			sessionId: "/sessions/current-index.jsonl",
			focused: false,
			status: "idle",
		});
	});
});

describe("same-process question blocked bridge", () => {
	test("balances nested question lifecycles and cleans up abnormal shutdown", () => {
		const states: Array<{ active: boolean; label?: string }> = [];
		const bridge = new BlockedQuestionBridge((state) => states.push(state));

		bridge.start("call-1", "First question");
		bridge.start("call-2", "Nested question");
		bridge.end("call-1");
		bridge.end("call-2");
		bridge.start("call-3", "Abnormal question");
		bridge.shutdown();
		bridge.shutdown();

		expect(states).toEqual([
			{ active: true, label: "First question" },
			{ active: false },
			{ active: true, label: "Abnormal question" },
			{ active: false },
		]);
	});
});
