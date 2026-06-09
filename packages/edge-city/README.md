# Edge-City submodules

This directory contains Edge-City-owned repositories mounted as git submodules for local development context inside `indexnetwork/index`.

## Submodules

- `agentvillage` → `Edge-City/agentvillage`
- `agentvillage-landing` → `Edge-City/agentvillage-landing`
- `agentvillage-controlplane` → `Edge-City/agentvillage-controlplane`

The monorepo stores only each submodule path, URL, and pinned commit SHA. Source contents remain owned by the Edge-City repositories, and private repositories require GitHub access.

## Initialize

After cloning `indexnetwork/index`, initialize all Edge-City submodules:

```bash
git submodule update --init packages/edge-city/agentvillage packages/edge-city/agentvillage-landing packages/edge-city/agentvillage-controlplane
```

Or initialize every submodule in the repository:

```bash
git submodule update --init --recursive
```

## Fetch latest upstream changes

Submodules are pinned by commit. To update one pointer after upstream changes land:

```bash
git -C packages/edge-city/<repo> fetch origin main
git -C packages/edge-city/<repo> checkout origin/main
git add packages/edge-city/<repo>
git commit -m "chore(edge-city): update <repo> submodule"
```

Replace `<repo>` with `agentvillage`, `agentvillage-landing`, or `agentvillage-controlplane`.

## Make changes

Do not treat `indexnetwork/index` as the source of truth for Edge-City code. Make code changes inside the submodule repository, then open a PR against the canonical Edge-City repo:

```bash
cd packages/edge-city/<repo>
git checkout main
git pull origin main
git checkout -b <branch>
# edit, test, commit, and push to a fork or branch
gh pr create --repo Edge-City/<repo> --base main
```

After the Edge-City PR merges, update the pinned submodule commit in this monorepo using the fetch/latest flow above.

## Notes

- `agentvillage-landing` and `agentvillage-controlplane` are private repositories; CI and developers need explicit access.
- Avoid editing submodule contents and committing only the parent pointer unless the corresponding Edge-City branch/PR already contains those commits.
