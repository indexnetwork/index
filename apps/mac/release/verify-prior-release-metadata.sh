#!/usr/bin/env bash
# Verify one historical macOS metadata/CMS pair before monotonic comparison.
set -euo pipefail
set +x
readonly PRIOR_RELEASE_DIRECTORY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
source "$PRIOR_RELEASE_DIRECTORY/cms-verify.sh"
prior_error() { printf 'historical macOS release refused: %s\n' "$1" >&2; return 1; }
[[ "$#" -eq 2 ]] || prior_error "usage: verify-prior-release-metadata.sh JSON CMS"
metadata="$1"; cms="$2"
[[ -f "$metadata" && ! -L "$metadata" && -f "$cms" && ! -L "$cms" ]] || prior_error "exact JSON and CMS assets are required"
for tool in openssl cmp grep bun mktemp; do command -v "$tool" >/dev/null || prior_error "$tool is required"; done
work="$(mktemp -d "${TMPDIR:-/tmp}/index-prior-cms.XXXXXX")"; chmod 700 "$work"; trap 'rm -rf "$work"' EXIT
verify_opaque_cms_signer "$cms" "$metadata" "$work" || prior_error "historical CMS signer verification failed"
bun - "$metadata" <<'JS'
const path=process.argv[2]; const bytes=await Bun.file(path).text(); let value;
try { value=JSON.parse(bytes); } catch { throw new Error("historical metadata is not JSON"); }
const keys=["apiUrl","architectures","artifacts","buildNumber","commit","connectorProtocolVersion","minimumMacOS","releaseVersion","schemaVersion","teamId","webUrl"];
if (!value || typeof value!=="object" || Array.isArray(value) || JSON.stringify(Object.keys(value).sort())!==JSON.stringify(keys)) throw new Error("historical metadata keys are not exact");
if (value.schemaVersion!==1 || value.apiUrl!=="https://protocol.index.network" || value.webUrl!=="https://index.network" || value.teamId!=="LMQ3XNXLAD" || value.minimumMacOS!=="13.0" || value.connectorProtocolVersion!==1) throw new Error("historical release authority is invalid");
if (!/^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value.releaseVersion) || !/^[1-9]\d*$/.test(value.buildNumber) || !/^[0-9a-f]{40}$/.test(value.commit)) throw new Error("historical version/build/commit is noncanonical");
if (JSON.stringify(value.architectures)!==JSON.stringify(["arm64","x86_64"]) || !Array.isArray(value.artifacts) || value.artifacts.length!==2) throw new Error("historical artifacts are incomplete");
const expected=[[`Index-macOS-${value.releaseVersion}-universal.dmg`,"app-dmg"],[`IndexConnector-${value.releaseVersion}-universal.dmg`,"connector-dmg"]];
for(let i=0;i<2;i++){const a=value.artifacts[i],[name,kind]=expected[i]; const exact=["kind","name","sha256","size","url"];
 if(!a||JSON.stringify(Object.keys(a).sort())!==JSON.stringify(exact)||a.name!==name||a.kind!==kind||a.url!==`https://github.com/indexnetwork/index/releases/download/v${value.releaseVersion}/${name}`||!/^[0-9a-f]{64}$/.test(a.sha256)||!Number.isInteger(a.size)||a.size<=0) throw new Error("historical artifact contract is invalid");}
const canonical=(v)=>{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==="object")return Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])]));return v;};
if(bytes!==JSON.stringify(canonical(value))+"\n") throw new Error("historical metadata bytes are noncanonical");
JS
