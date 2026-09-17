/**
 * Two-line status bar for this repository.
 *
 *   ◈ index  ⎇ dev  ⌂ ROOT                                   ~/Projects/index
 *   ◔ ▰▰▰▱▱▱▱▱ 42%  $0.12                               ◆ gpt-5.6-sol · high
 *
 * Replaces pi's built-in footer. Line 1 is the repository: name, branch, a
 * badge for the canonical ROOT checkout (design/handoff only, see AGENTS.md)
 * or a task worktree, and the checkout path. Line 2 is the agent: an 8-cell
 * context meter, session cost when non-zero, model and thinking level in the
 * theme's per-level colors.
 *
 * Editor types: `cd .pi && bun install`. At runtime pi aliases these imports to
 * its own bundled copies, so the local install only serves the type checker.
 */
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";

import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const METER_CELLS = 8;

const THINKING_COLOR: Record<string, ThemeColor> = {
  off: "thinkingOff",
  minimal: "thinkingMinimal",
  low: "thinkingLow",
  medium: "thinkingMedium",
  high: "thinkingHigh",
  xhigh: "thinkingXhigh",
  max: "thinkingMax",
};

type Checkout = { repo: string; kind: "root" | "worktree" };

/** A root checkout has a `.git` directory; a worktree has a `.git` file pointing at `<repo>/.git/worktrees/<name>`. */
function detectCheckout(cwd: string): Checkout {
  const dotGit = join(cwd, ".git");
  if (statSync(dotGit).isDirectory()) return { repo: basename(cwd), kind: "root" };
  const gitdir = readFileSync(dotGit, "utf8").replace("gitdir:", "").trim();
  return { repo: basename(gitdir.split("/.git/")[0]), kind: "worktree" };
}

function homeRelative(path: string): string {
  const home = homedir();
  return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path;
}

function sessionCost(ctx: ExtensionContext): number {
  let cost = 0;
  for (const entry of ctx.sessionManager.getEntries()) {
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message.role === "assistant" || message.role === "toolResult") cost += message.usage?.cost.total ?? 0;
  }
  return cost;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const checkout = detectCheckout(ctx.cwd);
    const checkoutPath = homeRelative(ctx.cwd);

    ctx.ui.setFooter((tui, theme, footerData) => ({
      dispose: footerData.onBranchChange(() => tui.requestRender()),
      invalidate() {},
      render(width: number): string[] {
        // theme.bg() resets the background at the end of each call, so the bar
        // background is applied per segment rather than around the whole line.
        const bar = (text: string) => theme.bg("selectedBg", text);
        const dim = (text: string) => theme.fg("dim", text);
        const justify = (left: string, right: string) => {
          const gap = width - visibleWidth(left) - visibleWidth(right);
          if (gap < 2) return truncateToWidth(left + bar("  ") + right, width);
          return left + bar(" ".repeat(gap)) + right;
        };

        const badge =
          checkout.kind === "root"
            ? theme.bg("toolErrorBg", theme.bold(theme.fg("warning", " ⌂ ROOT ")))
            : theme.bg("toolSuccessBg", theme.bold(theme.fg("success", " ⋔ worktree ")));
        const repo = theme.bold(theme.fg("accent", checkout.repo));
        const branch = theme.fg("success", footerData.getGitBranch() ?? "no branch");
        const repoLine = justify(
          bar(` ${dim("◈")} ${repo}  ${dim("⎇")} ${branch}  `) + badge,
          bar(`${dim(checkoutPath)} `),
        );

        const percent = ctx.getContextUsage()?.percent ?? null;
        const filled = percent === null ? 0 : Math.min(METER_CELLS, Math.round((percent / 100) * METER_CELLS));
        const meterColor: ThemeColor = percent === null ? "dim" : percent > 90 ? "error" : percent > 70 ? "warning" : "success";
        const meter = theme.fg(meterColor, `${"▰".repeat(filled)}${"▱".repeat(METER_CELLS - filled)} ${percent === null ? "?" : Math.round(percent)}%`);
        const cost = sessionCost(ctx);
        const costText = cost > 0 ? `  ${theme.fg("muted", `$${cost.toFixed(2)}`)}` : "";
        const model = theme.fg("accent", ctx.model?.id ?? "no model");
        const level = ctx.thinkingLevel ?? "off";
        const thinking = ctx.model?.reasoning ? ` ${dim("·")} ${theme.fg(THINKING_COLOR[level], level)}` : "";
        const agentLine = justify(
          bar(` ${dim("◔")} ${meter}${costText}`),
          bar(`${dim("◆")} ${model}${thinking} `),
        );

        return [repoLine, agentLine];
      },
    }));
  });
}
