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

async function readWorktreeInfo(pi: ExtensionAPI, cwd: string): Promise<{ label: string; isLinkedWorktree: boolean } | undefined> {
	const topLevel = await git(pi, cwd, ["rev-parse", "--show-toplevel"]);
	const absoluteGitDir = await git(pi, cwd, ["rev-parse", "--absolute-git-dir"]);
	const commonDir = await git(pi, cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	if (!topLevel || !absoluteGitDir || !commonDir) return undefined;
	return getWorktreeInfo(topLevel, absoluteGitDir, commonDir);
}

function applyWorktreeStatus(ctx: ExtensionContext, info: { label: string } | undefined): void {
	if (!ctx.hasUI) return;
	if (!info) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("dim", `wt:${info.label}`));
}

async function updateWorktreeStatus(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;
	applyWorktreeStatus(ctx, await readWorktreeInfo(pi, ctx.cwd));
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		const wantsAutoName = AUTO_NAME_ENABLED && !pi.getSessionName();
		if (!ctx.hasUI && !wantsAutoName) return;

		const info = await readWorktreeInfo(pi, ctx.cwd);
		applyWorktreeStatus(ctx, info);
		if (wantsAutoName && info?.isLinkedWorktree) {
			pi.setSessionName(info.label);
		}
	});

	pi.registerCommand("worktree-status", {
		description: "Refresh the active git worktree footer status",
		handler: async (_args, ctx) => {
			await updateWorktreeStatus(pi, ctx);
		},
	});
}
