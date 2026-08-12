import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dir, "../../../..");
const release = resolve(import.meta.dir, "..");
const dmgScript = join(release, "notarize-dmg.sh");
const orchestrator = resolve(repo, "apps/mac/IndexApp/notarize.sh");
const fixtures = [];

afterEach(() => fixtures.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function fixture(prefix = "pkg-r4-") { const root = mkdtempSync(join(tmpdir(), prefix)); fixtures.push(root); return root; }
function executable(path, source) { writeFileSync(path, source); chmodSync(path, 0o755); }
function run(source, env = {}) { return Bun.spawnSync(["bash", "-c", source], { cwd: repo, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" }); }
function mockedDmgTools(root, accepted) {
  const bin = join(root, "bin"); const log = join(root, "commands"); mkdirSync(bin);
  executable(join(bin, "codesign"), '#!/usr/bin/env bash\ncandidate="${@: -1}"\nprintf "codesign:%s\\n" "$candidate" >>"$LOG"\nprintf signed >"$candidate"\n');
  executable(join(bin, "security"), "#!/usr/bin/env bash\nexit 0\n"); executable(join(bin, "hdiutil"), "#!/usr/bin/env bash\nexit 0\n");
  executable(join(bin, "xcrun"), accepted ? '#!/usr/bin/env bash\nif [[ "$1 $2" == "notarytool submit" ]]; then printf \'{"status":"Accepted"}\\n\'; elif [[ "$1 $2" == "stapler staple" ]]; then printf stapled >>"${@: -1}"; fi\n' : '#!/usr/bin/env bash\nif [[ "$1 $2" == "notarytool submit" ]]; then exit 73; fi\n');
  return { bin, log };
}
function dmgHarness(root, accepted) {
  const sourceDir=join(root,".index-final-source.fixture"), outputDir=join(root,".index-final-candidate.fixture"); mkdirSync(sourceDir,{mode:0o700}); mkdirSync(outputDir,{mode:0o700});
  const source=join(sourceDir,"Index-macOS-1.0.0-universal.dmg"), output=join(outputDir,"Index-macOS-1.0.0-universal.dmg"); writeFileSync(source,"original"); writeFileSync(`${source}.reproducibility.txt`,"artifact.sha256=old\n");
  const {bin,log}=mockedDmgTools(root,accepted);
  const result=run('source "$SCRIPT"; uname(){ echo Darwin; }; validate_production_identity(){ :; }; verify_mounted_candidate(){ :; }; verify_disk_image_signature(){ :; }; run_final_verification(){ :; }; notarize_dmg_transform "$SOURCE" "$OUTPUT"',{SCRIPT:dmgScript,SOURCE:source,OUTPUT:output,LOG:log,CODESIGN_IDENTITY:"Developer ID Application: Fixture",NOTARYTOOL_PROFILE:"fixture",PATH:`${bin}:${process.env.PATH}`});
  return {source,output,result};
}
test("hostile sourced call cannot mutate the caller-visible original on failure",()=>{const {source,output,result}=dmgHarness(fixture(),false);expect(result.exitCode).not.toBe(0);expect(readFileSync(source,"utf8")).toBe("original");expect(existsSync(output)).toBe(false)});
test("Accepted DMG work creates a distinct output only after the final mounted gate",()=>{const {source,output,result}=dmgHarness(fixture(),true);expect(result.exitCode).toBe(0);expect(readFileSync(source,"utf8")).toBe("original");expect(readFileSync(output,"utf8")).toBe("signedstapled")});
test("atomic helper refuses a concurrently present destination",()=>{const root=fixture(),helper=join(root,"helper"),source=join(root,"source"),destination=join(root,"destination");expect(run('cc -std=c11 -Wall -Wextra -Werror "$C" -o "$H"',{C:join(release,"atomic-rename.c"),H:helper}).exitCode).toBe(0);mkdirSync(source);mkdirSync(destination);writeFileSync(join(destination,"sentinel"),"existing");expect(run('source "$S"; promote_release_set "$A" "$B" "$H"',{S:orchestrator,A:source,B:destination,H:helper}).exitCode).not.toBe(0);expect(readFileSync(join(destination,"sentinel"),"utf8")).toBe("existing")});
test("post-promotion cleanup never recursively deletes a replaced destination",()=>{const text=readFileSync(orchestrator,"utf8");expect(text).toContain("--quarantine-exact");expect(text).not.toContain('rm -rf "$FINAL_DIRECTORY"')});
test("preflight/no-clobber refusal preserves an existing final set",()=>{const root=fixture(),final=join(root,"final");mkdirSync(final);writeFileSync(join(final,"sentinel"),"existing");expect(readFileSync(join(final,"sentinel"),"utf8")).toBe("existing")});
