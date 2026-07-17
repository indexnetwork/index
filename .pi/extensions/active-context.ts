import path from "node:path";

import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "active-context";
const AUTO_NAME_ENABLED = process.env.PI_WORKTREE_AUTO_NAME !== "0";

interface ActiveContext {
	pr?: number;
	issue?: string;
}

/** Current footer context for this session. */
const active: ActiveContext = {};

/** Last UI-capable context, used to re-render the status from tool/command handlers. */
let lastCtx: ExtensionContext | undefined;

function normalizeIssue(raw: string): string {
	const trimmed = raw.trim();
	if (/^\d+$/.test(trimmed)) return `IND-${trimmed}`;
	return trimmed.toUpperCase();
}

function render(ctx: ExtensionContext | undefined): void {
	if (!ctx?.hasUI) return;
	const parts: string[] = [];
	if (active.pr !== undefined) parts.push(ctx.ui.theme.bold(ctx.ui.theme.fg("accent", `PR#${active.pr}`)));
	if (active.issue) parts.push(ctx.ui.theme.bold(ctx.ui.theme.fg("accent", active.issue)));
	ctx.ui.setStatus(STATUS_KEY, parts.length > 0 ? `${ctx.ui.theme.fg("muted", "◆")} ${parts.join(ctx.ui.theme.fg("muted", " · "))}` : undefined);
}

function describe(): string {
	const parts: string[] = [];
	if (active.pr !== undefined) parts.push(`PR #${active.pr}`);
	if (active.issue) parts.push(active.issue);
	return parts.length > 0 ? parts.join(" • ") : "(empty)";
}

function update(patch: { pr?: number | null; issue?: string | null }): void {
	if (patch.pr !== undefined) active.pr = patch.pr === null ? undefined : patch.pr;
	if (patch.issue !== undefined) active.issue = patch.issue === null ? undefined : normalizeIssue(patch.issue);
	render(lastCtx);
}

/** Best-effort PR prefill from the current branch's open GitHub PR. */
async function prefillPrFromBranch(pi: ExtensionAPI, cwd: string): Promise<void> {
	if (active.pr !== undefined) return;
	const result = await pi.exec("gh", ["pr", "view", "--json", "number", "-q", ".number"], { cwd, timeout: 4000 });
	if (result.code !== 0) return;
	const pr = Number.parseInt(result.stdout.trim(), 10);
	if (Number.isFinite(pr)) {
		active.pr = pr;
	}
}

/** Name linked-worktree sessions after the worktree folder (no footer label). */
async function autoNameWorktreeSession(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!AUTO_NAME_ENABLED || pi.getSessionName()) return;
	const topLevel = await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--show-toplevel"], { timeout: 5000 });
	const gitDir = await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--absolute-git-dir"], { timeout: 5000 });
	const commonDir = await pi.exec("git", ["-C", ctx.cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"], { timeout: 5000 });
	if (topLevel.code !== 0 || gitDir.code !== 0 || commonDir.code !== 0) return;
	if (path.resolve(gitDir.stdout.trim()) === path.resolve(commonDir.stdout.trim())) return; // not a linked worktree
	const label = path.basename(topLevel.stdout.trim());
	if (label) pi.setSessionName(label);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await autoNameWorktreeSession(pi, ctx);
		if (!ctx.hasUI) return;
		lastCtx = ctx;
		await prefillPrFromBranch(pi, ctx.cwd);
		render(ctx);
	});

	pi.registerTool({
		name: "set_active_context",
		label: "Set Active Context",
		description:
			"Set or clear the active GitHub PR number and Linear issue code shown in the footer status bar. Pass null for a field to clear it; omit a field to leave it unchanged.",
		promptSnippet: "set or clear the compact active PR / Linear issue footer badge",
		promptGuidelines: [
			"Use set_active_context when you start, switch, or finish work tied to a specific GitHub PR or Linear issue (e.g. IND-123) so the footer status stays accurate.",
			"Use set_active_context with a field set to null when that PR is merged/closed or that issue is done, so stale context is cleared from the footer.",
		],
		parameters: Type.Object({
			pr: Type.Optional(
				Type.Union([Type.Number(), Type.Null()], {
					description: "Active GitHub PR number (e.g. 1234), or null to clear it.",
				}),
			),
			issue: Type.Optional(
				Type.Union([Type.String(), Type.Null()], {
					description: "Active Linear issue code (e.g. IND-123, IND-1234). Bare numbers are treated as IND-<n>. Null clears it.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (ctx.hasUI) lastCtx = ctx;
			update({ pr: params.pr, issue: params.issue });
			const text = `Active context: ${describe()}`;
			return { content: [{ type: "text", text }], details: { ...active } };
		},
	});

	pi.registerCommand("context", {
		description: "Show or set the active PR / Linear footer badge: /context [pr <n|->] [issue <code|->] | /context clear",
		handler: async (args, ctx) => {
			lastCtx = ctx;
			const tokens = args.trim().split(/\s+/).filter(Boolean);
			if (tokens.length === 0) {
				ctx.ui.notify(`Active context: ${describe()}`, "info");
				return;
			}
			if (tokens.length === 1 && tokens[0] === "clear") {
				update({ pr: null, issue: null });
				ctx.ui.notify("Active context cleared", "info");
				return;
			}
			const patch: { pr?: number | null; issue?: string | null } = {};
			for (let i = 0; i < tokens.length; i += 2) {
				const key = tokens[i];
				const value = tokens[i + 1];
				if (value === undefined || (key !== "pr" && key !== "issue")) {
					ctx.ui.notify("Usage: /context [pr <n|->] [issue <code|->] | /context clear", "error");
					return;
				}
				if (key === "pr") {
					if (value === "-") {
						patch.pr = null;
					} else {
						const pr = Number.parseInt(value.replace(/^#/, ""), 10);
						if (!Number.isFinite(pr)) {
							ctx.ui.notify(`Invalid PR number: ${value}`, "error");
							return;
						}
						patch.pr = pr;
					}
				} else {
					patch.issue = value === "-" ? null : value;
				}
			}
			update(patch);
			ctx.ui.notify(`Active context: ${describe()}`, "info");
		},
	});
}
