#!/usr/bin/env bash
# Verify historical CMS and complete immutable release authority.
set -euo pipefail
set +x
readonly PRIOR_RELEASE_DIRECTORY="$(cd "$(dirname "$0")" && pwd -P)"
source "$PRIOR_RELEASE_DIRECTORY/cms-verify.sh"
prior_error(){ printf 'historical macOS release refused: %s\n' "$1" >&2;return 1;}
[[ "$#" -eq 7 ]]||prior_error "usage: JSON CMS FINAL_DIR SHA256SUMS RELEASE_TAG REPOSITORY TARGET_COMMIT"
metadata="$1";cms="$2";FINAL_DIR="$3";sums="$4";release_tag="$5";repository="$6";target_commit="$7"
[[ -f "$metadata"&&! -L "$metadata"&&-f "$cms"&&! -L "$cms"&&-d "$FINAL_DIR"&&! -L "$FINAL_DIR"&&-f "$sums"&&! -L "$sums" ]]||prior_error "historical evidence inputs are incomplete"
[[ "$release_tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$&&"$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$&&"$target_commit" =~ ^[0-9a-f]{40}$ ]]||prior_error "historical tag/repository/commit authority is invalid"
work="$(mktemp -d "${TMPDIR:-/tmp}/index-prior-cms.XXXXXX")";chmod 700 "$work";trap 'rm -rf "$work"' EXIT
verify_opaque_cms_signer "$cms" "$metadata" "$work"||prior_error "historical CMS invalid"
bun - "$metadata" "$FINAL_DIR" "$sums" "$release_tag" "$repository" "$target_commit" <<'JS'
const [path,dir,sumsPath,tag,repository,targetCommit]=process.argv.slice(2),bytes=await Bun.file(path).text();let value;try{value=JSON.parse(bytes)}catch{throw new Error("metadata is not JSON")}
const sem=/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/;
const exactKeys=(object,keys)=>object&&typeof object==="object"&&!Array.isArray(object)&&JSON.stringify(Object.keys(object).sort())===JSON.stringify([...keys].sort());
const rootKeys=["apiUrl","architectures","artifacts","buildNumber","commit","connectorProtocolVersion","minimumMacOS","releaseVersion","schemaVersion","teamId","webUrl"];
if(!exactKeys(value,rootKeys)||value.schemaVersion!==1||value.teamId!=="LMQ3XNXLAD"||value.apiUrl!=="https://protocol.index.network"||value.webUrl!=="https://index.network"||JSON.stringify(value.architectures)!==JSON.stringify(["arm64","x86_64"])||value.minimumMacOS!=="13.0"||value.connectorProtocolVersion!==1)throw new Error("metadata authority is not exact");
if(!sem.test(value.releaseVersion)||tag!==`v${value.releaseVersion}`||!/^[1-9]\d*$/.test(value.buildNumber)||!/^[0-9a-f]{40}$/.test(value.commit)||value.commit!==targetCommit||!Array.isArray(value.artifacts)||value.artifacts.length!==2)throw new Error("metadata identity is noncanonical or differs from release target");
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
if(bytes!==JSON.stringify(canonical(value))+"\n")throw new Error("metadata bytes are noncanonical");
const expected=[[`Index-macOS-${value.releaseVersion}-universal.dmg`,"app-dmg"],[`IndexConnector-${value.releaseVersion}-universal.dmg`,"connector-dmg"]],lines=[];
for(let index=0;index<expected.length;index++){const artifact=value.artifacts[index],[name,kind]=expected[index];if(!exactKeys(artifact,["kind","name","sha256","size","url"]))throw new Error("artifact keys are not exact");const file=Bun.file(`${dir}/${name}`),data=new Uint8Array(await file.arrayBuffer()),hash=new Bun.CryptoHasher("sha256").update(data).digest("hex");if(artifact.name!==name||artifact.kind!==kind||artifact.size!==data.length||artifact.size<=0||artifact.sha256!==hash||!/^[0-9a-f]{64}$/.test(artifact.sha256)||artifact.url!==`https://github.com/${repository}/releases/download/${tag}/${name}`)throw new Error("artifact bytes do not match immutable authority");lines.push(`${hash}  ${name}\n`)}
if(await Bun.file(sumsPath).text()!==lines.join(""))throw new Error("SHA256SUMS mismatch");
JS
