import path from "node:path";

import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { BlockedQuestionBridge, canonicalizeEvent, claimOutstanding, discardEvent, filterUncancelledClaims, formatAttachment, isDedicatedRootLabel, outstandingCount, parseHerdrResult, publishEvent, resolveLiveTopology, sessionKey, spoolRoot, startWakeListener, summarizeAskUserPrompt, wakeOnce, type IndexTarget, type LiveTopology, type OrchestratorEvent, type OrchestratorEventKind, type OrchestratorProvenance, type PublishStatus } from "./orchestration-bridge.core";

const INBOX_WIDGET = "orchestration-inbox";
const CUSTOM_TYPE = "orchestrator-event";
const DELIVERY_RECORD_TYPE = "orchestration:record";
const QUESTION_TOOL = "ask_user_question";

interface OrchestratorMessageDetails {
	events: OrchestratorEvent[];
}

interface DeliveryRecord {
	eventId: string;
	kind: OrchestratorEventKind;
	source: OrchestratorProvenance;
	targetSessionId: string;
	acknowledgedAt: string;
	durableResult?: OrchestratorEvent["durableResult"];
}

interface WakeListener {
	close: () => Promise<void>;
}

interface Publication {
	root: string;
	target: IndexTarget;
	eventId: string;
	status: PublishStatus;
}

interface PendingQuestion {
	toolCallId: string;
	sessionId: string;
	ctx: ExtensionContext;
	activated: boolean;
	ended: boolean;
	eventId?: string;
	publication?: Promise<Publication | undefined>;
}

function messageEvents(ctx: ExtensionContext, targetSessionId: string): Map<string, OrchestratorEvent> {
	const events = new Map<string, OrchestratorEvent>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom_message") continue;
		const custom = entry as unknown as { customType?: unknown; details?: unknown };
		if (custom.customType !== CUSTOM_TYPE || typeof custom.details !== "object" || custom.details === null) continue;
		const values = (custom.details as Partial<OrchestratorMessageDetails>).events;
		if (!Array.isArray(values)) continue;
		for (const raw of values) {
			const event = canonicalizeEvent(raw, targetSessionId);
			if (event) events.set(event.id, event);
		}
	}
	return events;
}

function recordedEventIds(ctx: ExtensionContext, targetSessionId: string): Set<string> {
	const ids = new Set<string>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom") continue;
		const record = entry as unknown as { customType?: unknown; data?: unknown };
		if (record.customType !== DELIVERY_RECORD_TYPE || typeof record.data !== "object" || record.data === null) continue;
		const value = record.data as Partial<DeliveryRecord>;
		if (value.targetSessionId !== targetSessionId) continue;
		const eventId = value.eventId;
		if (typeof eventId === "string") ids.add(eventId);
	}
	return ids;
}

/** Persist append-only acknowledgements only after structured custom messages exist. */
function acknowledgeMessageEvents(pi: ExtensionAPI, ctx: ExtensionContext, targetSessionId: string): Set<string> {
	const events = messageEvents(ctx, targetSessionId);
	const recorded = recordedEventIds(ctx, targetSessionId);
	for (const event of events.values()) {
		if (recorded.has(event.id)) continue;
		const record: DeliveryRecord = {
			eventId: event.id,
			kind: event.kind,
			source: event.source,
			targetSessionId: event.targetSessionId,
			acknowledgedAt: new Date().toISOString(),
			...(event.durableResult ? { durableResult: event.durableResult } : {}),
		};
		pi.appendEntry(DELIVERY_RECORD_TYPE, record);
	}
	return new Set([...events.keys(), ...recorded]);
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
		return resolveLiveTopology(parseHerdrResult(workspaces.stdout), parseHerdrResult(panes.stdout), currentSession);
	} catch {
		return undefined;
	}
}

