#!/usr/bin/env bash
# Verify historical CMS, canonical metadata, checksums, and downloaded artifact bytes.
set -euo pipefail
set +x
readonly PRIOR_RELEASE_DIRECTORY="$(cd "$(dirname "$0")" && pwd -P)"
source "$PRIOR_RELEASE_DIRECTORY/cms-verify.sh"
prior_error(){ printf 'historical macOS release refused: %s\n' "$1" >&2;return 1;}
[[ "$#" -eq 4 ]]||prior_error "usage: JSON CMS FINAL_DIR SHA256SUMS"
metadata="$1";cms="$2";FINAL_DIR="$3";sums="$4"
[[ -f "$metadata"&&! -L "$metadata"&&-f "$cms"&&! -L "$cms"&&-d "$FINAL_DIR"&&! -L "$FINAL_DIR"&&-f "$sums"&&! -L "$sums" ]]||prior_error "historical evidence inputs are incomplete"
work="$(mktemp -d "${TMPDIR:-/tmp}/index-prior-cms.XXXXXX")";chmod 700 "$work";trap 'rm -rf "$work"' EXIT
verify_opaque_cms_signer "$cms" "$metadata" "$work"||prior_error "historical CMS invalid"
bun - "$metadata" "$FINAL_DIR" "$sums" <<'JS'
const [path,dir,sumsPath]=process.argv.slice(2),bytes=await Bun.file(path).text();let v;try{v=JSON.parse(bytes)}catch{throw 0}
const sem=/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
if(!sem.test(v.releaseVersion)||!/^[1-9]\d*$/.test(v.buildNumber)||!Array.isArray(v.artifacts)||v.artifacts.length!==2)throw 0;
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;if(bytes!==JSON.stringify(canonical(v))+"\n")throw 0;
const expected=[[`Index-macOS-${v.releaseVersion}-universal.dmg`,"app-dmg"],[`IndexConnector-${v.releaseVersion}-universal.dmg`,"connector-dmg"]],lines=[];
for(let i=0;i<2;i++){const a=v.artifacts[i],[name,kind]=expected[i],file=Bun.file(`${dir}/${name}`),data=new Uint8Array(await file.arrayBuffer()),hash=new Bun.CryptoHasher("sha256").update(data).digest("hex");if(a.name!==name||a.kind!==kind||a.size!==data.length||a.sha256!==hash||a.url!==`https://github.com/indexnetwork/index/releases/download/v${v.releaseVersion}/${name}`)throw new Error("artifact bytes do not match metadata");lines.push(`${hash}  ${name}\n`)}if(await Bun.file(sumsPath).text()!==lines.join(""))throw new Error("SHA256SUMS mismatch");
JS
