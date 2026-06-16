import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const CANONICAL_ROOT = process.env.INDEX_CANONICAL_ROOT ?? "/Users/aposto/Projects/index";
const REQUIRED_BRANCH = process.env.INDEX_ROOT_BRANCH ?? "dev";
const WORKTREES_DIR = path.join(CANONICAL_ROOT, ".worktrees");

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
	const normalized = normalizeCommand(command);
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

function isLikelyRootMutation(command: string): boolean {
	if (!isRunningFromCanonicalRoot()) return false;
	const normalized = normalizeCommand(command);

	// Creating/removing worktrees is the sanctioned way to make changes off the root worktree.
	// Commands that explicitly run inside .worktrees/* are also allowed.
	if (/^git\s+worktree\s+/.test(normalized) || /^bun\s+run\s+worktree:/.test(normalized) || commandTargetsWorktree(command)) {
		return false;
	}

	const mutatingPatterns = [
		/\bgit\s+(?:add|commit|merge|rebase|cherry-pick|reset|restore|apply|am|clean|stash|pull|push|switch|checkout)\b/,
		/\b(?:rm|mv|cp|touch|mkdir|rmdir|ln|chmod|chown)\b/,
		/\b(?:bun|npm|pnpm|yarn)\s+(?:install|add|remove|run\s+(?:build|dev|start|db:generate|db:migrate|db:seed|db:flush|lint|test))\b/,
		/(?:^|\s)(?:>|>>)|\|\s*tee\b/,
	];

	return mutatingPatterns.some((pattern) => pattern.test(normalized));
}

async function notify(ctx: ExtensionContext, message: string, level: "info" | "warning" | "error" = "info") {
	if (ctx.hasUI) {
		ctx.ui.notify(message, level);
	}
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
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nProject branch guard: the canonical root ${CANONICAL_ROOT} must remain on ${REQUIRED_BRANCH}. Do not modify files in that root worktree. Create and use ${WORKTREES_DIR}/<name> for implementation changes, and run mutating commands from the worktree.`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if ((event.toolName === "write" || event.toolName === "edit") && typeof event.input.path === "string") {
			if (isProtectedRootPath(event.input.path)) {
				return {
					block: true,
					reason: `Blocked ${event.toolName} in canonical root. Create/use a worktree under ${WORKTREES_DIR} instead.`,
				};
			}
		}

		if (event.toolName !== "bash" || typeof event.input.command !== "string") {
			return undefined;
		}

		const command = event.input.command;
		if (targetsCanonicalRootBranch(command) && !isAllowedDevSwitch(command)) {
			return {
				block: true,
				reason: `Blocked branch switch in canonical root. ${CANONICAL_ROOT} must stay on ${REQUIRED_BRANCH}; use git worktree for feature branches.`,
			};
		}

		if (isLikelyRootMutation(command)) {
			await notify(ctx, `Blocked mutating command in canonical root. Run it from ${WORKTREES_DIR}/<name>.`, "warning");
			return {
				block: true,
				reason: `Canonical root is read-only for assistant changes; use a worktree under ${WORKTREES_DIR}.`,
			};
		}

		return undefined;
	});
}