async function updateInboxWidget(pi: ExtensionAPI, ctx: ExtensionContext, sessionId: string): Promise<void> {
	const root = await canonicalRoot(pi, ctx);
	if (!root || !ctx.hasUI) return;
	const count = await outstandingCount(spoolRoot(root), sessionId);
	ctx.ui.setWidget(
		INBOX_WIDGET,
		count === 0 ? ["📬 Orchestrator inbox: clear"] : [`📬 Orchestrator inbox: ${count} event${count === 1 ? "" : "s"} pending next turn`],
		{ placement: "aboveEditor" },
	);
	ctx.ui.setStatus(INBOX_WIDGET, count === 0 ? undefined : `${count} orchestration event${count === 1 ? "" : "s"}`);
}

/** Fail closed unless the source is an observable Herdr workspace labeled `*-root`. */
async function publish(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: {
		eventId: string;
		kind: OrchestratorEventKind;
		summary: string;
		durableResult?: OrchestratorEvent["durableResult"];
	},
): Promise<Publication | undefined> {
	const [root, topology] = await Promise.all([canonicalRoot(pi, ctx), liveTopology(pi, ctx)]);
	if (!root || !topology || !isDedicatedRootLabel(topology.source.workspaceLabel)) return undefined;
	const event = canonicalizeEvent({
		id: input.eventId,
		kind: input.kind,
		source: topology.source,
		targetSessionId: topology.index.sessionId,
		summary: input.summary,
		timestamp: new Date().toISOString(),
		...(input.durableResult ? { durableResult: input.durableResult } : {}),
	});
	if (!event) return undefined;
	const status = await publishEvent(spoolRoot(root), event);
	wakeOnce(topology.index.sessionId);
	return { root, target: topology.index, eventId: event.id, status };
}

