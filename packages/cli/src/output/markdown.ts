/**
 * Stateful markdown renderer for streaming token-by-token output.
 *
 * Buffers incomplete lines so that inline markdown delimiters (like **)
 * are never split across render calls. Only emits output when a line
 * is complete (newline received) or on finalize().
 *
 * Handles: **bold**, *italic*, `inline code`, code blocks (```),
 * bullet lists, numbered lists, headings, and special blocks
 * (intent_proposal, opportunity).
 */

import { RESET, BOLD, ITALIC, WHITE, CYAN, BLUE, MAGENTA, GRAY, AGENT_TEXT, wordWrap, confidenceBar } from "./base";

export class MarkdownRenderer {
  private buffer = "";
  private inCodeBlock = false;
  private codeBlockLang = "";
  private codeBlockContent = "";
  /** Whether we've emitted any content yet (for leading newline). */
  private pristine = true;

  /** Feed a new token into the renderer. */
  write(text: string): void {
    this.buffer += text;
    this.flush();
  }

  /** Process buffered content and render completed lines. */
  private flush(): void {
    while (this.buffer.length > 0) {
      if (this.inCodeBlock) {
        const endIdx = this.buffer.indexOf("```");
        if (endIdx !== -1) {
          this.codeBlockContent += this.buffer.slice(0, endIdx);
          this.buffer = this.buffer.slice(endIdx + 3);
          // Consume trailing newline after closing ```
          if (this.buffer.startsWith("\n")) {
            this.buffer = this.buffer.slice(1);
          }
          this.renderCodeBlock();
          this.inCodeBlock = false;
          this.codeBlockLang = "";
          this.codeBlockContent = "";
          continue;
        }
        // Haven't found closing ``` yet — buffer everything
        this.codeBlockContent += this.buffer;
        this.buffer = "";
        return;
      }

      // Check for code block opening — only at start of a line
      const codeBlockMatch = this.buffer.match(/^```([^\n]*)\n/);
      if (codeBlockMatch) {
        this.codeBlockLang = codeBlockMatch[1].trim();
        this.buffer = this.buffer.slice(codeBlockMatch[0].length);
        this.inCodeBlock = true;
        this.codeBlockContent = "";
        continue;
      }

      // If buffer starts with ``` but no newline yet, wait for more data
      if (this.buffer.startsWith("```")) {
        return;
      }

      // Only render complete lines — buffer the rest
      const nlIdx = this.buffer.indexOf("\n");
      if (nlIdx === -1) {
        // Incomplete line — wait for more tokens or finalize()
        return;
      }

      const line = this.buffer.slice(0, nlIdx);
      this.buffer = this.buffer.slice(nlIdx + 1);
      this.emitLine(line);
    }
  }

  /** Emit a formatted line to stdout. */
  private emitLine(line: string): void {
    if (this.pristine) {
      // Add a blank line before the response for spacing
      process.stdout.write("\n");
      this.pristine = false;
    }
    const rendered = this.renderLine(line);
    process.stdout.write(rendered + "\n");
  }

  /** Render a complete line with block-level formatting. */
  private renderLine(line: string): string {
    // Bullet list items
    const bulletMatch = line.match(/^(\s*)([-*])\s+(.*)$/);
    if (bulletMatch) {
      const [, indent, , content] = bulletMatch;
      return `${indent}  ${CYAN}*${RESET} ${this.renderInline(content)}`;
    }

    // Numbered list items
    const numMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (numMatch) {
      const [, indent, num, content] = numMatch;
      return `${indent}  ${CYAN}${num}.${RESET} ${this.renderInline(content)}`;
    }

    // Headings
    if (line.startsWith("### ")) {
      return `${BOLD}${WHITE}${line.slice(4)}${RESET}`;
    }
    if (line.startsWith("## ")) {
      return `${BOLD}${WHITE}${line.slice(3)}${RESET}`;
    }
    if (line.startsWith("# ")) {
      return `${BOLD}${WHITE}${line.slice(2)}${RESET}`;
    }

    return this.renderInline(line);
  }

  /** Render inline markdown formatting to ANSI. */
  private renderInline(text: string): string {
    // Bold + italic (***text***)
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}${WHITE}$1${RESET}${AGENT_TEXT}`);
    // Bold (**text**)
    text = text.replace(/\*\*(.+?)\*\*/g, `${BOLD}${WHITE}$1${RESET}${AGENT_TEXT}`);
    // Italic (*text*) — negative lookbehind/ahead for *
    text = text.replace(
      /(?<!\*)\*([^*]+?)\*(?!\*)/g,
      `${ITALIC}$1${RESET}${AGENT_TEXT}`,
    );
    // Inline code (`text`)
    text = text.replace(/`([^`]+)`/g, `${CYAN}$1${RESET}${AGENT_TEXT}`);

    return `${AGENT_TEXT}${text}${RESET}`;
  }

  /** Render a completed code block. */
  private renderCodeBlock(): void {
    const lang = this.codeBlockLang;
    const content = this.codeBlockContent.trimEnd();

    if (!this.pristine) {
      process.stdout.write("\n");
    }
    this.pristine = false;

    // Special block: intent_proposal
    if (lang === "intent_proposal") {
      this.renderIntentProposal(content);
      return;
    }

    // Special block: opportunity
    if (lang === "opportunity") {
      this.renderOpportunity(content);
      return;
    }

    // Regular code block
    const border = `${GRAY}|${RESET}`;
    if (lang) {
      process.stdout.write(`  ${GRAY}--- ${lang} ${"─".repeat(Math.max(0, 40 - lang.length))}${RESET}\n`);
    } else {
      process.stdout.write(`  ${GRAY}${"─".repeat(46)}${RESET}\n`);
    }
    for (const line of content.split("\n")) {
      process.stdout.write(`  ${border} ${CYAN}${line}${RESET}\n`);
    }
    process.stdout.write(`  ${GRAY}${"─".repeat(46)}${RESET}\n\n`);
  }

  /** Render an intent proposal as a styled card. */
  private renderIntentProposal(content: string): void {
    try {
      const data = JSON.parse(content) as {
        description?: string;
        confidence?: number;
        proposalId?: string;
      };

      const desc = data.description ?? content;
      const confidence = data.confidence;

      process.stdout.write(`  ${MAGENTA}+${"─".repeat(56)}+${RESET}\n`);
      process.stdout.write(`  ${MAGENTA}|${RESET} ${BOLD}${MAGENTA}Signal Proposal${RESET}${" ".repeat(40)}${MAGENTA}|${RESET}\n`);
      process.stdout.write(`  ${MAGENTA}|${RESET}${" ".repeat(56)}${MAGENTA}|${RESET}\n`);

      const wrapped = wordWrap(desc, 52);
      for (const line of wrapped) {
        const pad = Math.max(0, 54 - line.length);
        process.stdout.write(`  ${MAGENTA}|${RESET}  ${AGENT_TEXT}${line}${RESET}${" ".repeat(pad)}${MAGENTA}|${RESET}\n`);
      }

      if (confidence !== undefined) {
        process.stdout.write(`  ${MAGENTA}|${RESET}${" ".repeat(56)}${MAGENTA}|${RESET}\n`);
        const bar = confidenceBar(confidence);
        process.stdout.write(`  ${MAGENTA}|${RESET}  ${GRAY}Confidence: ${bar}${RESET}${" ".repeat(24)}${MAGENTA}|${RESET}\n`);
      }

      process.stdout.write(`  ${MAGENTA}+${"─".repeat(56)}+${RESET}\n\n`);
    } catch {
      process.stdout.write(`  ${GRAY}${content}${RESET}\n\n`);
    }
  }

  /** Render an opportunity block. */
  private renderOpportunity(content: string): void {
    try {
      const data = JSON.parse(content) as {
        title?: string;
        description?: string;
        users?: Array<{ name?: string }>;
      };

      process.stdout.write(`  ${BLUE}+${"─".repeat(56)}+${RESET}\n`);
      process.stdout.write(`  ${BLUE}|${RESET} ${BOLD}${BLUE}Opportunity${RESET}${" ".repeat(44)}${BLUE}|${RESET}\n`);

      if (data.title) {
        const pad = Math.max(0, 54 - data.title.length);
        process.stdout.write(`  ${BLUE}|${RESET}  ${BOLD}${data.title}${RESET}${" ".repeat(pad)}${BLUE}|${RESET}\n`);
      }

      if (data.description) {
        process.stdout.write(`  ${BLUE}|${RESET}${" ".repeat(56)}${BLUE}|${RESET}\n`);
        const wrapped = wordWrap(data.description, 52);
        for (const line of wrapped) {
          const pad = Math.max(0, 54 - line.length);
          process.stdout.write(`  ${BLUE}|${RESET}  ${AGENT_TEXT}${line}${RESET}${" ".repeat(pad)}${BLUE}|${RESET}\n`);
        }
      }

      process.stdout.write(`  ${BLUE}+${"─".repeat(56)}+${RESET}\n\n`);
    } catch {
      process.stdout.write(`  ${GRAY}${content}${RESET}\n\n`);
    }
  }

  /**
   * Reset the renderer state after a response_reset event.
   * Prints a visual separator so the user knows output was discarded.
   */
  reset(reason?: string): void {
    // Flush any partial content first
    if (this.buffer.length > 0 || this.inCodeBlock) {
      this.buffer = "";
      this.inCodeBlock = false;
      this.codeBlockContent = "";
      this.codeBlockLang = "";
    }
    if (!this.pristine) {
      process.stdout.write(`\n${GRAY}--- retrying${reason ? `: ${reason}` : ""} ---${RESET}\n`);
    }
    this.pristine = true;
  }

  /** Finalize — flush any remaining buffered content. */
  finalize(): void {
    if (this.inCodeBlock) {
      this.renderCodeBlock();
      this.inCodeBlock = false;
    }
    if (this.buffer.length > 0) {
      // Remaining partial line — render it now
      this.emitLine(this.buffer);
      this.buffer = "";
    }
  }
}
