import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

export type OrchestratorEventKind = "result" | "blocked";

export interface OrchestratorProvenance {
	workspaceId: string;
	paneId: string;
	sessionId: string;
}

export interface OrchestratorEvent {
	id: string;
	kind: OrchestratorEventKind;
	source: OrchestratorProvenance;
	targetSessionId: string;
	summary: string;
	timestamp: string;
	durableResult?: {
		location?: string;
		payload?: string;
	};
}

export interface ClaimedEvent {
	event: OrchestratorEvent;
	claimPath: string;
}

export interface HerdrWorkspace {
	workspace_id: string;
	label: string;
	focused: boolean;
	active_tab_id?: string;
}

export interface HerdrPane {
	workspace_id: string;
	pane_id: string;
	tab_id?: string;
	agent?: string;
	agent_status?: string;
	agent_session?: {
		agent?: string;
		kind?: string;
		source?: string;
		value?: string;
	};
}

export interface IndexTarget {
	workspaceId: string;
	paneId: string;
	sessionId: string;
	focused: boolean;
	status?: string;
}

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/;

/** Return a stable, filesystem-safe namespace for an opaque Pi session identity. */
export function sessionKey(sessionId: string): string {
	return createHash("sha256").update(sessionId).digest("hex");
}

/** Derive the shared project-local spool root from the canonical worktree. */
export function spoolRoot(canonicalRoot: string): string {
	return path.join(canonicalRoot, ".pi", "orchestration-inbox", "v1");
}

export function sessionDirectory(root: string, sessionId: string): string {
	return path.join(root, sessionKey(sessionId));
}

function pendingDirectory(root: string, sessionId: string): string {
	return path.join(sessionDirectory(root, sessionId), "pending");
}

function claimsDirectory(root: string, sessionId: string): string {
	return path.join(sessionDirectory(root, sessionId), "claims");
}

async function privateDirectory(directory: string): Promise<void> {
	await fs.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
	await fs.chmod(directory, DIRECTORY_MODE);
}

async function privateFile(file: string, body: string): Promise<void> {
	const handle = await fs.open(file, "wx", FILE_MODE);
	try {
		await handle.writeFile(body, "utf8");
		await handle.sync();
	} finally {
		await handle.close();
	}
}

function eventFilename(eventId: string): string {
	if (!EVENT_ID.test(eventId)) throw new Error("Invalid orchestration event id");
	return `${eventId}.json`;
}

function parseEvent(raw: string, expectedSessionId: string): OrchestratorEvent | undefined {
	try {
		const value = JSON.parse(raw) as Partial<OrchestratorEvent>;
		if (
			!value ||
			!EVENT_ID.test(value.id ?? "") ||
			(value.kind !== "result" && value.kind !== "blocked") ||
			value.targetSessionId !== expectedSessionId ||
			typeof value.summary !== "string" ||
			typeof value.timestamp !== "string" ||
			!value.source ||
			typeof value.source.workspaceId !== "string" ||
			typeof value.source.paneId !== "string" ||
			typeof value.source.sessionId !== "string"
		) {
			return undefined;
		}
		return value as OrchestratorEvent;
	} catch {
		return undefined;
	}
}

