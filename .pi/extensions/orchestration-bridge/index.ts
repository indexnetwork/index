import path from "node:path";

import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { BlockedQuestionBridge, RootWakeGate, canonicalizeEvent, claimCompactionContinuation, claimOutstanding, completeCompactionContinuation, discardEvent, formatAttachment, getCompactionCheckpoint, isDedicatedRootLabel, markCompactionCompacted, outstandingCount, parseHerdrResult, prepareAttachment, publishChildEvent, publishEvent, recoverCompactionContinuation, registerChildRoute, resolveChildPublicationRoute, resolveChildRouteRegistration, resolveLiveTopology, resolveRootInboundRoutes, resolveSessionTopology, routeAuthorizesEvent, sessionKey, spoolRoot, startWakeListener, summarizeAskUserPrompt, wakeOnce, writeCompactionCheckpoint, type ChildRoute, type CompactionCheckpoint, type LiveTopology, type OrchestratorEvent, type OrchestratorEventKind, type OrchestratorProvenance, type PublishStatus, type SourcePolicy } from "./core";

const INBOX_WIDGET = "orchestration-inbox";
const CUSTOM_TYPE = "orchestrator-event";
const CONTINUATION_TYPE = "orchestrator-root-continuation";
const COMPACTION_CONTINUATION_TYPE = "orchestrator-compaction-continuation";
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
	targetSessionId: string;
	eventId: string;
	status: PublishStatus;
	sourcePolicy: SourcePolicy;
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

interface InboxTarget {
	kind: "index" | "root";
	sessionId: string;
	sourcePolicy: SourcePolicy;
	routes: ChildRoute[];
}

function messageEvents(ctx: ExtensionContext, targetSessionId: string, sourcePolicy: SourcePolicy): Map<string, OrchestratorEvent> {
	const events = new Map<string, OrchestratorEvent>();
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom_message") continue;
		const custom = entry as unknown as { customType?: unknown; details?: unknown };
		if (custom.customType !== CUSTOM_TYPE || typeof custom.details !== "object" || custom.details === null) continue;
		const values = (custom.details as Partial<OrchestratorMessageDetails>).events;
		if (!Array.isArray(values)) continue;
		for (const raw of values) {
			const event = canonicalizeEvent(raw, targetSessionId, Date.now(), sourcePolicy);
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
		if (value.targetSessionId !== targetSessionId || typeof value.eventId !== "string") continue;
		ids.add(value.eventId);
	}
	return ids;
}

function acknowledgeMessageEvents(pi: ExtensionAPI, ctx: ExtensionContext, target: InboxTarget): Set<string> {
	const events = messageEvents(ctx, target.sessionId, target.sourcePolicy);
	const recorded = recordedEventIds(ctx, target.sessionId);
	for (const event of events.values()) {
		if (recorded.has(event.id)) continue;
		pi.appendEntry<DeliveryRecord>(DELIVERY_RECORD_TYPE, {
			eventId: event.id,
			kind: event.kind,
			source: event.source,
			targetSessionId: event.targetSessionId,
			acknowledgedAt: new Date().toISOString(),
			...(event.durableResult ? { durableResult: event.durableResult } : {}),
		});
	}
	return new Set([...events.keys(), ...recorded]);
}

async function canonicalRoot(pi: ExtensionAPI, ctx: ExtensionContext): Promise<string | undefined> {
	const worktrees = await pi.exec("git", ["-C", ctx.cwd, "worktree", "list", "--porcelain"]);
	if (worktrees.code !== 0) return undefined;
	const first = worktrees.stdout.split("\n").find((line) => line.startsWith("worktree "));
	return first ? path.resolve(first.slice("worktree ".length).trim()) : undefined;
}

async function herdrMetadata(pi: ExtensionAPI): Promise<{ workspaces: unknown; panes: unknown } | undefined> {
	const [workspaces, panes] = await Promise.all([pi.exec("herdr", ["workspace", "list"]), pi.exec("herdr", ["pane", "list"])]);
	if (workspaces.code !== 0 || panes.code !== 0) return undefined;
	try {
		return { workspaces: parseHerdrResult(workspaces.stdout), panes: parseHerdrResult(panes.stdout) };
	} catch {
		return undefined;
	}
}

