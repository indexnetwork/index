import { test, expect, describe } from "bun:test";

import {
  extractDigestOpportunityIds,
  sanitizeDigestUrls,
  stripDigestMetadata,
} from "../validate-digest-urls";

describe("sanitizeDigestUrls", () => {
  test("strips a fabricated /accept/<n> link, keeping the link text as plain prose", () => {
    const md = "- [Alex Rivera](https://index.network/u/11111111-1111-1111-1111-111111111111) — a specialist, [message Alex](https://index.network/accept/901)";

    const { output, stripped } = sanitizeDigestUrls(md);

    // The fabricated accept link is demoted to its label text.
    expect(output).toContain("message Alex");
    expect(output).not.toContain("/accept/901");
    expect(output).not.toContain("(https://index.network/accept/901)");
    // The real profile link survives untouched.
    expect(output).toContain("(https://index.network/u/11111111-1111-1111-1111-111111111111)");
    expect(stripped).toEqual(["https://index.network/accept/901"]);
  });

  test("preserves a legitimate /c/<code> connect link including its query string", () => {
    const md = "[message Maya](https://protocol.index.network/c/Abc1234567?link_preview=false)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("preserves a legitimate /u/<uuid> profile link", () => {
    const md = "[Maya](https://index.network/u/22222222-2222-2222-2222-222222222222?link_preview=false)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("accepts /c/ and /u/ links regardless of host (dev/railway bases)", () => {
    const md = "[a](https://index-protocol-dev.up.railway.app/c/Xy_9-aBcDe) and [b](http://localhost:3001/u/33333333-3333-3333-3333-333333333333)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("strips fabricated path shapes other than /c/ and /u/", () => {
    const md = "[x](https://index.network/profile/42) [y](https://index.network/opportunity/create?id=7) [z](https://index.network/connect/8)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe("x y z");
    expect(stripped).toEqual([
      "https://index.network/profile/42",
      "https://index.network/opportunity/create?id=7",
      "https://index.network/connect/8",
    ]);
  });

  test("strips a malformed / non-absolute URL", () => {
    const md = "[broken](accept/901) and [empty]()";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe("broken and empty");
    expect(stripped).toEqual(["accept/901", ""]);
  });

  test("leaves link-free prose untouched", () => {
    const md = "Quiet morning — I'll keep listening.";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("on one bullet, keeps the legitimate /c/ link and strips the fabricated one beside it", () => {
    // The grouped-card shape from prepare.md step 8: one real connect link and one
    // fabricated link on the same line. Only the fabricated one must be demoted.
    const md = "- [Maya](https://protocol.index.network/c/Abc1234567?link_preview=false) on memory, and [more](https://index.network/accept/901)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe("- [Maya](https://protocol.index.network/c/Abc1234567?link_preview=false) on memory, and more");
    expect(stripped).toEqual(["https://index.network/accept/901"]);
  });

  test("known non-target: bare URLs and autolinks pass through unstripped (out of guard scope)", () => {
    // Documents a deliberate limitation: the guard only covers inline `[label](url)`
    // links — the only shape the digest prompts emit. A bare or autolinked fabricated
    // URL is NOT caught. If the prompts ever start emitting these, this test should flip.
    const md = "See https://index.network/accept/901 or <https://index.network/accept/901>";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("does not treat a trailing-slash /c/ or /u/ path as fabricated", () => {
    const md = "[a](https://index.network/c/Abc1234567/) [b](https://index.network/u/44444444-4444-4444-4444-444444444444/)";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(stripped).toEqual([]);
    expect(output).toBe(md);
  });

  test("preserves digest metadata markers by default so Kanban drafts remain editable", () => {
    const md = "- <!-- digest-opportunity:id=opp-1 -->[Maya](https://index.network/u/55555555-5555-5555-5555-555555555555) — relevant";

    const { output, stripped } = sanitizeDigestUrls(md);

    expect(output).toBe(md);
    expect(stripped).toEqual([]);
  });

  test("strips digest metadata markers when requested for final delivery", () => {
    const md = "- <!-- digest-opportunity:id=opp-1 -->[Maya](https://index.network/u/55555555-5555-5555-5555-555555555555) — relevant";

    const { output, stripped } = sanitizeDigestUrls(md, { stripDigestMetadata: true });

    expect(output).toBe("- [Maya](https://index.network/u/55555555-5555-5555-5555-555555555555) — relevant");
    expect(stripped).toEqual([]);
  });

  test("extracts unique opportunity ids from remaining digest markers in order", () => {
    const md = [
      "- <!-- digest-opportunity:id=opp-1 -->Maya — relevant",
      "- <!-- digest-opportunity:id=opp-2 -->Alex — useful",
      "- <!-- digest-opportunity:id=opp-1 -->Maya duplicate",
    ].join("\n");

    expect(extractDigestOpportunityIds(md)).toEqual(["opp-1", "opp-2"]);
  });

  test("stripDigestMetadata removes only digest markers", () => {
    const md = "<!-- keep-me -->\n- <!-- digest-opportunity:id=opp-1 -->Maya";

    expect(stripDigestMetadata(md)).toBe("<!-- keep-me -->\n- Maya");
  });
});
