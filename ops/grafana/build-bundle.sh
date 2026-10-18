#!/usr/bin/env bash
# Builds the Grafana provisioning bundle used by the Railway service and prints its start command.
# The bundle is split into 500 character chunks because the service variable API rejects large values.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
out="${1:?usage: build-bundle.sh <output dir>}"
rm -rf "$out"
root="$out/root"
mkdir -p "$root/etc/grafana/provisioning/datasources" "$root/etc/grafana/provisioning/dashboards" "$root/var/lib/grafana-dashboards" "$out/chunks"

cp "$here"/provisioning/datasources/*.yaml "$root/etc/grafana/provisioning/datasources/"
cp "$here"/provisioning/dashboards/*.yaml "$root/etc/grafana/provisioning/dashboards/"
cp "$here"/dashboards/*.json "$root/var/lib/grafana-dashboards/"
cp "$here"/import-dashboards.sh "$root/etc/grafana/import-dashboards.sh"
chmod 755 "$root/etc/grafana/import-dashboards.sh"

tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner -cf - -C "$root" . | gzip -n -9 > "$out/bundle.tgz"
base64 -w0 "$out/bundle.tgz" > "$out/bundle.b64"
prefix="${CHUNK_PREFIX:-TR_}"
split -b 500 -d -a 2 "$out/bundle.b64" "$out/chunks/$prefix"

sha="$(sha256sum "$out/bundle.tgz" | cut -d' ' -f1)"
refs="$(for n in $(ls "$out/chunks" | sort); do printf '$%s' "$n"; done)"
echo "chunks: $(ls "$out/chunks" | wc -l)  bundle bytes: $(stat -c %s "$out/bundle.tgz")  sha256: $sha"

# The five Index dashboards shipped first, in variables IDX_00..IDX_10. They stay as a fallback so a mistyped
# chunk can never leave the service without dashboards: the start command verifies the new bundle and falls back.
prev_sha="e7d7fd23d5df8134d0f2a9bcbbe2b4478a52e1d208cc0fbf5b54b8a8bd3c0851"
prev_refs="$(for n in 00 01 02 03 04 05 06 07 08 09 10; do printf '$IDX_%s' "$n"; done)"
unpack() { printf 'printf %%s "%s" | base64 -d > /tmp/b.tgz && echo "%s  /tmp/b.tgz" | sha256sum -c - && tar xzf /tmp/b.tgz -C /' "$1" "$2"; }
echo "start command:"
echo "sh -c '{ $(unpack "$refs" "$sha"); } || { echo bundle-check-failed-using-previous; $(unpack "$prev_refs" "$prev_sha"); }; if [ -x /etc/grafana/import-dashboards.sh ]; then /etc/grafana/import-dashboards.sh & fi; exec /run.sh'"
