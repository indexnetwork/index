#!/usr/bin/env bash
# Prove that an immutable previous API binary cannot authenticate a freshly
# seeded dedicated Hermes credential. Secret material is carried only in
# environment variables, stdin, and process memory.
set -euo pipefail

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

PREVIOUS_API_IMAGE="${PREVIOUS_API_IMAGE:-}"
test -n "$PREVIOUS_API_IMAGE" || fail 'PREVIOUS_API_IMAGE is required; the compatibility gate never skips.'
test "${TEST_DATABASE_SAFE:-}" = '1' || fail 'TEST_DATABASE_SAFE=1 is required.'
test -n "${DATABASE_URL:-}" || fail 'DATABASE_URL is required.'
case "$DATABASE_URL" in
  postgres://*@127.0.0.1:*/hermes_assurance|postgres://*@127.0.0.1:*/hermes_assurance\?*|postgresql://*@127.0.0.1:*/hermes_assurance|postgresql://*@127.0.0.1:*/hermes_assurance\?*) ;;
  *) fail 'DATABASE_URL must name the loopback hermes_assurance database.' ;;
esac

mutable_fixture=false
if test "${NODE_ENV:-}" = 'test' && test "${ALLOW_MUTABLE_PREVIOUS_IMAGE:-}" = '1'; then
  mutable_fixture=true
fi

if [[ "$PREVIOUS_API_IMAGE" =~ @sha256:[0-9a-f]{64}$ ]]; then
  immutable_input=true
elif test "$mutable_fixture" = true; then
  immutable_input=false
else
  fail 'PREVIOUS_API_IMAGE must be supplied by release operations as an immutable digest.'
fi

for command in bun curl docker timeout; do
  command -v "$command" >/dev/null 2>&1 || fail "$command is required."
done

canonical_repository() {
  local repository="${1,,}"
  local last_component
  last_component="${repository##*/}"
  if [[ "$last_component" == *:* ]]; then
    repository="${repository%:*}"
  fi
  case "$repository" in
    index.docker.io/*) repository="docker.io/${repository#index.docker.io/}" ;;
    */*)
      case "${repository%%/*}" in
        *.*|*:*|localhost) ;;
        *) repository="docker.io/$repository" ;;
      esac
      ;;
    *) repository="docker.io/library/$repository" ;;
  esac
  printf '%s' "$repository"
}

temporary_directory="$(mktemp -d)"
container_id=''
fixture_id=''
credential=''
credential_hash=''

cleanup() {
  status=$?
  trap - EXIT INT TERM
  set +e
  cleanup_failed=false
  if test -n "$container_id"; then
    docker stop "$container_id" >/dev/null 2>&1 || cleanup_failed=true
    docker rm "$container_id" >/dev/null 2>&1 || cleanup_failed=true
  fi
  if test -n "$fixture_id"; then
    if ! HERMES_COMPAT_OPERATION=cleanup HERMES_COMPAT_FIXTURE_ID="$fixture_id" \
      timeout --signal=TERM --kill-after=5s 20s bun - >/dev/null 2>&1 <<'BUN'
import postgres from 'postgres';
const fixtureId = process.env.HERMES_COMPAT_FIXTURE_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!fixtureId || !databaseUrl) process.exit(1);
const sql = postgres(databaseUrl, { max: 1 });
const permissionId = `permission-${fixtureId}`;
const credentialId = `credential-${fixtureId}`;
const agentId = `hermes-compat-agent-${fixtureId}`;
const userId = `hermes-compat-user-${fixtureId}`;
try {
  await sql.begin(async (tx) => {
    await tx.unsafe('DELETE FROM agent_permissions WHERE id = $1', [permissionId]);
    await tx.unsafe('DELETE FROM hermes_agent_credentials WHERE id = $1', [credentialId]);
    await tx.unsafe('DELETE FROM agents WHERE id = $1', [agentId]);
    await tx.unsafe('DELETE FROM users WHERE id = $1', [userId]);
  });
} finally {
  await sql.end();
}
BUN
    then
      cleanup_failed=true
    fi
  fi
  credential=''
  credential_hash=''
  rm -rf "$temporary_directory" || cleanup_failed=true
  if test "$cleanup_failed" = true; then
    printf '%s\n' 'Failed to clean up previous API compatibility fixtures.' >&2
    test "$status" -ne 0 || status=1
  fi
  exit "$status"
}
trap cleanup EXIT INT TERM

