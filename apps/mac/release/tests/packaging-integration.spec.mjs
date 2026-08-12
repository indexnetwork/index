// Real Task 2/3 wrapper integration; only macOS system tools and fixture data are mocked.
import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
const repo=resolve(import.meta.dir,"../../../.."), script=resolve(import.meta.dir,"../notarize-bundle.sh"), roots=[];
afterEach(()=>roots.splice(0).forEach(r=>rmSync(r,{recursive:true,force:true})));
function exe(p,s){writeFileSync(p,s);chmodSync(p,0o755)}
function fixture(){const r=mkdtempSync(join(tmpdir(),"task4-real-wrapper-"));roots.push(r);const app=join(r,"Index.app"),bin=join(r,"bin");mkdirSync(join(app,"Contents/MacOS"),{recursive:true});mkdirSync(bin);writeFileSync(join(app,"Contents/MacOS/Index"),"binary");chmodSync(join(app,"Contents/MacOS/Index"),0o755);
 const plist={CFBundleIdentifier:"network.index.system6",CFBundleExecutable:"Index",CFBundleShortVersionString:"1.0.0",CFBundleVersion:"1",IndexReleaseChannel:"production",IndexReleaseVersion:"1.0.0",IndexReleaseCommit:"a".repeat(40),IndexAPIURL:"https://protocol.index.network",IndexWebURL:"https://index.network",IndexExpectedTeamID:"LMQ3XNXLAD",IndexConnectorProtocolVersion:"1",IndexDevelopmentBuild:false,IndexOwnerKeychainAccessGroup:"LMQ3XNXLAD.network.index.system6.owner-credentials"};
 Bun.spawnSync(["python3","-c",`import plistlib,json,sys; plistlib.dump(json.loads(sys.argv[1]),open(sys.argv[2],'wb'))`,JSON.stringify(plist),join(app,"Contents/Info.plist")]);writeFileSync(join(app,"Contents/embedded.provisionprofile"),"fixture");
 exe(join(bin,"PlistBuddy"),`#!/usr/bin/env python3
import plistlib,sys
key=sys.argv[2].split(':')[-1]; print(plistlib.load(open(sys.argv[3],'rb'))[key])
`);
 exe(join(bin,"file"),'#!/bin/bash\n[[ "$*" == *MacOS/Index ]]&&echo "Mach-O 64-bit executable"||echo data\n');
 exe(join(bin,"security"),`#!/bin/bash
if [[ "$1 $2" == "cms -D" ]]; then while [[ "$1" != -o ]]; do shift; done; python3 - "$2" <<'PY'
import datetime,plistlib,sys
team='LMQ3XNXLAD'; bid='network.index.system6'; group=team+'.'+bid+'.owner-credentials'
v={'ExpirationDate':datetime.datetime(2099,1,1),'TeamIdentifier':[team],'ApplicationIdentifierPrefix':[team],'Entitlements':{'com.apple.application-identifier':team+'.'+bid,'com.apple.developer.team-identifier':team,'com.apple.developer.associated-domains':['applinks:index.network'],'keychain-access-groups':[group]}}
plistlib.dump(v,open(sys.argv[1],'wb'))
PY
fi
`);
 exe(join(bin,"codesign"),`#!/bin/bash
[[ -n "$FAIL_CODESIGN" ]] && exit 72
path="${'${@: -1}'}"; id=network.index.system6
if [[ " $* " == *" -d -r- "* ]]; then printf 'designated => identifier "%s" and anchor apple generic and certificate leaf[subject.OU] = "LMQ3XNXLAD"\\n' "$id" >&2
elif [[ " $* " == *" -dvv "* ]]; then cat >&2 <<EOF
Identifier=$id
CodeDirectory v=20500 size=1 flags=0x10000(runtime) hashes=1 location=embedded
Authority=Developer ID Application: Fixture (LMQ3XNXLAD)
Timestamp=Aug 9, 2026 at 12:34:56
TeamIdentifier=LMQ3XNXLAD
EOF
elif [[ " $* " == *" --entitlements :- "* ]]; then cat <<EOF
<?xml version="1.0"?><plist version="1.0"><dict><key>com.apple.developer.associated-domains</key><array><string>applinks:index.network</string></array><key>keychain-access-groups</key><array><string>LMQ3XNXLAD.network.index.system6.owner-credentials</string></array></dict></plist>
EOF
fi
`);
 exe(join(bin,"lipo"),'#!/bin/bash\necho "arm64 x86_64"\n');
 exe(join(bin,"otool"),`#!/usr/bin/env python3
import hashlib,json,plistlib,sys
args=sys.argv[1:]
if '-l' in args: print('LC_BUILD_VERSION\\n minos 13.0'); raise SystemExit
binary=args[-1]; plist=binary.split('/Contents/MacOS/')[0]+'/Contents/Info.plist'; v=plistlib.load(open(plist,'rb'))
keys=['CFBundleIdentifier','CFBundleShortVersionString','CFBundleVersion','IndexReleaseChannel','IndexReleaseVersion','IndexReleaseCommit','IndexAPIURL','IndexWebURL','IndexExpectedTeamID','IndexConnectorProtocolVersion','IndexDevelopmentBuild','IndexOwnerKeychainAccessGroup']
i={'IndexBuildTarget':'app',**{k:v[k] for k in keys}}; c=json.dumps(i,sort_keys=True,separators=(',',':')); i['IndexBuildID']=hashlib.sha256(c.encode()).hexdigest(); raw=(json.dumps(i,sort_keys=True,separators=(',',':'))+'\\n').encode().hex(); print(' '.join(raw[n:n+8] for n in range(0,len(raw),8)))
`);
 return {r,app,bin};}
function run(f,fail=""){return Bun.spawnSync(["bash","-c",'source "$SCRIPT"; verify_release_bundle_path "$APP"'],{cwd:repo,env:{...process.env,SCRIPT:script,APP:f.app,PLIST_BUDDY:join(f.bin,"PlistBuddy"),FAIL_CODESIGN:fail,PATH:`${f.bin}:${process.env.PATH}`},stdout:"pipe",stderr:"pipe"})}
test("real Task 2/3 wrappers succeed with external-tool fixtures and propagate failure",()=>{const f=fixture();const ok=run(f);expect(ok.stderr.toString()).toBe("");expect(ok.exitCode).toBe(0);const bad=run(f,"1");expect(bad.exitCode).not.toBe(0);expect(bad.stderr.toString()).toContain("signature verification")});