/** Project-local durable inbox, attach-next-turn delivery, and question blocked bridge. */
export default function (pi: ExtensionAPI) {
	let listener: WakeListener | undefined;
	let indexSessionId: string | undefined;
	let activation: Promise<boolean> | undefined;
	const pendingQuestions = new Map<string, PendingQuestion>();
	const blocked = new BlockedQuestionBridge((state) => {
		// pi.events (and pi-subagents' RPC/events) are same-process only. This reaches
		// Herdr's managed integration in this Pi process, never another visible pane.
		pi.events.emit("herdr:blocked", state);
	});

	const ensureIndexActivation = async (ctx: ExtensionContext): Promise<boolean> => {
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId) return false;
		if (indexSessionId === sessionId && listener) return true;
		if (activation) return activation;
		activation = (async () => {
			const topology = await liveTopology(pi, ctx);
			if (!topology || topology.index.sessionId !== sessionId) return false;
			indexSessionId = sessionId;
			listener = await startWakeListener(sessionId, () => {
				void updateInboxWidget(pi, ctx, sessionId);
			});
			await updateInboxWidget(pi, ctx, sessionId);
			return true;
		})();
		try {
			return await activation;
		} finally {
			activation = undefined;
		}
	};

	const discardQuestionPublication = async (question: PendingQuestion): Promise<void> => {
		const publication = await question.publication;
		if (publication && question.ended) await discardEvent(spoolRoot(publication.root), publication.target.sessionId, publication.eventId);
	};

	pi.registerMessageRenderer<OrchestratorMessageDetails>(CUSTOM_TYPE, (message, _options, theme) => {
		const events = Array.isArray(message.details?.events) ? message.details.events : [];
		return {
			render: () => {
				const lines = [theme.bold(theme.fg("accent", "ORCHESTRATOR_EVENT"))];
				for (const event of events) {
					const source = `${event.source.workspaceLabel}/${event.source.paneId}`;
					lines.push(theme.fg("dim", `${event.kind} · ${event.id} · ${source}`));
					lines.push(event.summary);
				}
				return lines;
			},
			invalidate() {},
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		// One startup attempt only. A failed metadata lookup may retry at the next natural turn.
		await ensureIndexActivation(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const activeQuestions = [...pendingQuestions.values()];
		for (const question of activeQuestions) {
			question.ended = true;
			blocked.end(question.toolCallId);
		}
		await Promise.all(activeQuestions.filter((question) => question.activated).map((question) => discardQuestionPublication(question)));
		blocked.shutdown();
		await listener?.close();
		listener = undefined;
		activation = undefined;
		pendingQuestions.clear();
		if (indexSessionId && ctx.hasUI) {
			ctx.ui.setWidget(INBOX_WIDGET, undefined);
			ctx.ui.setStatus(INBOX_WIDGET, undefined);
		}
		indexSessionId = undefined;
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		// This is the sole natural-turn retry path after transient Herdr metadata failure.
		if (!(await ensureIndexActivation(ctx))) return undefined;
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId || sessionId !== indexSessionId) return undefined;
		const root = await canonicalRoot(pi, ctx);
		if (!root) return undefined;
		const claims = await claimOutstanding(spoolRoot(root), sessionId, acknowledgeMessageEvents(pi, ctx, sessionId));
		const deliverable = await filterUncancelledClaims(spoolRoot(root), sessionId, claims);
		await updateInboxWidget(pi, ctx, sessionId);
		if (deliverable.length === 0) return undefined;
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: deliverable.map(({ event }) => formatAttachment(event)).join("\n\n"),
				display: true,
				details: { events: deliverable.map(({ event }) => event) } satisfies OrchestratorMessageDetails,
			},
		};
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		if (event.toolName !== QUESTION_TOOL) return;
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId) return;
		// RPIV emits its validated prompt event immediately before waiting. Do nothing yet.
		pendingQuestions.set(event.toolCallId, { toolCallId: event.toolCallId, sessionId, ctx, activated: false, ended: false });
	});

	pi.events.on("rpiv:ask-user:prompt", (payload: unknown) => {
		const summary = summarizeAskUserPrompt(payload);
		if (!summary) return;
		const question = [...pendingQuestions.values()].find((candidate) => !candidate.activated && !candidate.ended);
		if (!question) return;
		question.activated = true;
		question.eventId = `question:${sessionKey(question.sessionId).slice(0, 24)}:${question.toolCallId}`;
		blocked.start(question.toolCallId, summary);
		question.publication = publish(pi, question.ctx, { eventId: question.eventId, kind: "blocked", summary }).catch(() => undefined);
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName !== QUESTION_TOOL) return;
		const question = pendingQuestions.get(event.toolCallId);
		if (!question) return;
		question.ended = true;
		blocked.end(event.toolCallId);
		pendingQuestions.delete(event.toolCallId);
		await discardQuestionPublication(question);
	});

	pi.registerTool({
		name: "publish_orchestrator_event",
		label: "Publish Orchestrator Result",
		description:
			"Persist a verified dedicated-root RESULT for the live index session. Use a stable eventId; delivery is attach-next-turn and never edits the user's editor.",
		promptSnippet: "persist a dedicated-root RESULT for the index session",
		promptGuidelines: [
			"Only a Herdr workspace labeled *-root may publish through this tool.",
			"Publish every verified final RESULT with a stable eventId; blocked questions are published only by the validated RPIV lifecycle.",
		],
		parameters: Type.Object({
			eventId: Type.String({ description: "Stable id for this logical RESULT; retries must reuse it." }),
			summary: Type.String({ description: "Concise factual summary for the next natural main turn." }),
			resultLocation: Type.Optional(Type.String({ description: "Durable RESULT file or PR/commit location, if applicable." })),
			resultPayload: Type.Optional(Type.String({ description: "Small durable RESULT payload, if applicable." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const published = await publish(pi, ctx, {
				eventId: params.eventId,
				kind: "result",
				summary: params.summary,
				durableResult:
					params.resultLocation || params.resultPayload
						? { location: params.resultLocation, payload: params.resultPayload }
						: undefined,
			});
			if (!published || published.status === "cancelled" || published.status === "retry") {
				return {
					content: [{ type: "text", text: !published ? "No verified *-root → index route was available; RESULT was not published." : `Orchestrator RESULT ${published.status}; retry this stable eventId later.` }],
					details: { published: false, ...(published ? { status: published.status, targetSessionId: published.target.sessionId } : {}) },
				};
			}
			return {
				content: [{ type: "text", text: `Orchestrator RESULT ${published.status}; wake was best-effort only.` }],
				details: { published: true, status: published.status, targetSessionId: published.target.sessionId },
			};
		},
	});
}