if test "$immutable_input" = true; then
  docker pull "$PREVIOUS_API_IMAGE" >/dev/null
  repo_digests="$(docker inspect '--format={{range .RepoDigests}}{{println .}}{{end}}' "$PREVIOUS_API_IMAGE" 2>/dev/null || true)"
  test -n "$repo_digests" || fail 'Protected compatibility image has no RepoDigest.'
  supplied_repository="$(canonical_repository "${PREVIOUS_API_IMAGE%@*}")"
  supplied_digest="${PREVIOUS_API_IMAGE##*@}"
  verified_repo_digest=false
  while IFS= read -r candidate; do
    test -n "$candidate" || continue
    [[ "$candidate" =~ @sha256:[0-9a-f]{64}$ ]] || continue
    candidate_repository="$(canonical_repository "${candidate%@*}")"
    candidate_digest="${candidate##*@}"
    if test "$candidate_repository" = "$supplied_repository" && test "$candidate_digest" = "$supplied_digest"; then
      verified_repo_digest=true
      break
    fi
  done <<<"$repo_digests"
  test "$verified_repo_digest" = true \
    || fail 'RepoDigests do not contain the exact supplied repository and digest.'
  image_digest="$PREVIOUS_API_IMAGE"
else
  image_digest="$(docker inspect '--format={{.Id}}' "$PREVIOUS_API_IMAGE" 2>/dev/null || true)"
  [[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Mutable test fixture did not resolve to a local image ID.'
fi

fixture_id="$(HERMES_COMPAT_OPERATION=generate bun - <<'BUN'
process.stdout.write(crypto.randomUUID());
BUN
)"
credential="$(HERMES_COMPAT_OPERATION=generate bun - <<'BUN'
const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
process.stdout.write(`idxh_${secret}`);
BUN
)"
[[ "$credential" =~ ^idxh_[A-Za-z0-9_-]+$ ]] || fail 'Failed to generate a dedicated test credential.'
credential_hash="$(HERMES_COMPAT_OPERATION=hash HERMES_COMPAT_CREDENTIAL="$credential" bun - <<'BUN'
const credential = process.env.HERMES_COMPAT_CREDENTIAL;
if (!credential) process.exit(1);
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(credential));
process.stdout.write(Buffer.from(digest).toString('base64url'));
BUN
)"

actions_json='["manage:identity","manage:premises","manage:intents","manage:networks","manage:opportunities","manage:negotiations"]'
if ! HERMES_COMPAT_OPERATION=seed \
  HERMES_COMPAT_FIXTURE_ID="$fixture_id" \
  HERMES_COMPAT_CREDENTIAL="$credential" \
  HERMES_COMPAT_CREDENTIAL_HASH="$credential_hash" \
  HERMES_COMPAT_ACTIONS_JSON="$actions_json" \
  timeout --signal=TERM --kill-after=5s 20s bun - >/dev/null 2>/dev/null <<'BUN'
