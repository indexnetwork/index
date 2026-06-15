import path from "node:path";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "git-worktree";
const FALLBACK_ROOT_LABEL = process.env.PI_GIT_WORKTREE_ROOT_LABEL ?? "root";
const AUTO_NAME_ENABLED = process.env.PI_GIT_WORKTREE_AUTO_NAME !== "0";

async function git(pi: ExtensionAPI, cwd: string, args: string[]): Promise<string | undefined> {
	const result = await pi.exec("git", ["-C", cwd, ...args], { timeout: 5000 });
	if (result.code !== 0) return undefined;
	return result.stdout.trim();
}

function getWorktreeInfo(topLevel: string, absoluteGitDir: string, commonDir: string): { label: string; isLinkedWorktree: boolean } {
	const isLinkedWorktree = path.resolve(absoluteGitDir) !== path.resolve(commonDir);
	return {
		label: isLinkedWorktree ? path.basename(topLevel) || topLevel : FALLBACK_ROOT_LABEL,
		isLinkedWorktree,
	};
}

async function updateWorktreeStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	const topLevel = await git(pi, ctx.cwd, ["rev-parse", "--show-toplevel"]);
	const absoluteGitDir = await git(pi, ctx.cwd, ["rev-parse", "--absolute-git-dir"]);
	const commonDir = await git(pi, ctx.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);

	if (!topLevel || !absoluteGitDir || !commonDir) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}

	const { label } = getWorktreeInfo(topLevel, absoluteGitDir, commonDir);
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `wt:${label}`));
}

async function maybeAutoNameSession(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!AUTO_NAME_ENABLED || pi.getSessionName()) return;

	const topLevel = await git(pi, ctx.cwd, ["rev-parse", "--show-toplevel"]);
	const absoluteGitDir = await git(pi, ctx.cwd, ["rev-parse", "--absolute-git-dir"]);
	const commonDir = await git(pi, ctx.cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (!topLevel || !absoluteGitDir || !commonDir) return;

	const { label, isLinkedWorktree } = getWorktreeInfo(topLevel, absoluteGitDir, commonDir);
	if (isLinkedWorktree) {
		pi.setSessionName(label);
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		await updateWorktreeStatus(pi, ctx);
		await maybeAutoNameSession(pi, ctx);
	});

	pi.registerCommand("worktree-status", {
		description: "Refresh the active git worktree footer status",
		handler: async (_args, ctx) => {
			await updateWorktreeStatus(pi, ctx);
		},
	});
}
