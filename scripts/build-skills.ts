#!/usr/bin/env bun
/**
 * Materializes skill templates by injecting shared partials.
 *
 * Sources:
 *   packages/protocol/skills/claude-plugin/index-orchestrator.template.md
 *   packages/protocol/skills/claude-plugin/index-negotiator.template.md
 *
 * Destinations:
 *   - packages/claude-plugin/skills/index-orchestrator/SKILL.md
 *   - packages/claude-plugin/skills/index-negotiator/SKILL.md
 *
 * The build fails loudly if any {{TOKEN}} remains unreplaced in the output.
 */

import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..');
const CORE_GUIDANCE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/core-guidance.partial.md',
);
const ORCHESTRATOR_TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/claude-plugin/index-orchestrator.template.md',
);
const NEGOTIATOR_TEMPLATE_PATH = join(
  REPO_ROOT,
  'packages/protocol/skills/claude-plugin/index-negotiator.template.md',
);

export function resolveClaudePluginOutputs(repoRoot = REPO_ROOT): {
  orchestrator: string[];
  negotiator: string[];
} {
  return {
    orchestrator: [join(repoRoot, 'packages/claude-plugin/skills/index-orchestrator/SKILL.md')],
    negotiator: [join(repoRoot, 'packages/claude-plugin/skills/index-negotiator/SKILL.md')],
  };
}

export function injectPartials(template: string, partials: Record<string, string>): string {
  let output = template;
  for (const [key, value] of Object.entries(partials)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  const leftover = output.match(/\{\{[^{}]+\}\}/g);
  if (leftover) {
    const distinct = [...new Set(leftover)].join(', ');
    throw new Error(`Unreplaced tokens in template: ${distinct}`);
  }
  return output;
}

export function build(
  templatePath: string,
  outputPaths: string[],
  partials: Record<string, string> = {},
): void {
  const template = readFileSync(templatePath, 'utf8');
  const content = injectPartials(template, partials);
  for (const outputPath of outputPaths) {
    const dir = dirname(outputPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outputPath, content, 'utf8');
    console.log(`[build-skills] wrote ${outputPath}`);
  }
}

if (import.meta.main) {
  const coreGuidance = readFileSync(CORE_GUIDANCE_PATH, 'utf8');
  const partials = { CORE_GUIDANCE: coreGuidance };

  const claudeOutputs = resolveClaudePluginOutputs();
  build(ORCHESTRATOR_TEMPLATE_PATH, claudeOutputs.orchestrator, partials);
  build(NEGOTIATOR_TEMPLATE_PATH, claudeOutputs.negotiator, partials);
}