async function liveTopology(pi: ExtensionAPI, ctx: ExtensionContext): Promise<LiveTopology | undefined> {
	const sessionId = ctx.sessionManager.getSessionFile();
	if (!sessionId) return undefined;
	const metadata = await herdrMetadata(pi);
	return metadata ? resolveLiveTopology(metadata.workspaces, metadata.panes, sessionId) : undefined;
}

async function liveSource(pi: ExtensionAPI, ctx: ExtensionContext): Promise<OrchestratorProvenance | undefined> {
	const sessionId = ctx.sessionManager.getSessionFile();
	if (!sessionId) return undefined;
	const metadata = await herdrMetadata(pi);
	return metadata ? resolveSessionTopology(metadata.workspaces, metadata.panes, sessionId)?.source : undefined;
}

function rootAuthorizer(target: InboxTarget): ((event: OrchestratorEvent) => boolean) | undefined {
	return target.kind === "root" ? (event) => routeAuthorizesEvent(target.routes, event) : undefined;
}

async function updateInboxWidget(pi: ExtensionAPI, ctx: ExtensionContext, target: InboxTarget): Promise<void> {
	const root = await canonicalRoot(pi, ctx);
	if (!root || !ctx.hasUI) return;
	const count = await outstandingCount(spoolRoot(root), target.sessionId, target.sourcePolicy, rootAuthorizer(target));
	const label = target.kind === "index" ? "pending next user turn" : "pending child callback";
	ctx.ui.setWidget(
		INBOX_WIDGET,
		count === 0 ? ["📬 Orchestrator inbox: clear"] : [`📬 Orchestrator inbox: ${count} event${count === 1 ? "" : "s"} ${label}`],
		{ placement: "aboveEditor" },
	);
	ctx.ui.setStatus(INBOX_WIDGET, count === 0 ? undefined : `${count} orchestration event${count === 1 ? "" : "s"}`);
}

/** Existing dedicated-root → index publication remains the sole index callback path. */
async function publishRoot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: { eventId: string; kind: OrchestratorEventKind; summary: string; durableResult?: OrchestratorEvent["durableResult"] },
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
	return { root, targetSessionId: topology.index.sessionId, eventId: event.id, status, sourcePolicy: "root" };
}

/** Child publication resolves one registered exact route; it accepts no caller target. */
async function publishChild(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: { eventId: string; kind: OrchestratorEventKind; summary: string; durableResult?: OrchestratorEvent["durableResult"] },
): Promise<Publication | undefined> {
	const [root, source] = await Promise.all([canonicalRoot(pi, ctx), liveSource(pi, ctx)]);
	if (!root || !source || isDedicatedRootLabel(source.workspaceLabel) || source.workspaceLabel === "index") return undefined;
	const route = await resolveChildPublicationRoute(spoolRoot(root), source);
	if (!route) return undefined;
	const event = canonicalizeEvent({
		id: input.eventId,
		kind: input.kind,
		source,
		targetSessionId: route.root.sessionId,
		summary: input.summary,
		timestamp: new Date().toISOString(),
		...(input.durableResult ? { durableResult: input.durableResult } : {}),
	}, route.root.sessionId, Date.now(), "registered-child");
	if (!event) return undefined;
	const status = await publishChildEvent(spoolRoot(root), event, route);
	wakeOnce(route.root.sessionId);
	return { root, targetSessionId: route.root.sessionId, eventId: event.id, status, sourcePolicy: "registered-child" };
}

async function publishCallback(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	input: { eventId: string; kind: OrchestratorEventKind; summary: string; durableResult?: OrchestratorEvent["durableResult"] },
): Promise<Publication | undefined> {
	const source = await liveSource(pi, ctx);
	return source && isDedicatedRootLabel(source.workspaceLabel) ? publishRoot(pi, ctx, input) : publishChild(pi, ctx, input);
}

