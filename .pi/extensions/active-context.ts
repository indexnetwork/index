import fs from "node:fs/promises";
import os from "node:os";
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

// ── Subscription usage (Claude / Codex / Kimi scoped OAuth providers) ──

interface UsageWindow {
	label: string;
	percent: number;
	resetsAt?: Date;
}

interface ProviderUsage {
	windows?: UsageWindow[];
	error?: string;
}

const USAGE_PROVIDERS = [
	{ authKey: "anthropic", name: "Claude" },
	{ authKey: "openai-codex", name: "Codex" },
	{ authKey: "kimi-coding", name: "Kimi" },
] as const;

const USAGE_POLL_MS = 5 * 60_000; // Claude's usage endpoint asks for >=180s between polls

const usageByProvider = new Map<string, ProviderUsage>();
let usageTimer: ReturnType<typeof setInterval> | undefined;
let usageRefreshing = false;

interface OAuthEntry {
	access?: string;
	accountId?: string;
}

/** Pi keeps provider OAuth tokens fresh in auth.json; re-read it on every poll. */
async function readAuthFile(): Promise<Record<string, OAuthEntry>> {
	const file = path.join(os.homedir(), ".pi", "agent", "auth.json");
	return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, OAuthEntry>;
}

function windowLabel(seconds: number): string {
	return seconds <= 6 * 3600 ? `${Math.round(seconds / 3600)}h` : `${Math.round(seconds / 86400)}d`;
}

async function getJson(url: string, headers: Record<string, string>): Promise<unknown> {
	const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
	if (!res.ok) throw new Error(`HTTP ${res.status}`);
	return res.json();
}

/** Claude Pro/Max: undocumented endpoint behind Claude Code's /usage. */
async function fetchClaudeUsage(access: string): Promise<UsageWindow[]> {
	const body = (await getJson("https://api.anthropic.com/api/oauth/usage", {
		Authorization: `Bearer ${access}`,
		"anthropic-beta": "oauth-2025-04-20",
		"User-Agent": "claude-code/2.0.14",
	})) as {
		limits?: {
			kind?: string;
			percent?: number;
			resets_at?: string;
			scope?: { model?: { display_name?: string | null } | null } | null;
		}[];
	};
	const windows: UsageWindow[] = [];
	for (const limit of body.limits ?? []) {
		if (typeof limit.percent !== "number") continue;
		const resetsAt = limit.resets_at ? new Date(limit.resets_at) : undefined;
		if (limit.kind === "session") windows.push({ label: "5h", percent: limit.percent, resetsAt });
		else if (limit.kind === "weekly_all") windows.push({ label: "7d", percent: limit.percent, resetsAt });
		else if (limit.kind === "weekly_scoped") {
			const scoped = limit.scope?.model?.display_name;
			windows.push({ label: scoped ? `7d·${scoped}` : "7d·scoped", percent: limit.percent, resetsAt });
		}
	}
	return windows;
}

interface CodexWindow {
	used_percent?: number;
	limit_window_seconds?: number;
	reset_at?: number;
}

interface CodexRateLimit {
	primary_window?: CodexWindow | null;
	secondary_window?: CodexWindow | null;
}

function codexWindows(rateLimit: CodexRateLimit | undefined, suffix = ""): UsageWindow[] {
	const windows: UsageWindow[] = [];
	for (const w of [rateLimit?.primary_window, rateLimit?.secondary_window]) {
		if (!w || typeof w.used_percent !== "number") continue;
		windows.push({
			label: `${windowLabel(w.limit_window_seconds ?? 0)}${suffix}`,
			percent: w.used_percent,
			resetsAt: w.reset_at ? new Date(w.reset_at * 1000) : undefined,
		});
	}
	return windows;
}

/** Codex on ChatGPT plans: private backend endpoint the CLI's /status uses. */
async function fetchCodexUsage(access: string, accountId: string | undefined): Promise<UsageWindow[]> {
	const body = (await getJson("https://chatgpt.com/backend-api/wham/usage", {
		Authorization: `Bearer ${access}`,
		...(accountId ? { "ChatGPT-Account-Id": accountId } : {}),
		Origin: "https://chatgpt.com",
	})) as {
		rate_limit?: CodexRateLimit;
		additional_rate_limits?: { limit_name?: string; rate_limit?: CodexRateLimit }[];
	};
	const windows = codexWindows(body.rate_limit);
	for (const extra of body.additional_rate_limits ?? []) {
		const short = (extra.limit_name ?? "").replace(/^GPT-[\d.]+-Codex-?/i, "") || "extra";
		windows.push(...codexWindows(extra.rate_limit, `·${short}`).filter((w) => w.percent > 0));
	}
	return windows;
}

interface KimiDetail {
	limit?: string;
	used?: string;
	resetTime?: string;
}

function kimiPercent(detail: KimiDetail | undefined): number | undefined {
	const limit = Number(detail?.limit);
	const used = Number(detail?.used);
	if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return undefined;
	return Math.round((used / limit) * 100);
}

