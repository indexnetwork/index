# Index Nostr node: relay + Index host + Buzz bridge.
# Build from the repository root:  docker build -f services/nostr/Dockerfile .
FROM oven/bun:1.3.6 AS build
WORKDIR /app
# Only the workspaces this service needs; the root manifest is narrowed to them so
# the install doesn't pull the web app or the API.
COPY bun.lock ./
COPY packages/protocol packages/protocol
COPY packages/nostr packages/nostr
COPY services/nostr services/nostr
RUN echo '{"name":"index-nostr-node","private":true,"workspaces":["packages/protocol","packages/nostr","services/nostr"]}' > package.json \
 && bun install --ignore-scripts \
 && cd packages/protocol && bun run build

FROM oven/bun:1.3.6-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=3000
COPY --from=build /app /app
RUN mkdir -p /data && chown bun:bun /data
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/services/nostr
CMD ["bun", "src/main.ts"]
