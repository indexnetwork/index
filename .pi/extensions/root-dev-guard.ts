import { execSync } from "node:child_process";
import path from "node:path";

import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@earendil-works/pi-coding-agent";

/**
 * Resolve the canonical (main) worktree root.
 * Priority: explicit env override > git's main worktree > current working directory.
 * `git worktree list` always lists the main worktree first, so we read that rather
 * than `rev-parse --show-toplevel` (which would point at a linked worktree when cwd
 * is itself a worktree).
 */
function resolveCanonicalRoot(): string {
	if (process.env.INDEX_CANONICAL_ROOT) {
		return path.resolve(process.env.INDEX_CANONICAL_ROOT);
	}
	try {
		const firstLine = execSync("git worktree list --porcelain", {
			cwd: process.cwd(),
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\n")
			.find((line) => line.startsWith("worktree "));
		if (firstLine) {
			return path.resolve(firstLine.slice("worktree ".length).trim());
		}
	} catch {
		// git not available or not a repo; fall through to cwd.
	}
	return path.resolve(process.cwd());
}

const CANONICAL_ROOT = resolveCanonicalRoot();
const REQUIRED_BRANCH = process.env.INDEX_ROOT_BRANCH ?? "dev";
const WORKTREES_DIR = path.join(CANONICAL_ROOT, ".worktrees");

/**
 * Enforcement posture:
 * - "warn" (default): root mutations are ALLOWED but the agent is nudged toward a
 *   worktree via an advisory appended to the tool result (so the model learns), plus a
 *   UI warning. This keeps the convention visible without hard-stopping the agent.
 * - "block": the original hard-block behavior. Opt in with INDEX_ROOT_GUARD_MODE=block.
 */
const GUARD_MODE: "warn" | "block" =
	(process.env.INDEX_ROOT_GUARD_MODE ?? "warn").toLowerCase() === "block" ? "block" : "warn";

/** Advisories keyed by toolCallId, drained by the tool_result handler in warn mode. */
const pendingAdvisories = new Map<string, string>();

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function resolveToolPath(inputPath: string): string {
	return path.resolve(process.cwd(), inputPath);
}

function isProtectedRootPath(inputPath: string): boolean {
	const resolved = resolveToolPath(inputPath);
	return isInside(CANONICAL_ROOT, resolved) && !isInside(WORKTREES_DIR, resolved);
}

function isRunningFromCanonicalRoot(): boolean {
	return path.resolve(process.cwd()) === path.resolve(CANONICAL_ROOT);
}

function normalizeCommand(command: string): string {
	return command.replace(/\\\n/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Remove quoted spans and heredoc bodies so command *arguments* (PR/commit bodies,
 * `echo`/`grep` text, etc.) cannot trip the mutating-command patterns. Only the command
 * structure outside quotes is inspected. Heredocs are stripped first — by their tag — so
 * inner quotes inside a `--body "$(cat <<'EOF' ... EOF)"` don't desync quote matching.
 * Operates on the normalized (newlines-collapsed) string.
 */
function stripArgText(command: string): string {
	let out = command;
	// Heredoc bodies: <<EOF ... EOF / <<'EOF' ... EOF / <<-"EOF" ... EOF.
	out = out.replace(/<<-?\s*'?"?(\w+)'?"?[\s\S]*?\s\1\b/g, " ");
	// Double- then single-quoted spans.
	out = out.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " ");
	return out;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAllowedDevSwitch(command: string): boolean {
	const normalized = normalizeCommand(command);
	return /^(?:git(?:\s+-C\s+(?:"[^"]+"|'[^']+'|\S+))?\s+)?(?:switch|checkout)\s+dev\s*$/.test(
		normalized.replace(/^git\s+/, "git "),
	);
}

function targetsCanonicalRootBranch(command: string): boolean {
	const normalized = stripArgText(normalizeCommand(command));
	const escapedRoot = escapeRegex(CANONICAL_ROOT);
	const rootArg = `(?:${escapedRoot}|"${escapedRoot}"|'${escapedRoot}')`;

	if (isRunningFromCanonicalRoot() && /\bgit\s+(?:switch|checkout)\b/.test(normalized)) {
		return true;
	}

	return new RegExp(`\\bgit\\s+-C\\s+${rootArg}\\s+(?:switch|checkout)\\b`).test(normalized)
		|| new RegExp(`\\bcd\\s+${rootArg}\\s*(?:&&|;)\\s*git\\s+(?:switch|checkout)\\b`).test(normalized);
}

function commandTargetsWorktree(command: string): boolean {
	const normalized = normalizeCommand(command);
	const escapedWorktrees = escapeRegex(WORKTREES_DIR);
	const absoluteWorktreeArg = `(?:${escapedWorktrees}|"${escapedWorktrees}|'${escapedWorktrees})`;

	return /^cd\s+\.worktrees\//.test(normalized)
		|| new RegExp(`^cd\\s+${absoluteWorktreeArg}/`).test(normalized)
		|| /^git\s+-C\s+\.worktrees\//.test(normalized)
		|| new RegExp(`^git\\s+-C\\s+${absoluteWorktreeArg}/`).test(normalized);
}

/**
 * `gh` operates on the GitHub remote (PRs, issues, reviews, checks) — it never mutates
 * the canonical root's working tree or branch — so a leading `gh` invocation is not a
 * root mutation. Restricted to the leading token so chained shell (`gh ... && rm ...`)
 * still has its other segments inspected.
 */
function isLeadingGhCommand(command: string): boolean {
	return /^gh\s+/.test(normalizeCommand(command));
}

/**
 * A fast-forward-only pull is the sanctioned way to keep the canonical root current
 * with its upstream (e.g. after a PR merges into dev). It cannot create a merge commit
 * or diverge the branch — git aborts harmlessly when a fast-forward is not possible —
 * so it is safe to allow on the root. A bare `git pull` (which may synthesize a merge
 * commit) stays blocked. Only a standalone pull is allowed: any shell chaining,
 * piping, or redirection disqualifies it so the exception cannot smuggle other commands.
 */
function isAllowedFastForwardPull(command: string): boolean {
	const normalized = normalizeCommand(command);
	if (/(?:&&|;|\||>|`|\$\()/.test(normalized)) return false;
	return /^git(?:\s+-C\s+\S+)?\s+pull\b/.test(normalized) && /(?:^|\s)--ff-only(?:\s|$)/.test(normalized);
}

function isLikelyRootMutation(command: string): boolean {
	if (!isRunningFromCanonicalRoot()) return false;
	const normalized = normalizeCommand(command);

	// Creating/removing worktrees is the sanctioned way to make changes off the root worktree.
	// Commands that explicitly run inside .worktrees/* are also allowed.
	if (/^git\s+worktree\s+/.test(normalized) || /^bun\s+run\s+worktree:/.test(normalized) || commandTargetsWorktree(command)) {
		return false;
	}

	// A fast-forward-only pull is allowed: it keeps the root in sync without mutating history.
	if (isAllowedFastForwardPull(command)) {
		return false;
	}

	// `gh` targets the remote, not the local root tree — not a root mutation.
	if (isLeadingGhCommand(command)) {
		return false;
	}

	// Inspect only the command structure, not quoted argument text (PR bodies, commit
	// messages, echo/grep patterns), so prose mentioning `bun run build`, `git commit`,
	// `ln`, etc. does not produce false positives.
	const inspected = stripArgText(normalized);

	// A mutating verb only counts when it sits at a *command position* — the start of the
	// line or right after a shell separator (`|`, `&`, `;`, `(`, `&&`, `||`). This stops a
	// flag or path fragment like `grep -ln` (the `ln` symlink verb) or `--reset-author`
	// from matching mid-token.
	const cmdStart = String.raw`(?:^|[|&;(]|&&|\|\|)\s*`;
	const mutatingPatterns = [
		new RegExp(cmdStart + String.raw`git\s+(?:add|commit|merge|rebase|cherry-pick|reset|restore|apply|am|clean|stash|pull|push|switch|checkout)\b`),
		new RegExp(cmdStart + String.raw`(?:sudo\s+)?(?:rm|mv|cp|touch|mkdir|rmdir|ln|chmod|chown)\b`),
		new RegExp(cmdStart + String.raw`(?:bun|npm|pnpm|yarn)\s+(?:install|add|remove|run\s+(?:build|dev|start|db:generate|db:migrate|db:seed|db:flush|lint|test))\b`),
		/(?:^|\s)(?:>|>>)|\|\s*tee\b/,
	];

	return mutatingPatterns.some((pattern) => pattern.test(inspected));
}

async function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
}

/**
 * Decide what to do with a detected root-touching operation. In block mode this returns
 * a hard block; in warn mode it records an advisory (drained into the tool result so the
 * model sees it), surfaces a UI warning, and allows the call to proceed.
 */
async function handleViolation(
	ctx: ExtensionContext,
	event: ToolCallEvent,
	blockReason: string,
	advisory: string,
): Promise<{ block: true; reason: string } | undefined> {
	if (GUARD_MODE === "block") {
		await notify(ctx, blockReason, "warning");
		return { block: true, reason: blockReason };
	}
	pendingAdvisories.set(event.toolCallId, advisory);
	await notify(ctx, advisory, "warning");
	return undefined;
}

async function getRootBranch(pi: ExtensionAPI): Promise<string | undefined> {
	const result = await pi.exec("git", ["-C", CANONICAL_ROOT, "branch", "--show-current"], { timeout: 5000 });
	if (result.code !== 0) return undefined;
	return result.stdout.trim();
}

async function hasTrackedChanges(pi: ExtensionAPI): Promise<boolean> {
	const result = await pi.exec("git", ["-C", CANONICAL_ROOT, "status", "--porcelain", "--untracked-files=no"], { timeout: 5000 });
	return result.code === 0 && result.stdout.trim().length > 0;
}

async function ensureRootOnDev(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!isRunningFromCanonicalRoot()) return;

	const branch = await getRootBranch(pi);
	if (!branch || branch === REQUIRED_BRANCH) return;

	if (await hasTrackedChanges(pi)) {
		await notify(
			ctx,
			`Canonical root is on ${branch}, not ${REQUIRED_BRANCH}, and has tracked changes. Move work to a worktree before continuing.`,
			"error",
		);
		return;
	}

	const result = await pi.exec("git", ["-C", CANONICAL_ROOT, "switch", REQUIRED_BRANCH], { timeout: 10000 });
	if (result.code === 0) {
		await notify(ctx, `Switched canonical root back to ${REQUIRED_BRANCH}. Use .worktrees/* for changes.`, "warning");
	} else {
		await notify(ctx, `Canonical root must stay on ${REQUIRED_BRANCH}; failed to switch from ${branch}: ${result.stderr.trim()}`, "error");
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await ensureRootOnDev(pi, ctx);
	});

	pi.on("before_agent_start", async (event) => {
		const posture =
			GUARD_MODE === "block"
				? `Do not modify files in that root worktree.`
				: `Prefer not to modify files in that root worktree — root writes/mutations are allowed but will warn (and dirty ${REQUIRED_BRANCH}).`;
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nProject branch guard: the canonical root ${CANONICAL_ROOT} should remain on ${REQUIRED_BRANCH}. ${posture} Create and use ${WORKTREES_DIR}/<name> for implementation changes via \`bun run worktree:session -- <type>/<description>\`, and run mutating commands from the worktree. See the create-worktree skill (.agents/skills/create-worktree/SKILL.md) for the launcher contract and sanctioned escapes this guard allows.`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string") {
			if (isProtectedRootPath(event.input.path)) {
				return handleViolation(
					ctx,
					event,
					`Blocked ${event.toolName} in canonical root. Create/use a worktree under ${WORKTREES_DIR} instead.`,
					`⚠️ root-dev-guard: this ${event.toolName} targeted the canonical root (${event.input.path}) while it is on ${REQUIRED_BRANCH}. It was allowed (warn mode) but dirties ${REQUIRED_BRANCH} — prefer \`bun run worktree:session -- <type>/<description>\` (see create-worktree).`,
				);
			}
		}

		if (event.toolName !== "bash" || typeof event.input.command !== "string") {
			return undefined;
		}

		const command = event.input.command;
		if (targetsCanonicalRootBranch(command) && !isAllowedDevSwitch(command)) {
			return handleViolation(
				ctx,
				event,
				`Blocked branch switch in canonical root. ${CANONICAL_ROOT} must stay on ${REQUIRED_BRANCH}; use git worktree for feature branches.`,
				`⚠️ root-dev-guard: this command switches the canonical root off ${REQUIRED_BRANCH}. Allowed (warn mode) but the root should stay on ${REQUIRED_BRANCH} — use a worktree for feature branches.`,
			);
		}

		if (isLikelyRootMutation(command)) {
			return handleViolation(
				ctx,
				event,
				`Canonical root is read-only for assistant changes; use a worktree under ${WORKTREES_DIR}.`,
				`⚠️ root-dev-guard: this mutating command ran from the canonical root. Allowed (warn mode) but it mutates/dirties ${REQUIRED_BRANCH} — prefer running it from ${WORKTREES_DIR}/<name>.`,
			);
		}

		return undefined;
	});

	// Warn mode: surface the advisory to the model by appending it to the tool result.
	pi.on("tool_result", async (event) => {
		const advisory = pendingAdvisories.get(event.toolCallId);
		if (!advisory) return undefined;
		pendingAdvisories.delete(event.toolCallId);
		return {
			content: [...event.content, { type: "text" as const, text: advisory }],
		};
	});
}