/** Kimi Code plan: coding-gateway usage endpoint (accepts the OAuth token). */
async function fetchKimiUsage(access: string): Promise<UsageWindow[]> {
	const body = (await getJson("https://api.kimi.com/coding/v1/usages", {
		Authorization: `Bearer ${access}`,
		"User-Agent": "KimiCLI/1.6",
	})) as {
		usage?: KimiDetail;
		limits?: { window?: { duration?: number; timeUnit?: string }; detail?: KimiDetail }[];
	};
	const windows: UsageWindow[] = [];
	for (const entry of body.limits ?? []) {
		const percent = kimiPercent(entry.detail);
		if (percent === undefined) continue;
		const unit = entry.window?.timeUnit;
		const minutes = (entry.window?.duration ?? 0) * (unit === "TIME_UNIT_HOUR" ? 60 : unit === "TIME_UNIT_DAY" ? 1440 : 1);
		windows.push({
			label: windowLabel(minutes * 60),
			percent,
			resetsAt: entry.detail?.resetTime ? new Date(entry.detail.resetTime) : undefined,
		});
	}
	const weekly = kimiPercent(body.usage);
	if (weekly !== undefined) {
		windows.push({
			label: "7d",
			percent: weekly,
			resetsAt: body.usage?.resetTime ? new Date(body.usage.resetTime) : undefined,
		});
	}
	return windows;
}

async function refreshUsage(): Promise<void> {
	if (usageRefreshing) return;
	usageRefreshing = true;
	try {
		let auth: Record<string, OAuthEntry>;
		try {
			auth = await readAuthFile();
		} catch {
			return;
		}
		await Promise.all(
			USAGE_PROVIDERS.map(async ({ authKey }) => {
				const entry = auth[authKey];
				if (!entry?.access) {
					usageByProvider.delete(authKey);
					return;
				}
				try {
					const windows =
						authKey === "anthropic"
							? await fetchClaudeUsage(entry.access)
							: authKey === "openai-codex"
								? await fetchCodexUsage(entry.access, entry.accountId)
								: await fetchKimiUsage(entry.access);
					usageByProvider.set(authKey, { windows });
				} catch (error) {
					const prior = usageByProvider.get(authKey);
					usageByProvider.set(authKey, { windows: prior?.windows, error: String(error) });
				}
			}),
		);
		requestRender?.();
	} finally {
		usageRefreshing = false;
	}
}

function startUsagePolling(): void {
	void refreshUsage();
	if (usageTimer) return;
	usageTimer = setInterval(() => void refreshUsage(), USAGE_POLL_MS);
	(usageTimer as unknown as { unref?: () => void }).unref?.();
}

function formatReset(date: Date): string {
	const ms = date.getTime() - Date.now();
	if (ms <= 0) return "now";
	const hours = Math.floor(ms / 3_600_000);
	const minutes = Math.round((ms % 3_600_000) / 60_000);
	if (hours >= 48) return `${Math.round(hours / 24)}d`;
	return hours > 0 ? `${hours}h${minutes.toString().padStart(2, "0")}m` : `${minutes}m`;
}

export function formatGoalFooterStatus(status: string | undefined): string | undefined {
	const compact = status?.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
	return compact ? `🏁 ${compact}` : undefined;
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

				// ── Line 2 left: work context — PR · Linear (always visible) · Goal (when status exists) ──
				const prPart = `🔀 ${active.pr !== undefined ? theme.bold(accent(`PR#${active.pr}`)) : dim("—")}`;
				const issuePart = `🎯 ${active.issue ? theme.bold(accent(active.issue)) : dim("—")}`;
				const goalPart = formatGoalFooterStatus(footerData.getExtensionStatuses().get("goal"));
				const workContextParts = [prPart, issuePart];
				if (goalPart) workContextParts.push(theme.bold(accent(goalPart)));

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

				// ── Line 3: subscription usage — Claude · Codex · Kimi ──
				const usageParts: string[] = [];
				for (const { authKey, name } of USAGE_PROVIDERS) {
					const state = usageByProvider.get(authKey);
					if (!state) continue;
					const label = theme.bold(dim(name));
					if (!state.windows || state.windows.length === 0) {
						usageParts.push(`${label} ${dim(state.error ? "✗" : "…")}`);
						continue;
					}
					const rendered = state.windows
						.map((w) => {
							const pct = `${w.percent}%`;
							const colored = w.percent >= 90 ? theme.fg("error", pct) : w.percent >= 70 ? theme.fg("warning", pct) : pct;
							return `${dim(w.label)} ${colored}`;
						})
						.join(dim(" · "));
					usageParts.push(`${label} ${rendered}${state.error ? dim(" ✗") : ""}`);
				}

				const lines = [
					composeLine(placeParts.join("  "), sessionPart, width),
					composeLine(workContextParts.join("  "), modelParts.join("  "), width),
				];
				if (usageParts.length > 0) lines.push(truncateToWidth(usageParts.join("   "), width, "…"));
				return lines;
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
		if (ctx.mode === "tui") {
			installFooter(pi, ctx);
			startUsagePolling();
		}
		await prefillPrFromBranch(pi, ctx.cwd);
	});

	pi.registerCommand("quota", {
		description: "Show subscription usage for Claude / Codex / Kimi with reset times (refetches)",
		handler: async (_args, ctx) => {
			await refreshUsage();
			const lines: string[] = [];
			for (const { authKey, name } of USAGE_PROVIDERS) {
				const state = usageByProvider.get(authKey);
				if (!state) continue;
				if (!state.windows || state.windows.length === 0) {
					lines.push(`${name}: ${state.error ?? "no data"}`);
					continue;
				}
				const detail = state.windows
					.map((w) => `${w.label} ${w.percent}%${w.resetsAt ? ` (resets ${formatReset(w.resetsAt)})` : ""}`)
					.join(", ");
				lines.push(`${name}: ${detail}${state.error ? ` [stale: ${state.error}]` : ""}`);
			}
			ctx.ui.notify(lines.length > 0 ? lines.join(" | ") : "No subscription usage data (check ~/.pi/agent/auth.json)", "info");
		},
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