import postgres from 'postgres';
const databaseUrl = process.env.DATABASE_URL;
const fixtureId = process.env.HERMES_COMPAT_FIXTURE_ID;
const credential = process.env.HERMES_COMPAT_CREDENTIAL;
const credentialHash = process.env.HERMES_COMPAT_CREDENTIAL_HASH;
const actionsJson = process.env.HERMES_COMPAT_ACTIONS_JSON;
if (!databaseUrl || !fixtureId || !credential?.startsWith('idxh_') || !credentialHash || !actionsJson) process.exit(1);
const canonicalActions = [
  'manage:identity',
  'manage:premises',
  'manage:intents',
  'manage:networks',
  'manage:opportunities',
  'manage:negotiations',
];
const actions = JSON.parse(actionsJson);
if (
  !Array.isArray(actions)
  || actions.length !== canonicalActions.length
  || actions.some((action, index) => action !== canonicalActions[index])
) process.exit(1);
const sql = postgres(databaseUrl, { max: 1 });
const userId = `hermes-compat-user-${fixtureId}`;
const agentId = `hermes-compat-agent-${fixtureId}`;
const permissionId = `permission-${fixtureId}`;
try {
  await sql.begin(async (tx) => {
    await tx.unsafe(
      'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
      [userId, `hermes-compat-${fixtureId}@test.local`, 'Hermes compatibility fixture'],
    );
    await tx`
      INSERT INTO agents (
        id, owner_id, name, type, status, runtime_kind, installation_id,
        runtime_setup_attempt_id, handle_negotiations
      ) VALUES (
        ${agentId}, ${userId}, 'Hermes compatibility fixture', 'external', 'active',
        'hermes', ${`installation-${fixtureId}`}, ${`setup-${fixtureId}`}, true
      )
    `;
    await tx`
      INSERT INTO agent_permissions (id, agent_id, user_id, scope, actions)
      VALUES (${permissionId}, ${agentId}, ${userId}, 'global', ${tx.array(actions)})
    `;
    await tx`
      INSERT INTO hermes_agent_credentials (
        id, secret_hash, owner_id, agent_id, installation_id, setup_attempt_id,
        audience, actions, activation_state, issued_at, expires_at, activated_at
      ) VALUES (
        ${`credential-${fixtureId}`}, ${credentialHash}, ${userId}, ${agentId},
        ${`installation-${fixtureId}`}, ${`setup-${fixtureId}`}, 'hermes-agent',
        ${tx.array(actions)}, 'active', now(), now() + interval '1 hour', now()
      )
    `;
    const [legacyCollision] = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM apikey WHERE key = ${credentialHash}
    `;
    if (Number(legacyCollision?.count ?? 0) !== 0) process.exit(1);
  });
} finally {
  await sql.end();
}
BUN
then
  fail 'Failed to seed the dedicated compatibility credential.'
fi

if ! HERMES_COMPAT_OPERATION=verify-current \
  HERMES_COMPAT_FIXTURE_ID="$fixture_id" \
  HERMES_COMPAT_CREDENTIAL="$credential" \
  HERMES_COMPAT_CREDENTIAL_HASH="$credential_hash" \
  timeout --signal=TERM --kill-after=5s 20s bun - >/dev/null 2>/dev/null <<'BUN'
import postgres from 'postgres';
import { hashApiKey } from './src/lib/apikey/credential';
import { resolveHermesAgentCredential } from './src/guards/auth.guard';
const databaseUrl = process.env.DATABASE_URL;
const fixtureId = process.env.HERMES_COMPAT_FIXTURE_ID;
const credential = process.env.HERMES_COMPAT_CREDENTIAL;
const credentialHash = process.env.HERMES_COMPAT_CREDENTIAL_HASH;
if (!databaseUrl || !fixtureId || !credential || !credentialHash) process.exit(1);
const resolved = await resolveHermesAgentCredential(credential);
if (
  resolved.user.id !== `hermes-compat-user-${fixtureId}`
  || resolved.principal.credentialId !== `credential-${fixtureId}`
  || resolved.principal.agentId !== `hermes-compat-agent-${fixtureId}`
  || resolved.principal.installationId !== `installation-${fixtureId}`
  || resolved.principal.setupAttemptId !== `setup-${fixtureId}`
  || resolved.principal.activationState !== 'active'
) throw new Error('Dedicated compatibility principal mismatch');
const legacyHash = await hashApiKey(credential);
if (legacyHash !== credentialHash) throw new Error('Dedicated compatibility hash mismatch');
const sql = postgres(databaseUrl, { max: 1 });
try {
  const [legacyCollision] = await sql<{ count: number }[]>`
    SELECT count(*)::int AS count FROM apikey WHERE key = ${legacyHash}
  `;
  if (Number(legacyCollision?.count ?? 0) !== 0) {
    throw new Error('Dedicated compatibility hash exists in legacy authority');
  }
} finally {
  await sql.end();
}
process.exit(0);
BUN
then
  fail 'Fresh dedicated compatibility credential failed current authentication.'
fi

container_database_url="${DATABASE_URL/127.0.0.1/host.docker.internal}"
container_id="$(
  DATABASE_URL="$container_database_url" \
  PORT=3001 \
  NODE_ENV=production \
  BETTER_AUTH_SECRET=hermes-compatibility-synthetic-auth-only \
  CONNECT_JWT_SECRET=hermes-compatibility-synthetic-connect-only \
  OPENROUTER_API_KEY=hermes-compatibility-provider-disabled \
  S3_BUCKET=hermes-compatibility-synthetic-bucket \
  S3_ACCESS_KEY_ID=hermes-compatibility-synthetic-access \
  S3_SECRET_ACCESS_KEY=hermes-compatibility-synthetic-secret \
    docker run --detach \
      --log-driver none \
      --add-host host.docker.internal:host-gateway \
      --env DATABASE_URL --env PORT --env NODE_ENV \
      --env BETTER_AUTH_SECRET --env CONNECT_JWT_SECRET --env OPENROUTER_API_KEY \
      --env S3_BUCKET --env S3_ACCESS_KEY_ID --env S3_SECRET_ACCESS_KEY \
      --publish 127.0.0.1::3001 \
      "$PREVIOUS_API_IMAGE"
)"
test -n "$container_id" || fail 'Previous API container did not start.'

host_port="$(docker inspect '--format={{(index (index .NetworkSettings.Ports "3001/tcp") 0).HostPort}}' "$container_id")"
[[ "$host_port" =~ ^[0-9]+$ ]] || fail 'Previous API did not publish a random loopback port.'
health_url="http://127.0.0.1:${host_port}/health"
ready=false
for _attempt in $(seq 1 120); do
  health_status="$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 1 "$health_url" 2>/dev/null || true)"
  if test "$health_status" = '200'; then
    ready=true
    break
  fi
  sleep 0.25
done
test "$ready" = true || fail 'Previous API health readiness did not reach HTTP 200 before the deadline.'

EXPECTED_STATUS=401
probe_status="$(
  printf 'silent\nshow-error\noutput = "/dev/null"\nwrite-out = "%%{http_code}"\nmax-time = 5\nrequest = "GET"\nurl = "http://127.0.0.1:%s/agents/me"\nheader = "x-api-key: %s"\n' \
    "$host_port" "$credential" \
    | curl --config -
)"
test "$probe_status" = "$EXPECTED_STATUS" \
  || fail "Previous API compatibility failed: expected HTTP 401, received ${probe_status:-no status}."

checked_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
report_path="$temporary_directory/report.json"
printf '{"imageDigest":"%s","rejected":true,"status":401,"checkedAt":"%s"}\n' \
  "$image_digest" "$checked_at" >"$report_path"
report_source="$(<"$report_path")"
case "$report_source" in
  *idxh_*|*postgres://*|*postgresql://*) fail 'Compatibility report sanitizer rejected sensitive material.' ;;
esac
if [[ "$report_source" == *"$credential"* || "$report_source" == *"$credential_hash"* || "$report_source" == *"$DATABASE_URL"* ]]; then
  fail 'Compatibility report sanitizer rejected credential, hash, or database material.'
fi

if test -n "${HERMES_PREVIOUS_API_REPORT:-}"; then
  cp "$report_path" "$HERMES_PREVIOUS_API_REPORT"
fi
printf '%s\n' "$report_source"
