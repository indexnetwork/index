# AgentVillage submodule workflow

`packages/agentvillage` is a git submodule whose canonical repository is `Edge-City/agentvillage`.

This monorepo keeps the submodule only so Index development has local AgentVillage context. Do not treat `indexnetwork/index` as the source of truth for AgentVillage file contents.

## Initial setup

```bash
git submodule update --init packages/agentvillage
```

## Making AgentVillage changes

1. Work inside the submodule:

   ```bash
   cd packages/agentvillage
   git checkout main
   git pull origin main
   git checkout -b <branch>
   ```

2. Commit changes in the submodule repository and open a PR against `Edge-City/agentvillage:main`.
3. After the Edge-City PR merges, update this monorepo's pointer:

   ```bash
   cd ../..
   git -C packages/agentvillage fetch origin main
   git -C packages/agentvillage checkout origin/main
   git add packages/agentvillage
   git commit -m "chore(agentvillage): update submodule"
   ```

## Migration preservation note

When `packages/agentvillage` was converted from tracked subtree files to a submodule, the tracked tree in `indexnetwork/index` matched `Edge-City/agentvillage@3831d4a790d75786fc36a7ad7049a04f459a89aa` exactly:

```text
index tree: 0123d7e8541e55d9705aaccdf69b93edf79566dc
Edge tree:  0123d7e8541e55d9705aaccdf69b93edf79566dc
```

No local AgentVillage file content was dropped by the conversion; the pre-submodule contents remain in this repository's history, and `Edge-City/agentvillage` remains canonical.
