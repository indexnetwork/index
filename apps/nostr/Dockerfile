# Index on Nostr web client. Build from the repository root:
#   docker build -f apps/nostr/Dockerfile --build-arg VITE_RELAY_URL=wss://… .
FROM oven/bun:1.3.6 AS build
WORKDIR /app
ARG VITE_RELAY_URL=wss://nostr-production.up.railway.app
ARG VITE_DOCS_URL=https://docs-production-81b7b3df.up.railway.app/nostr
ARG VITE_SOURCE_REF=dev
ENV VITE_RELAY_URL=$VITE_RELAY_URL VITE_DOCS_URL=$VITE_DOCS_URL VITE_SOURCE_REF=$VITE_SOURCE_REF
COPY bun.lock ./
COPY packages/protocol packages/protocol
COPY packages/nostr packages/nostr
COPY apps/nostr apps/nostr
RUN echo '{"name":"index-nostr-web","private":true,"workspaces":["packages/protocol","packages/nostr","apps/nostr"]}' > package.json \
 && bun install --ignore-scripts \
 && cd packages/protocol && bun run build \
 && cd ../../apps/nostr && bun run build

FROM oven/bun:1.3.6-slim
WORKDIR /app
COPY --from=build /app/apps/nostr/dist dist
COPY --from=build /app/apps/nostr/serve.ts serve.ts
ENV PORT=3000
EXPOSE 3000
USER bun
CMD ["bun", "serve.ts"]
