FROM oven/bun:1.3.14-alpine@sha256:5acc90a93e91ff07bf72aa90a7c9f0fa189765aec90b47bdbf2152d2196383c0
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
RUN bun run --cwd packages/protocol build
RUN bun run --cwd services/api build
WORKDIR /repo/services/api
EXPOSE 3001
CMD ["bun", "--preload", "./dist/instrument.js", "./dist/main.js"]
