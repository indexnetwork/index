# CLI Package

## Responsibility
Standalone npm-distributed `index` terminal client. It packages a CJS shim, platform binaries/JS fallback, build/publish scripts, and TypeScript CLI source under `src/`.

## Dependencies
- **Node/Bun runtime APIs**: binary execution, HTTP callback server, filesystem, readline, build scripts.
- **Remote backend API/MCP tools**: all domain behavior is accessed over HTTP/SSE/tool endpoints.
- **npm optionalDependencies**: platform-specific binary packages.

## Consumers
- **End users**: install/use the `index` binary.
- **Tests/build scripts**: import source modules and packaging helpers.

## Module Structure
```
packages/cli/
├── bin/index.cjs              # plain CJS npm shim
├── npm/<os>-<arch>/           # optional platform packages
├── scripts/build.ts,publish.ts# Bun build/release orchestration
├── src/                       # CLI runtime application
└── tests/                     # parser/client/command/output/package tests
```

## Bin Shim + Platform Package Pattern
```js
const pkg = `@indexnetwork/cli-${process.platform}-${process.arch}`;
try {
  const pkgJson = require.resolve(`${pkg}/package.json`);
  const binary = path.join(path.dirname(pkgJson), 'bin', 'index');
  if (existsSync(binary)) execFileSync(binary, process.argv.slice(2), { stdio: 'inherit' });
} catch {
  const fallback = path.join(__dirname, '..', 'dist', 'index.js');
  execFileSync(resolveRuntime(), [fallback, ...process.argv.slice(2)], { stdio: 'inherit' });
}
```

## Build Matrix Pattern
```ts
const TARGETS = [
  { bunTarget: 'bun-linux-x64', npmDir: 'linux-x64', outName: 'index-linux-x64' },
  { bunTarget: 'bun-darwin-arm64', npmDir: 'darwin-arm64', outName: 'index-darwin-arm64' },
];

for (const target of TARGETS) {
  await $`bun build src/main.ts --compile --target=${target.bunTarget} --outfile dist/${target.outName}`;
  await copyFile(`dist/${target.outName}`, `npm/${target.npmDir}/bin/index`);
}
```

## Boundary Rules
- `bin/index.cjs` must remain plain CommonJS and executable without TypeScript build support.
- Platform package versions and main package optional dependency versions must stay aligned.
- Publish platform packages before the main package.

<important if="you are adding a platform target">
1. Add `npm/<os>-<arch>/package.json` with correct `os/cpu` metadata.
2. Add optional dependency in main `package.json`.
3. Add target to `scripts/build.ts` and publish list.
4. Extend package/build tests for the new target.
</important>
