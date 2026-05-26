# Setting up the edgeclaw-skills sync

The `sync-skills.yml` workflow automatically splits `skills/` from this repo and pushes it to [Edge-City/edgeclaw-skills](https://github.com/Edge-City/edgeclaw-skills) whenever `main` is updated. This makes the skills installable as a standalone plugin on Claude Code, Codex, and OpenClaw.

An Edge City org admin needs to do two things: create a token and add it as a repo secret.

## 1. Create a fine-grained Personal Access Token

1. Go to **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens**
   ([direct link](https://github.com/settings/personal-access-tokens/new))
2. Fill in:
   - **Token name:** `edgeclaw-skills-sync`
   - **Expiration:** 90 days (or custom — you'll need to rotate it)
   - **Resource owner:** `Edge-City`
   - **Repository access:** Only select repositories → `Edge-City/edgeclaw-skills`
   - **Permissions → Repository permissions → Contents:** Read and write
3. Click **Generate token** and copy it.

## 2. Add the token as a repository secret

1. Go to [Edge-City/edgeclaw → Settings → Secrets and variables → Actions](https://github.com/Edge-City/edgeclaw/settings/secrets/actions)
2. Click **New repository secret**
3. **Name:** `SKILLS_SYNC_PAT`
4. **Secret:** paste the token from step 1
5. Click **Add secret**

## 3. Initial push (one-time)

The workflow only runs on new pushes to `main`. To populate `edgeclaw-skills` for the first time, either:

**Option A — Trigger the workflow manually:**
1. Go to [Edge-City/edgeclaw → Actions → Sync edgeclaw-skills](https://github.com/Edge-City/edgeclaw/actions/workflows/sync-skills.yml)
2. Click **Run workflow** → Branch: `main` → **Run workflow**

**Option B — Run locally (requires push access to edgeclaw-skills):**
```bash
git clone https://github.com/Edge-City/edgeclaw.git /tmp/edgeclaw-sync
cd /tmp/edgeclaw-sync
git subtree split --prefix=skills -b skills-split
git push --force https://github.com/Edge-City/edgeclaw-skills.git skills-split:main
cd /tmp && rm -rf edgeclaw-sync
```

## Done

After this, every merge to `Edge-City/edgeclaw` main that touches `skills/` will automatically update `Edge-City/edgeclaw-skills`. Users install with:

```bash
# Claude Code
claude plugin marketplace add Edge-City/edgeclaw-skills
claude plugin install edgeclaw-skills

# OpenClaw
openclaw plugins install git:github.com/Edge-City/edgeclaw-skills

# Codex
codex plugin marketplace add Edge-City/edgeclaw-skills
codex plugin add edgeclaw-skills
```
