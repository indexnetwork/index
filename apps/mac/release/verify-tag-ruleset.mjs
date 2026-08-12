#!/usr/bin/env bun
const [raw, tag, id] = process.argv.slice(2);
let ruleset;
try { ruleset = JSON.parse(raw); } catch { process.exit(1); }

function glob(pattern, value) {
  if (typeof pattern !== "string" || pattern.length === 0 || /[{}\\]/.test(pattern) || /[!+@](?=\()|\*\(/.test(pattern)) throw new Error("unsupported glob");
  let expression = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*") {
      if (pattern[index + 1] === "*") { expression += ".*"; index += 1; }
      else expression += "[^/]*";
    } else if (character === "?") expression += "[^/]";
    else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0) throw new Error("unterminated character class");
      let body = pattern.slice(index + 1, end);
      if (!body || /[\[\\/]/.test(body)) throw new Error("unsupported character class");
      if (body[0] === "!") body = `^${body.slice(1)}`;
      else if (body[0] === "^") body = `\\${body}`;
      expression += `[${body}]`; index = end;
    } else expression += character.replace(/[.+^$()|]/g, "\\$&");
  }
  return new RegExp(`${expression}$`).test(value);
}

try {
  const ref = `refs/tags/${tag}`, conditions = ruleset.conditions?.ref_name;
  if (String(ruleset.id) !== id || ruleset.enforcement !== "active" || ruleset.target !== "tag" ||
      (ruleset.bypass_actors?.length ?? 0) !== 0 || !Array.isArray(conditions?.include) || !Array.isArray(conditions?.exclude) ||
      !conditions.include.some((pattern) => pattern === "~ALL" || glob(pattern, ref)) ||
      conditions.exclude.some((pattern) => pattern === "~ALL" || glob(pattern, ref)) ||
      !ruleset.rules?.some((rule) => rule.type === "update") || !ruleset.rules?.some((rule) => rule.type === "deletion")) process.exit(1);
} catch { process.exit(1); }
