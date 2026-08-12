FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
WORKDIR /repo
COPY package.json bun.lock ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/eval-ops/package.json ./apps/eval-ops/package.json
COPY services/api/package.json ./services/api/package.json
COPY packages/protocol/package.json ./packages/protocol/package.json
COPY packages/cli/package.json ./packages/cli/package.json
COPY packages/claude-plugin/package.json ./packages/claude-plugin/package.json
COPY packages/hermes-plugin/package.json ./packages/hermes-plugin/package.json
RUN bun install --frozen-lockfile --ignore-scripts
COPY services/api/src/cli/tests/fixtures/previous-api-server.ts ./services/api/src/cli/tests/fixtures/previous-api-server.ts
WORKDIR /repo/services/api
EXPOSE 3001
CMD ["bun", "run", "src/cli/tests/fixtures/previous-api-server.ts"]
