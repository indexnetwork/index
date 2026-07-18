import path from "node:path";

import { Type } from "typebox";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const AUTO_NAME_ENABLED = process.env.PI_WORKTREE_AUTO_NAME !== "0";

interface ActiveContext {
	pr?: number;
	issue?: string;
}

/** Current PR / Linear context for this session. */
const active: ActiveContext = {};

/** Re-render hook, set while the custom footer is mounted. */
let requestRender: (() => void) | undefined;

function normalizeIssue(raw: string): string {
	const trimmed = raw.trim();
	if (/^\d+$/.test(trimmed)) return `IND-${trimmed}`;
	return trimmed.toUpperCase();
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
	requestRender?.();
}

function formatTokens(count: number): string {
	if (count < 1000) return `${count}`;
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Replace the home-directory prefix with ~. */
function shortenPath(cwd: string): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && (cwd === home || cwd.startsWith(home + path.sep))) return `~${cwd.slice(home.length)}`;
	return cwd;
}

/** Left + right on one line: right-aligned when it fits, truncated otherwise. */
function composeLine(left: string, right: string, width: number): string {
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	if (leftWidth + 2 + rightWidth <= width) {
		return left + " ".repeat(width - leftWidth - rightWidth) + right;
	}
	return truncateToWidth(`${left}  ${right}`, width, "…");
}

/** Install the fully custom footer (replaces the built-in one). */
function installFooter(pi: ExtensionAPI, ctx: ExtensionContext): void {
	ctx.ui.setFooter((tui, theme, footerData) => {
		const unsubscribeBranch = footerData.onBranchChange(() => tui.requestRender());
		requestRender = () => tui.requestRender();

		const dim = (s: string) => theme.fg("dim", s);
		const accent = (s: string) => theme.fg("accent", s);

		return {
			dispose() {
				unsubscribeBranch();
				requestRender = undefined;
			},
			invalidate() {},
			render(width: number): string[] {
				// ── Line 1: place — folder · branch · session name ──
				const cwd = shortenPath(ctx.sessionManager.getCwd());
				const branch = footerData.getGitBranch();
				const sessionName = ctx.sessionManager.getSessionName();

				const placeParts = [`📁 ${dim(cwd)}`];
				if (branch) placeParts.push(`🌿 ${dim(branch)}`);
				const sessionPart = `💬 ${sessionName ? accent(sessionName) : dim("unnamed")}`;

				// ── Line 2 left: work context — PR · Linear (always visible) ──
				const prPart = `🔀 ${active.pr !== undefined ? theme.bold(accent(`PR#${active.pr}`)) : dim("—")}`;
				const issuePart = `🎯 ${active.issue ? theme.bold(accent(active.issue)) : dim("—")}`;

				// ── Line 2 right: model — model · thinking · cost · context ──
				let cost = 0;
				for (const entry of ctx.sessionManager.getEntries()) {
					if (entry.type === "message" && entry.message.role === "assistant") {
						const usage = (entry.message as { usage?: { cost?: { total?: number } } }).usage;
						cost += usage?.cost?.total ?? 0;
					}
				}

				const modelParts = [`🤖 ${dim(ctx.model?.id ?? "no-model")}`];
				if (ctx.model?.reasoning) modelParts.push(`🧠 ${dim(pi.getThinkingLevel())}`);
				modelParts.push(`💰 ${dim(`$${cost.toFixed(2)}`)}`);

				const usage = ctx.getContextUsage();
				if (usage) {
					const percent = usage.percent;
					const display = `${percent === null ? "?" : `${percent.toFixed(0)}%`}/${formatTokens(usage.contextWindow)}`;
					const colored =
						percent !== null && percent > 90
							? theme.fg("error", display)
							: percent !== null && percent > 70
								? theme.fg("warning", display)
								: dim(display);
					modelParts.push(`📊 ${colored}`);
				}

				return [
					composeLine(placeParts.join("  "), sessionPart, width),
					composeLine(`${prPart}  ${issuePart}`, modelParts.join("  "), width),
				];
			},
		};
	});
}

/** Best-effort PR prefill from the current branch's open GitHub PR. */
async function prefillPrFromBranch(pi: ExtensionAPI, cwd: string): Promise<void> {
	if (active.pr !== undefined) return;
	const result = await pi.exec("gh", ["pr", "view", "--json", "number", "-q", ".number"], { cwd, timeout: 4000 });
	if (result.code !== 0) return;
	const pr = Number.parseInt(result.stdout.trim(), 10);
	if (Number.isFinite(pr)) {
		active.pr = pr;
		requestRender?.();
	}
}

/** Name linked-worktree sessions after the worktree folder. */
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
		if (ctx.mode === "tui") installFooter(pi, ctx);
		await prefillPrFromBranch(pi, ctx.cwd);
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
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			update({ pr: params.pr, issue: params.issue });
			const text = `Active context: ${describe()}`;
			return { content: [{ type: "text", text }], details: { ...active } };
		},
	});

	pi.registerCommand("context", {
		description: "Show or set the active PR / Linear footer badge: /context [pr <n|->] [issue <code|->] | /context clear",
		handler: async (args, ctx) => {
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
