import path from "node:path";

import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { BlockedQuestionBridge, claimOutstanding, outstandingCount, parseHerdrResult, publishEvent, resolveIndexTarget, sessionKey, spoolRoot, startWakeListener, wakeOnce, type IndexTarget, type OrchestratorEvent, type OrchestratorEventKind, type OrchestratorProvenance } from "./orchestration-bridge.core";

const INBOX_WIDGET = "orchestration-inbox";
const CUSTOM_TYPE = "orchestrator-event";
const QUESTION_TOOL = "ask_user_question";

interface LiveTopology {
	index: IndexTarget;
	source: OrchestratorProvenance;
}

interface WakeListener {
	close: () => Promise<void>;
}

function concise(value: string, limit = 360): string {
	return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function eventMessage(event: OrchestratorEvent): string {
	const provenance = `${event.source.workspaceId}/${event.source.paneId}`;
	const durable = event.durableResult?.location ? ` location=${event.durableResult.location}` : "";
	return `ORCHESTRATOR_EVENT id=${event.id} kind=${event.kind} source=${provenance} timestamp=${event.timestamp}${durable}\n${event.summary}`;
}

function deliveredEventIds(ctx: ExtensionContext): Set<string> {
	const ids = new Set<string>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom_message") continue;
		const custom = entry as unknown as { customType?: unknown; content?: unknown };
		if (custom.customType !== CUSTOM_TYPE || typeof custom.content !== "string") continue;
		for (const match of custom.content.matchAll(/\bORCHESTRATOR_EVENT id=([A-Za-z0-9._:-]+)/g)) ids.add(match[1]);
	}
	return ids;
}

function questionSummary(args: unknown): string {
	if (typeof args !== "object" || args === null) return "The root needs a structured answer.";
	const values = args as Record<string, unknown>;
	for (const key of ["question", "prompt", "purpose", "message", "title"]) {
		if (typeof values[key] === "string" && values[key].trim()) return concise(values[key]);
	}
	return "The root needs a structured answer.";
}