async function listJson(directory: string, sessionId: string): Promise<Array<{ file: string; event: OrchestratorEvent }>> {
	try {
		const names = (await fs.readdir(directory)).filter((name) => name.endsWith(".json")).sort();
		const values = await Promise.all(
			names.map(async (name) => {
				const file = path.join(directory, name);
				const event = parseEvent(await fs.readFile(file, "utf8"), sessionId);
				return event ? { file, event } : undefined;
			}),
		);
		return values.filter((value): value is { file: string; event: OrchestratorEvent } => value !== undefined);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

/**
 * Persist an event before any best-effort wake. `link` makes duplicate publication by
 * stable id a no-op without ever replacing an existing event.
 */
export async function publishEvent(root: string, event: OrchestratorEvent): Promise<"published" | "duplicate"> {
	const pending = pendingDirectory(root, event.targetSessionId);
	await privateDirectory(pending);
	await privateDirectory(claimsDirectory(root, event.targetSessionId));

	const filename = eventFilename(event.id);
	const target = path.join(pending, filename);
	const temporary = path.join(pending, `.${filename}.${randomUUID()}.tmp`);
	const body = `${JSON.stringify(event)}\n`;
	await privateFile(temporary, body);
	try {
		await fs.link(temporary, target);
		return "published";
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return "duplicate";
		throw error;
	} finally {
		await fs.unlink(temporary).catch(() => undefined);
	}
}

/** Delete already-persisted delivery ids from either pending or claimed state. */
export async function acknowledgeDelivered(root: string, sessionId: string, deliveredIds: ReadonlySet<string>): Promise<void> {
	if (deliveredIds.size === 0) return;
	for (const directory of [pendingDirectory(root, sessionId), claimsDirectory(root, sessionId)]) {
		for (const { file, event } of await listJson(directory, sessionId)) {
			if (deliveredIds.has(event.id)) await fs.unlink(file).catch(() => undefined);
		}
	}
}

/**
 * Claims left by a crash are deliberately returned to pending. A later natural turn
 * either recognizes the event's persisted custom message and acknowledges it, or
 * delivers it again: at-least-once without silent loss.
 */
export async function reclaimClaims(root: string, sessionId: string): Promise<void> {
	const pending = pendingDirectory(root, sessionId);
	const claims = claimsDirectory(root, sessionId);
	await privateDirectory(pending);
	await privateDirectory(claims);
	for (const { file, event } of await listJson(claims, sessionId)) {
		const target = path.join(pending, eventFilename(event.id));
		try {
			// `rename` can replace an existing file on POSIX; link first so a concurrent
			// duplicate publication never overwrites the pending event.
			await fs.link(file, target);
			await fs.unlink(file);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") {
				await fs.unlink(file).catch(() => undefined);
				continue;
			}
			throw error;
		}
	}
}

/** Atomically move all outstanding events into this turn's claims directory. */
export async function claimOutstanding(root: string, sessionId: string, deliveredIds: ReadonlySet<string>): Promise<ClaimedEvent[]> {
	await acknowledgeDelivered(root, sessionId, deliveredIds);
	await reclaimClaims(root, sessionId);
	const pending = pendingDirectory(root, sessionId);
	const claims = claimsDirectory(root, sessionId);
	const claimed: ClaimedEvent[] = [];
	for (const { file, event } of await listJson(pending, sessionId)) {
		const claimPath = path.join(claims, `${event.id}.${randomUUID()}.json`);
		try {
			await fs.rename(file, claimPath);
			claimed.push({ event, claimPath });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return claimed;
}

export async function outstandingCount(root: string, sessionId: string): Promise<number> {
	return (await listJson(pendingDirectory(root, sessionId), sessionId)).length + (await listJson(claimsDirectory(root, sessionId), sessionId)).length;
}

/** A per-session, private Unix-socket location short enough for macOS socket limits. */
export function wakeSocketPath(sessionId: string): string {
	return path.join(os.tmpdir(), "index-orch", `${sessionKey(sessionId).slice(0, 32)}.sock`);
}

export async function startWakeListener(sessionId: string, onWake: () => void): Promise<{ socketPath: string; close: () => Promise<void> }> {
	const socketPath = wakeSocketPath(sessionId);
	await privateDirectory(path.dirname(socketPath));
	await fs.unlink(socketPath).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "ENOENT") throw error;
	});
	const server = net.createServer((socket) => {
		let notified = false;
		const notify = () => {
			if (notified) return;
			notified = true;
			onWake();
		};
		socket.once("data", notify);
		socket.once("end", notify);
		socket.resume();
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(socketPath, () => {
			server.off("error", reject);
			resolve();
		});
	});
	await fs.chmod(socketPath, FILE_MODE);
	return {
		socketPath,
		close: async () => {
			await new Promise<void>((resolve) => server.close(() => resolve()));
			await fs.unlink(socketPath).catch(() => undefined);
		},
	};
}

/** Make one non-blocking, best-effort wake attempt; persistence never depends on it. */
export function wakeOnce(sessionId: string): void {
	try {
		const socket = net.createConnection(wakeSocketPath(sessionId));
		const finish = () => socket.destroy();
		socket.once("connect", () => socket.end("wake\n"));
		socket.once("error", finish);
		socket.once("close", finish);
	} catch {
		// The spool is already durable; a wake failure is intentionally invisible.
	}
}

/** Parse Herdr's JSON-RPC-like CLI envelope without terminal/screen scraping. */
export function parseHerdrResult(stdout: string): unknown {
	const value = JSON.parse(stdout) as { result?: unknown };
	return value.result;
}

/** Resolve the unique live `index` session through reported workspace/pane metadata. */
export function resolveIndexTarget(workspaceResult: unknown, paneResult: unknown): IndexTarget | undefined {
	const workspaces = (workspaceResult as { workspaces?: HerdrWorkspace[] }).workspaces;
	const panes = (paneResult as { panes?: HerdrPane[] }).panes;
	if (!Array.isArray(workspaces) || !Array.isArray(panes)) return undefined;
	const matches = workspaces.filter((workspace) => workspace.label === "index");
	if (matches.length !== 1) return undefined;
	const workspace = matches[0];
	const panesInWorkspace = panes.filter(
		(pane) =>
			pane.workspace_id === workspace.workspace_id &&
			pane.agent === "pi" &&
			typeof pane.agent_session?.value === "string" &&
			(!workspace.active_tab_id || pane.tab_id === workspace.active_tab_id),
	);
	if (panesInWorkspace.length !== 1) return undefined;
	const pane = panesInWorkspace[0];
	return {
		workspaceId: workspace.workspace_id,
		paneId: pane.pane_id,
		sessionId: pane.agent_session!.value!,
		focused: workspace.focused,
		status: pane.agent_status,
	};
}

/** Collect balanced blocked lifecycle transitions for nested question tools. */
export class BlockedQuestionBridge {
	private readonly active = new Set<string>();

	public constructor(private readonly emit: (state: { active: boolean; label?: string }) => void) {}

	public start(toolCallId: string, label: string): void {
		if (this.active.has(toolCallId)) return;
		const wasEmpty = this.active.size === 0;
		this.active.add(toolCallId);
		if (wasEmpty) this.emit({ active: true, label });
	}

	public end(toolCallId: string): void {
		if (!this.active.delete(toolCallId) || this.active.size > 0) return;
		this.emit({ active: false });
	}

	public shutdown(): void {
		if (this.active.size === 0) return;
		this.active.clear();
		this.emit({ active: false });
	}
}
