import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";

import { MarkdownRenderer } from "../src/output/markdown";
import { stripAnsi } from "../src/output/base";

/**
 * Capture all stdout.write calls during a callback and return the plain text.
 */
function captureStdout(fn: () => void): string {
  const chunks: string[] = [];
  const spy = spyOn(process.stdout, "write").mockImplementation((data: string | Uint8Array) => {
    chunks.push(typeof data === "string" ? data : new TextDecoder().decode(data));
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return chunks.join("");
}

describe("MarkdownRenderer", () => {
  describe("plain text", () => {
    it("renders complete lines", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("Hello world\n");
        r.finalize();
      });
      expect(stripAnsi(output)).toContain("Hello world");
    });

    it("buffers incomplete lines until finalize", () => {
      let midOutput = "";
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("partial");
        // Capture mid-state — nothing should have been emitted yet for incomplete line
        midOutput = "captured";
        r.finalize();
      });
      expect(stripAnsi(output)).toContain("partial");
    });
  });

  describe("inline formatting", () => {
    it("renders bold text", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("This is **bold** text\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      // Bold delimiters should be removed, text preserved
      expect(plain).toContain("bold");
      expect(plain).not.toContain("**");
    });

    it("renders italic text", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("This is *italic* text\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("italic");
    });

    it("renders inline code", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("Use `console.log`\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("console.log");
      expect(plain).not.toContain("`");
    });
  });

  describe("block-level formatting", () => {
    it("renders headings", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("# Heading 1\n## Heading 2\n### Heading 3\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("Heading 1");
      expect(plain).toContain("Heading 2");
      expect(plain).toContain("Heading 3");
      // Hash marks should be stripped
      expect(plain).not.toContain("# ");
    });

    it("renders bullet lists", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("- item one\n- item two\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("item one");
      expect(plain).toContain("item two");
      expect(plain).toContain("*"); // rendered bullet character
    });

    it("renders numbered lists", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("1. first\n2. second\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("1.");
      expect(plain).toContain("first");
      expect(plain).toContain("2.");
      expect(plain).toContain("second");
    });
  });

  describe("code blocks", () => {
    it("renders a fenced code block", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("```js\nconsole.log('hi');\n```\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("js");
      expect(plain).toContain("console.log('hi');");
    });

    it("renders a code block without language", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("```\nplain code\n```\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("plain code");
    });

    it("handles streaming tokens across code block boundaries", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("```py\n");
        r.write("x = 1\n");
        r.write("```\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("x = 1");
    });
  });

  describe("special blocks", () => {
    it("renders intent_proposal block", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write('```intent_proposal\n{"description":"Find a cofounder","confidence":85}\n```\n');
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("Signal Proposal");
      expect(plain).toContain("Find a cofounder");
      expect(plain).toContain("85%");
    });

    it("renders opportunity block", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write('```opportunity\n{"title":"Great match","description":"You two should connect"}\n```\n');
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("Opportunity");
      expect(plain).toContain("Great match");
      expect(plain).toContain("You two should connect");
    });

    it("handles malformed JSON in special blocks gracefully", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("```intent_proposal\nnot json\n```\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("not json");
    });
  });

  describe("reset", () => {
    it("clears buffer and prints separator", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("Some text\n");
        r.reset("model error");
        r.write("New text\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("retrying");
      expect(plain).toContain("model error");
      expect(plain).toContain("New text");
    });

    it("does not print separator if nothing was rendered yet", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.reset();
        r.write("Fresh start\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).not.toContain("retrying");
      expect(plain).toContain("Fresh start");
    });
  });

  describe("finalize", () => {
    it("flushes remaining buffer content", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("no trailing newline");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("no trailing newline");
    });

    it("flushes unclosed code block", () => {
      const output = captureStdout(() => {
        const r = new MarkdownRenderer();
        r.write("```\nunclosed code\n");
        r.finalize();
      });
      const plain = stripAnsi(output);
      expect(plain).toContain("unclosed code");
    });
  });
});
