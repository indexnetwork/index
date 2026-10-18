#!/bin/sh
# Grafana 13 reads dashboards from unified storage. The file provisioner can
# finish a startup walk without Index - Email showing up there, so the board
# URL 404s. Push that one file through the dashboard API once Grafana is up.
echo "index-dashboard-import: start"
user="${GF_SECURITY_ADMIN_USER:-admin}"
pass="${GF_SECURITY_ADMIN_PASSWORD:-}"
if [ -z "$pass" ]; then
  echo "index-dashboard-import: admin password missing"
  exit 0
fi
auth=$(printf '%s:%s' "$user" "$pass" | base64 | tr -d '\n\r')
base=""
i=0
while [ "$i" -lt 60 ]; do
  for port in ${GF_SERVER_HTTP_PORT:-} ${PORT:-} 3000; do
    [ -n "$port" ] || continue
    if curl -sf "http://127.0.0.1:${port}/api/health" >/dev/null; then
      base="http://127.0.0.1:${port}"
      break
    fi
  done
  [ -n "$base" ] && break
  i=$((i + 1))
  sleep 2
done
if [ -z "$base" ]; then
  echo "index-dashboard-import: grafana did not become ready"
  exit 0
fi
echo "index-dashboard-import: ready"
sleep 2

file=/var/lib/grafana-dashboards/email.json
uid=index-email
if [ ! -f "$file" ]; then
  echo "index-dashboard-import: email.json missing"
  ls -l /var/lib/grafana-dashboards 2>/dev/null || true
  exit 0
fi

folders=$(curl -sf -H "Authorization: Basic $auth" "$base/api/folders" || true)
folder=$(printf '%s' "$folders" | tr -d '\n' | awk '
  {
    n = split($0, parts, "\\{")
    for (i = 1; i <= n; i++) {
      if (parts[i] ~ /"title": *"Index"/) {
        if (match(parts[i], /"uid": *"[^"]+"/)) {
          s = substr(parts[i], RSTART, RLENGTH)
          sub(/.*"uid": *"/, "", s)
          sub(/"$/, "", s)
          print s
          exit
        }
      }
    }
  }
')
echo "index-dashboard-import: folder=${folder:-root}"

body=$(mktemp)
if [ -n "$folder" ]; then
  printf '%s' '{"apiVersion":"dashboard.grafana.app/v1","kind":"Dashboard","metadata":{"name":"'"$uid"'","annotations":{"grafana.app/folder":"'"$folder"'"}},"spec":' > "$body"
else
  printf '%s' '{"apiVersion":"dashboard.grafana.app/v1","kind":"Dashboard","metadata":{"name":"'"$uid"'"},"spec":' > "$body"
fi
cat "$file" >> "$body"
printf '%s' '}' >> "$body"

post() {
  curl -sS -o /tmp/index-import-out -w '%{http_code}' \
    -H "Authorization: Basic $auth" -H 'Content-Type: application/json' \
    -X "$1" "$2" --data-binary @"$3" || echo fail
}

code=$(post POST "$base/apis/dashboard.grafana.app/v1/namespaces/default/dashboards" "$body")
echo "index-dashboard-import: post $code $(head -c 300 /tmp/index-import-out)"
if [ "$code" != "200" ] && [ "$code" != "201" ]; then
  code=$(post PUT "$base/apis/dashboard.grafana.app/v1/namespaces/default/dashboards/$uid" "$body")
  echo "index-dashboard-import: put $code $(head -c 300 /tmp/index-import-out)"
fi
if [ "$code" != "200" ] && [ "$code" != "201" ]; then
  classic=$(mktemp)
  printf '%s' '{"overwrite":true,' > "$classic"
  if [ -n "$folder" ]; then
    printf '%s' '"folderUid":"'"$folder"'",' >> "$classic"
  fi
  printf '%s' '"dashboard":' >> "$classic"
  cat "$file" >> "$classic"
  printf '%s' '}' >> "$classic"
  code=$(post POST "$base/api/dashboards/db" "$classic")
  echo "index-dashboard-import: classic $code $(head -c 300 /tmp/index-import-out)"
  rm -f "$classic"
fi

dto=$(curl -sS -o /tmp/index-import-dto -w '%{http_code}' -H "Authorization: Basic $auth" \
  "$base/apis/dashboard.grafana.app/v2/namespaces/default/dashboards/$uid/dto" || echo fail)
echo "index-dashboard-import: dto $dto $(head -c 200 /tmp/index-import-dto)"
rm -f "$body"
echo "index-dashboard-import: done"
