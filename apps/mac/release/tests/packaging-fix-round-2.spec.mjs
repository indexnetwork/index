import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const rootDir=resolve(import.meta.dir,"../../../.."); const rel=resolve(import.meta.dir,".."); const fixtures=[];
afterEach(()=>fixtures.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true})));
function fx(){const r=mkdtempSync(join(tmpdir(),"pkg-r2-")); fixtures.push(r); return r;} function exe(p,s){writeFileSync(p,s);chmodSync(p,0o755)}
function run(s,e={}){return Bun.spawnSync(["bash","-c",s],{cwd:rootDir,env:{...process.env,...e},stdout:"pipe",stderr:"pipe"})}
const bundle=join(rel,"notarize-bundle.sh"), create=join(rel,"create-dmg.sh"), dmg=join(rel,"notarize-dmg.sh"), mounted=join(rel,"verify-mounted-dmg.sh");

test("direct final DMG path is refused before codesign mutation",()=>{const r=fx(),bin=join(r,"bin"),final=join(r,"dist/final");mkdirSync(bin,{recursive:true});mkdirSync(final,{recursive:true});const file=join(final,"Index-macOS-1.0.0-universal.dmg"),log=join(r,"log");writeFileSync(file,"original");exe(join(bin,"codesign"),'#!/bin/bash\necho mutated >>"$LOG"\n');const x=run('source "$S"; uname(){ echo Darwin; }; notarize_dmg_main "$D"',{S:dmg,D:file,LOG:log,CODESIGN_IDENTITY:"Developer ID Application: x",NOTARYTOOL_PROFILE:"x",PATH:`${bin}:${process.env.PATH}`});expect(x.exitCode).not.toBe(0);expect(x.stderr.toString()).toContain("private release transaction");expect(readFileSync(file,"utf8")).toBe("original");expect(Bun.file(log).size).toBe(0)});

test("bundle submit detects ZIP mutation and uses restrictive permissions",()=>{const s=readFileSync(bundle,"utf8");expect(s).toContain("archive_digest");expect(s).toMatch(/chmod 600[\s\S]*archive_digest[\s\S]*notarytool submit[\s\S]*require_same_archive_digest/);expect(s.match(/require_same_archive_digest/g)?.length).toBeGreaterThanOrEqual(3);const r=fx(),a=join(r,"a.zip");writeFileSync(a,"before");const x=run('source "$S"; digest="$(archive_sha256 "$A")"; printf after >"$A"; require_same_archive_digest "$A" "$digest"',{S:bundle,A:a});expect(x.exitCode).not.toBe(0);expect(x.stderr.toString()).toContain("ZIP bytes changed")});

test.each(["symlink","file","nonempty"])(".Trashes %s is rejected",kind=>{const r=fx(),m=join(r,"mount");mkdirSync(join(m,"Index.app","Contents"),{recursive:true});if(kind==="symlink")symlinkSync("/tmp",join(m,".Trashes"));else if(kind==="file")writeFileSync(join(m,".Trashes"),"x");else{mkdirSync(join(m,".Trashes"));writeFileSync(join(m,".Trashes","x"),"x")}const x=run('source "$S"; validate_mounted_inventory "$M" Index.app',{S:mounted,M:m});expect(x.exitCode).not.toBe(0)});

test("empty real .Trashes and exact zero metadata marker are allowed",()=>{const r=fx(),m=join(r,"mount");mkdirSync(join(m,"Index.app","Contents"),{recursive:true});mkdirSync(join(m,".Trashes"));writeFileSync(join(m,".metadata_never_index"),"");const x=run('source "$S"; validate_mounted_inventory "$M" Index.app',{S:mounted,M:m});expect(x.exitCode).toBe(0)});

test.each([{}, {INDEX_RELEASE_EXPECTED_RUNNER_IMAGE:"macos-14",INDEX_RELEASE_EXPECTED_RUNNER_VERSION:"20260801",ImageOS:"macos-13",ImageVersion:"20260801"}])("runner expected inputs absent/mismatch fail %o",e=>{const x=run('source "$S"; sw_vers(){ [[ "$1" == -productVersion ]]&&echo 14.6||echo 23G80; }; validate_reproducible_host',{S:create,GITHUB_ACTIONS:"true",INDEX_RELEASE_MACOS_VERSION:"14.6",INDEX_RELEASE_MACOS_BUILD:"23G80",...e});expect(x.exitCode).not.toBe(0);expect(x.stderr.toString()).toContain("runner")});

test("reproducibility evidence is promoted beside candidate",()=>{const s=readFileSync(create,"utf8");expect(s).toContain("INDEX_RELEASE_EXPECTED_RUNNER_IMAGE");expect(s).toContain("INDEX_RELEASE_EXPECTED_RUNNER_VERSION");expect(s).toContain('${output}.reproducibility.txt');expect(s).toMatch(/mv "\$evidence" "\$\{output\}\.reproducibility\.txt"/)});

test("canonicalized alias root succeeds while escape fails",()=>{const r=fx(),real=join(r,"real"),alias=join(r,"alias");mkdirSync(join(real,"Index.app","Contents"),{recursive:true});symlinkSync(real,alias);let x=run('source "$S"; validate_exact_product_tree "$R" "$R/Index.app"',{S:bundle,R:alias});expect(x.exitCode).toBe(0);symlinkSync("/tmp",join(real,"Index.app","Contents","escape"));x=run('source "$S"; validate_exact_product_tree "$R" "$R/Index.app"',{S:bundle,R:alias});expect(x.exitCode).not.toBe(0)});

test("real Task 2 and Task 3 wrappers are invoked, never replaced, by integration harness",()=>{const s=readFileSync(join(rel,"tests/packaging-integration.spec.mjs"),"utf8");expect(s).toContain("notarize-bundle.sh");expect(s).toContain("verify_release_bundle_path");expect(s).not.toMatch(/verify_release_(?:bundle_path|directory)\(\)\s*\{/)});