async function canonicalRoot(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string | undefined> {
	const worktrees = await pi.exec("git", ["-C", ctx.cwd, "worktree", "list", "--porcelain"]);
	if (worktrees.code !== 0) return undefined;
	const first = worktrees.stdout.split("\n").find((line) => line.startsWith("worktree "));
	return first ? path.resolve(first.slice("worktree ".length).trim()) : undefined;
}

async function liveTopology(pi: ExtensionAPI, ctx: ExtensionContext): Promise<LiveTopology | undefined> {
	const currentSession = ctx.sessionManager.getSessionFile();
	if (!currentSession) return undefined;
	const [workspaces, panes] = await Promise.all([pi.exec("herdr", ["workspace", "list"]), pi.exec("herdr", ["pane", "list"])]);
	if (workspaces.code !== 0 || panes.code !== 0) return undefined;
	try {
		const index = resolveIndexTarget(parseHerdrResult(workspaces.stdout), parseHerdrResult(panes.stdout));
		if (!index) return undefined;
		const paneResult = parseHerdrResult(panes.stdout) as {
			panes?: Array<{ workspace_id?: string; pane_id?: string; agent_session?: { value?: string } }>;
		};
		const sourcePane = paneResult.panes?.find((pane) => pane.agent_session?.value === currentSession);
		if (!sourcePane?.workspace_id || !sourcePane.pane_id) return undefined;
		return {
			index,
			source: {
				workspaceId: sourcePane.workspace_id,
				paneId: sourcePane.pane_id,
				sessionId: currentSession,
			},
		};
	} catch {
		return undefined;
	}
}

async function updateInboxWidget(pi: ExtensionAPI, ctx: ExtensionContext, sessionId: string): Promise<void> {
	const root = await canonicalRoot(pi, ctx);
	if (!root || !ctx.hasUI) return;
	const count = await outstandingCount(spoolRoot(root), sessionId);
	ctx.ui.setWidget(INBOX_WIDGET, count === 0 ? [] : [`📬 Orchestrator inbox: ${count} event${count === 1 ? "" : "s"} pending next turn`]);
	ctx.ui.setStatus(INBOX_WIDGET, count === 0 ? undefined : `${count} orchestration event${count === 1 ? "" : "s"}`);
}

async function publish(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: {
		eventId: string;
		kind: OrchestratorEventKind;
		summary: string;
		durableResult?: OrchestratorEvent["durableResult"];
	},
): Promise<{ status: "published" | "duplicate"; target: IndexTarget } | undefined> {
	const [root, topology] = await Promise.all([canonicalRoot(pi, ctx), liveTopology(pi, ctx)]);
	if (!root || !topology || topology.source.workspaceId === topology.index.workspaceId) return undefined;
	const event: OrchestratorEvent = {
		id: input.eventId,
		kind: input.kind,
		source: topology.source,
		targetSessionId: topology.index.sessionId,
		summary: concise(input.summary),
		timestamp: new Date().toISOString(),
		...(input.durableResult ? { durableResult: input.durableResult } : {}),
	};
	const status = await publishEvent(spoolRoot(root), event);
	wakeOnce(topology.index.sessionId);
	return { status, target: topology.index };
}

/** Project-local durable inbox, attach-next-turn delivery, and question blocked bridge. */
export default function (pi: ExtensionAPI) {
	let listener: WakeListener | undefined;
	let indexSessionId: string | undefined;
	const blocked = new BlockedQuestionBridge((state) => {
		// Herdr's managed integration subscribes to this shared, same-process Pi bus.
		pi.events.emit("herdr:blocked", state);
	});

	pi.on("session_start", async (_event, ctx) => {
		const topology = await liveTopology(pi, ctx);
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!topology || !sessionId || topology.index.sessionId !== sessionId) return;
		indexSessionId = sessionId;
		listener = await startWakeListener(sessionId, () => {
			void updateInboxWidget(pi, ctx, sessionId);
		});
		await updateInboxWidget(pi, ctx, sessionId);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		blocked.shutdown();
		await listener?.close();
		listener = undefined;
		if (indexSessionId && ctx.hasUI) {
			ctx.ui.setWidget(INBOX_WIDGET, []);
			ctx.ui.setStatus(INBOX_WIDGET, undefined);
		}
		indexSessionId = undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId || sessionId !== indexSessionId) return undefined;
		const root = await canonicalRoot(pi, ctx);
		if (!root) return undefined;
		const claims = await claimOutstanding(spoolRoot(root), sessionId, deliveredEventIds(ctx));
		await updateInboxWidget(pi, ctx, sessionId);
		if (claims.length === 0) return undefined;
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: claims.map(({ event: claimed }) => eventMessage(claimed)).join("\n\n"),
				display: true,
			},
		};
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (event.toolName !== QUESTION_TOOL) return;
		const label = questionSummary(event.args);
		blocked.start(event.toolCallId, label);
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId) return;
		await publish(pi, ctx, {
			eventId: `question:${sessionKey(sessionId).slice(0, 24)}:${event.toolCallId}`,
			kind: "blocked",
			summary: label,
		});
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName === QUESTION_TOOL) blocked.end(event.toolCallId);
	});

	pi.registerTool({
		name: "publish_orchestrator_event",
		label: "Publish Orchestrator Event",
		description:
			"Persist a root RESULT or genuine blocked-question event for the live index session. Use a stable eventId; delivery is attach-next-turn and never edits the user's editor.",
		promptSnippet: "persist a root RESULT or blocked question for the index session",
		promptGuidelines: [
			"When operating as a dedicated root, publish every final RESULT with a stable eventId after factual verification.",
			"Never use this tool from the interactive index workspace; it cannot edit or wake the user's editor.",
		],
		parameters: Type.Object({
			eventId: Type.String({ description: "Stable id for this logical event; retries must reuse it." }),
			kind: Type.Union([Type.Literal("result"), Type.Literal("blocked")]),
			summary: Type.String({ description: "Concise factual summary for the next natural main turn." }),
			resultLocation: Type.Optional(Type.String({ description: "Durable RESULT file or PR/commit location, if applicable." })),
			resultPayload: Type.Optional(Type.String({ description: "Small durable RESULT payload, if applicable." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const published = await publish(pi, ctx, {
				eventId: params.eventId,
				kind: params.kind,
				summary: params.summary,
				durableResult:
					params.resultLocation || params.resultPayload
						? { location: params.resultLocation, payload: params.resultPayload }
						: undefined,
			});
			if (!published) {
				return {
					content: [{ type: "text", text: "No live non-index root → index route was available; event was not published." }],
					details: { published: false },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Orchestrator event ${published.status} for ${published.target.workspaceId}/${published.target.paneId}; wake was best-effort only.`,
					},
				],
				details: { published: true, status: published.status, targetSessionId: published.target.sessionId },
			};
		},
	});
}