/** Project-local durable inbox, routed callbacks, root wakeups, and supervised compaction. */
export default function (pi: ExtensionAPI) {
	let listener: WakeListener | undefined;
	let activeTarget: InboxTarget | undefined;
	let activation: Promise<InboxTarget | undefined> | undefined;
	const rootWakeGate = new RootWakeGate();
	const activeTools = new Set<string>();
	const pendingQuestions = new Map<string, PendingQuestion>();
	const supervisedCompactions = new Set<string>();
	const pendingCompactionContinuations = new Set<string>();
	const blocked = new BlockedQuestionBridge((state) => {
		pi.events.emit("herdr:blocked", state);
	});

	/** One coalesced custom follow-up wakes an idle index/root without fabricating user input. */
	const queueInboxWake = (ctx: ExtensionContext, target: InboxTarget): void => {
		rootWakeGate.request(() => {
			try {
				pi.sendMessage({
					customType: CONTINUATION_TYPE,
					content: target.kind === "index"
						? "A verified orchestration callback is durable. Reconcile its untrusted status and ask for real approval or answers when required."
						: "A registered child callback is durable. Reconcile the child worktree, git, tests, and PR facts independently before continuing.",
					display: true,
					details: { targetSessionId: target.sessionId, consumer: target.kind },
				}, { deliverAs: "followUp", triggerTurn: true });
			} catch {
				rootWakeGate.settled();
			}
		});
	};

	const ensureInboxActivation = async (ctx: ExtensionContext): Promise<InboxTarget | undefined> => {
		const sessionId = ctx.sessionManager.getSessionFile();
		if (!sessionId) return undefined;
		if (activeTarget?.sessionId === sessionId && listener) return activeTarget;
		if (activation) return activation;
		activation = (async () => {
			const root = await canonicalRoot(pi, ctx);
			if (!root) return undefined;
			const topology = await liveTopology(pi, ctx);
			let target: InboxTarget | undefined;
			if (topology?.index.sessionId === sessionId) {
				target = { kind: "index", sessionId, sourcePolicy: "root", routes: [] };
			} else {
				const source = await liveSource(pi, ctx);
				if (!source || !isDedicatedRootLabel(source.workspaceLabel)) return undefined;
				const routes = await resolveRootInboundRoutes(spoolRoot(root), source);
				if (routes.length === 0) return undefined;
				target = { kind: "root", sessionId, sourcePolicy: "registered-child", routes };
			}
			activeTarget = target;
			listener = await startWakeListener(sessionId, () => {
				void updateInboxWidget(pi, ctx, target!);
				queueInboxWake(ctx, target!);
			});
			await updateInboxWidget(pi, ctx, target);
			return target;
		})();
		try {
			return await activation;
		} finally {
			activation = undefined;
		}
	};

	const discardQuestionPublication = async (question: PendingQuestion): Promise<void> => {
		const publication = await question.publication;
		if (publication && question.ended) {
			await discardEvent(spoolRoot(publication.root), publication.targetSessionId, publication.eventId, publication.sourcePolicy);
		}
	};

	const scheduleCompactionContinuation = async (ctx: ExtensionContext, checkpoint: CompactionCheckpoint): Promise<void> => {
		const root = await canonicalRoot(pi, ctx);
		if (!root || path.resolve(ctx.cwd) !== checkpoint.worktreePath) return;
		const claimed = await claimCompactionContinuation(spoolRoot(root), checkpoint.sessionId);
		if (!claimed) return;
		pendingCompactionContinuations.add(checkpoint.id);
		try {
			pi.sendMessage({
				customType: COMPACTION_CONTINUATION_TYPE,
				content: `Supervised compaction completed. Continue exactly from durable checkpoint ${checkpoint.id}: ${checkpoint.nextAction}`,
				display: true,
				details: checkpoint,
			}, { deliverAs: "followUp", triggerTurn: true });
		} catch {
			pendingCompactionContinuations.delete(checkpoint.id);
			await recoverCompactionContinuation(spoolRoot(root), checkpoint.sessionId);
		}
	};

	pi.registerMessageRenderer<OrchestratorMessageDetails>(CUSTOM_TYPE, (message, _options, theme) => {
		const events = Array.isArray(message.details?.events) ? message.details.events : [];
		return {
			render: () => {
				const lines = [theme.bold(theme.fg("accent", "ORCHESTRATOR_EVENT"))];
				for (const event of events) {
					lines.push(theme.fg("dim", `${event.kind} · ${event.id} · ${event.source.workspaceLabel}/${event.source.paneId}`));
					lines.push(event.summary);
				}
				return lines;
			},
			invalidate() {},
		};
	});

	pi.on("session_start", async (_event, ctx) => {
		await ensureInboxActivation(ctx);
		const sessionId = ctx.sessionManager.getSessionFile();
		const root = await canonicalRoot(pi, ctx);
		if (!sessionId || !root) return;
		const checkpoint = await getCompactionCheckpoint(spoolRoot(root), sessionId);
		if (!checkpoint || path.resolve(ctx.cwd) !== checkpoint.worktreePath) return;
		if (checkpoint.state === "continuation-claimed") await recoverCompactionContinuation(spoolRoot(root), sessionId);
		const recovered = await getCompactionCheckpoint(spoolRoot(root), sessionId);
		if (recovered?.state === "compacted") await scheduleCompactionContinuation(ctx, recovered);
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
		activeTarget = undefined;
		activation = undefined;
		pendingQuestions.clear();
		activeTools.clear();
		if (ctx.hasUI) {
			ctx.ui.setWidget(INBOX_WIDGET, undefined);
			ctx.ui.setStatus(INBOX_WIDGET, undefined);
		}
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const target = await ensureInboxActivation(ctx);
		if (!target) return undefined;
		const root = await canonicalRoot(pi, ctx);
		if (!root) return undefined;
		const claims = await claimOutstanding(
			spoolRoot(root),
			target.sessionId,
			acknowledgeMessageEvents(pi, ctx, target),
			target.sourcePolicy,
			rootAuthorizer(target),
		);
		await updateInboxWidget(pi, ctx, target);
		const deliverable = await prepareAttachment(spoolRoot(root), target.sessionId, claims);
		if (deliverable.length === 0) return undefined;
		return {
			message: {
				customType: CUSTOM_TYPE,
				content: deliverable.map(({ event }) => formatAttachment(event, target.sourcePolicy)).join("\n\n"),
				display: true,
				details: { events: deliverable.map(({ event }) => event) } satisfies OrchestratorMessageDetails,
			},
		};
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (pendingCompactionContinuations.size === 0) return;
		const sessionId = ctx.sessionManager.getSessionFile();
		const root = await canonicalRoot(pi, ctx);
		if (!sessionId || !root) return;
		const checkpoint = await completeCompactionContinuation(spoolRoot(root), sessionId);
		if (checkpoint) pendingCompactionContinuations.delete(checkpoint.id);
	});

	pi.on("agent_settled", () => {
		rootWakeGate.settled();
	});

	pi.on("tool_execution_start", async (event, ctx) => {
		activeTools.add(event.toolCallId);
		if (event.toolName !== QUESTION_TOOL) return;
		const sessionId = ctx.sessionManager.getSessionFile();
		if (sessionId) pendingQuestions.set(event.toolCallId, { toolCallId: event.toolCallId, sessionId, ctx, activated: false, ended: false });
	});

	pi.events.on("rpiv:ask-user:prompt", (payload: unknown) => {
		const summary = summarizeAskUserPrompt(payload);
		if (!summary) return;
		const question = [...pendingQuestions.values()].find((candidate) => !candidate.activated && !candidate.ended);
		if (!question) return;
		question.activated = true;
		question.eventId = `question:${sessionKey(question.sessionId).slice(0, 24)}:${question.toolCallId}`;
		blocked.start(question.toolCallId, summary);
		question.publication = publishCallback(pi, question.ctx, { eventId: question.eventId, kind: "blocked", summary }).catch(() => undefined);
	});

	pi.on("tool_execution_end", async (event) => {
		activeTools.delete(event.toolCallId);
		if (event.toolName !== QUESTION_TOOL) return;
		const question = pendingQuestions.get(event.toolCallId);
		if (!question) return;
		question.ended = true;
		blocked.end(event.toolCallId);
		pendingQuestions.delete(event.toolCallId);
		await discardQuestionPublication(question);
	});

	pi.on("session_before_compact", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionFile();
		if (sessionId && supervisedCompactions.has(sessionId)) return undefined;
		if (ctx.hasUI) ctx.ui.notify("Compaction is supervised here. Use /supervised-compact with a durable checkpoint at an idle boundary.", "warning");
		return { cancel: true };
	});

	pi.on("session_compact", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionFile();
		const root = await canonicalRoot(pi, ctx);
		if (!sessionId || !root || !supervisedCompactions.delete(sessionId)) return;
		const checkpoint = await markCompactionCompacted(spoolRoot(root), sessionId);
		if (checkpoint) await scheduleCompactionContinuation(ctx, checkpoint);
	});

	pi.registerCommand("supervised-compact", {
		description: "Compact only after recording a durable idle-boundary continuation checkpoint as JSON.",
		handler: async (args, ctx) => {
			let input: { task?: unknown; validation?: unknown; nextAction?: unknown };
			try {
				input = JSON.parse(args) as { task?: unknown; validation?: unknown; nextAction?: unknown };
			} catch {
				ctx.ui.notify("Usage: /supervised-compact {\"task\":\"...\",\"validation\":\"...\",\"nextAction\":\"...\"}", "warning");
				return;
			}
			if (!ctx.isIdle() || ctx.hasPendingMessages() || activeTools.size > 0 || blocked.isActive) {
				ctx.ui.notify("Refusing compaction outside a safe idle boundary (active turn, queued work, tool, or open question).", "warning");
				return;
			}
			const sessionId = ctx.sessionManager.getSessionFile();
			const root = await canonicalRoot(pi, ctx);
			if (!sessionId || !root) {
				ctx.ui.notify("No durable Pi session or canonical worktree was available; compaction was not started.", "error");
				return;
			}
			const [branch, head, status, source] = await Promise.all([
				pi.exec("git", ["-C", ctx.cwd, "branch", "--show-current"]),
				pi.exec("git", ["-C", ctx.cwd, "rev-parse", "HEAD"]),
				pi.exec("git", ["-C", ctx.cwd, "status", "--porcelain"]),
				liveSource(pi, ctx),
			]);
			if (branch.code !== 0 || head.code !== 0 || status.code !== 0 || !source || typeof input.task !== "string" || typeof input.validation !== "string" || typeof input.nextAction !== "string") {
				ctx.ui.notify("Checkpoint fields and current git identity are required; compaction was not started.", "error");
				return;
			}
			const parentRoute = !isDedicatedRootLabel(source.workspaceLabel) ? await resolveChildPublicationRoute(spoolRoot(root), source) : undefined;
			const checkpoint: CompactionCheckpoint = {
				id: `compact:${sessionKey(sessionId).slice(0, 24)}:${Date.now()}`,
				sessionId,
				task: input.task,
				worktreePath: path.resolve(ctx.cwd),
				branch: branch.stdout.trim(),
				head: head.stdout.trim(),
				dirty: status.stdout.trim().length > 0,
				validation: input.validation,
				nextAction: input.nextAction,
				...(parentRoute ? { parentRouteId: parentRoute.id } : {}),
				createdAt: new Date().toISOString(),
				state: "prepared",
			};
			try {
				await writeCompactionCheckpoint(spoolRoot(root), checkpoint);
				supervisedCompactions.add(sessionId);
				ctx.compact({
					customInstructions: "Preserve the durable supervised-compaction checkpoint, exact git state, validation status, and next action.",
					onError: () => {
						supervisedCompactions.delete(sessionId);
						ctx.ui.notify("Compaction failed; the durable checkpoint remains for explicit recovery.", "error");
					},
				});
			} catch (error) {
				ctx.ui.notify(`Compaction was not started: ${error instanceof Error ? error.message : "checkpoint failure"}`, "error");
			}
		},
	});

	pi.registerTool({
		name: "register_orchestration_child_route",
		label: "Register Child Callback Route",
		description: "Register one exact child Pi session/workspace/pane/worktree callback route to this dedicated root.",
		parameters: Type.Object({
			childSessionId: Type.String(),
			childWorkspaceId: Type.String(),
			childWorkspaceLabel: Type.String(),
			childPaneId: Type.String(),
			childWorktreePath: Type.String(),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const [root, sessionId, metadata] = await Promise.all([canonicalRoot(pi, ctx), Promise.resolve(ctx.sessionManager.getSessionFile()), herdrMetadata(pi)]);
			if (!root || !sessionId || !metadata) return { content: [{ type: "text", text: "No verified root/Herdr route was available; child was not registered." }], details: { registered: false } };
			const route = resolveChildRouteRegistration(metadata, metadata, sessionId, {
				workspaceId: params.childWorkspaceId,
				workspaceLabel: params.childWorkspaceLabel,
				paneId: params.childPaneId,
				worktreePath: params.childWorktreePath,
				sessionId: params.childSessionId,
			});
			if (!route) return { content: [{ type: "text", text: "Child route was absent, stale, ambiguous, or this session is not a dedicated root." }], details: { registered: false } };
			const status = await registerChildRoute(spoolRoot(root), route);
			await ensureInboxActivation(ctx);
			return { content: [{ type: "text", text: `Registered child callback route ${status}.` }], details: { registered: true, status, routeId: route.id } };
		},
	});

	pi.registerTool({
		name: "publish_orchestrator_event",
		label: "Publish Orchestrator Result",
		description: "Persist a verified dedicated-root RESULT for the live index session. Use a stable eventId; delivery is attach-next-natural-user-turn and never edits the user's editor.",
		promptSnippet: "persist a dedicated-root RESULT for the index session",
		promptGuidelines: [
			"Only a Herdr workspace labeled *-root may publish through publish_orchestrator_event.",
			"Use publish_orchestrator_event for every verified final root RESULT; validated RPIV lifecycle publishes genuine blocked questions.",
		],
		parameters: Type.Object({
			eventId: Type.String({ description: "Stable id for this logical RESULT; retries must reuse it." }),
			summary: Type.String({ description: "Concise factual summary for the next natural main turn." }),
			resultLocation: Type.Optional(Type.String({ description: "Durable RESULT file or PR/commit location, if applicable." })),
			resultPayload: Type.Optional(Type.String({ description: "Small durable RESULT payload, if applicable." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const published = await publishRoot(pi, ctx, {
				eventId: params.eventId,
				kind: "result",
				summary: params.summary,
				durableResult: params.resultLocation || params.resultPayload ? { location: params.resultLocation, payload: params.resultPayload } : undefined,
			});
			if (!published || published.status === "cancelled" || published.status === "retry") {
				return { content: [{ type: "text", text: !published ? "No verified *-root → index route was available; RESULT was not published." : `Orchestrator RESULT ${published.status}; retry this stable eventId later.` }], details: { published: false, ...(published ? { status: published.status, targetSessionId: published.targetSessionId } : {}) } };
			}
			return { content: [{ type: "text", text: `Orchestrator RESULT ${published.status}; index wake was best-effort only.` }], details: { published: true, status: published.status, targetSessionId: published.targetSessionId } };
		},
	});

	pi.registerTool({
		name: "publish_child_orchestrator_event",
		label: "Publish Child Result",
		description: "Publish a verified implementation-child RESULT only through its one exact pre-registered dedicated-root callback route.",
		parameters: Type.Object({
			eventId: Type.String(),
			summary: Type.String(),
			resultLocation: Type.Optional(Type.String()),
			resultPayload: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const published = await publishChild(pi, ctx, {
				eventId: params.eventId,
				kind: "result",
				summary: params.summary,
				durableResult: params.resultLocation || params.resultPayload ? { location: params.resultLocation, payload: params.resultPayload } : undefined,
			});
			if (!published || published.status === "cancelled" || published.status === "retry") {
				return { content: [{ type: "text", text: !published ? "No exact registered child → root route was available; RESULT was not published." : `Child RESULT ${published.status}; retry this stable eventId later.` }], details: { published: false } };
			}
			return { content: [{ type: "text", text: `Child RESULT ${published.status}; root wake was best-effort only.` }], details: { published: true, status: published.status, targetSessionId: published.targetSessionId } };
		},
	});
}
