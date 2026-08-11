FROM oven/bun:1.3.14-alpine
WORKDIR /fixture
RUN bun add postgres@3.4.7
COPY previous-api-server.ts ./previous-api-server.ts
EXPOSE 3001
CMD ["bun", "run", "previous-api-server.ts"]
