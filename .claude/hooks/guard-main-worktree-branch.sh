#!/usr/bin/env bash
# PreToolUse/Bash guard: the main worktree stays on its current branch.
#
# Branch work belongs in a linked worktree under .worktrees/<slug>, so the main
# checkout is always a stable, buildable tree. This blocks branch-changing
# `git checkout` / `git switch` when they would run in the main worktree, and
# stays out of the way everywhere else:
#   - inside .worktrees/* (a linked worktree) -> allowed
#   - `git checkout -- <path>` / `git checkout <existing path>` -> allowed
#   - `git restore` -> allowed
#
# The main worktree is discovered from `git worktree list`, not hardcoded, so
# the guard survives the repo being moved or cloned elsewhere.

set -uo pipefail

input=$(cat)

# Fast path: most Bash calls have nothing to do with branches. Bail before
# spending a jq/git process on them.
case "$input" in
  *checkout*|*switch*) ;;
  *) exit 0 ;;
esac

cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0
hook_cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
[ -n "$hook_cwd" ] || hook_cwd="$PWD"

deny() {
  jq -n --arg r "$1" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
  exit 0
}

# Emits a deny reason if this segment would move the main worktree's HEAD.
check_segment() {
  local seg="$1"
  local -a parts
  read -ra parts <<< "$seg"
  [ "${#parts[@]}" -gt 0 ] || return 0

  local i=0
  # Skip leading VAR=value assignments (e.g. `GIT_PAGER=cat git checkout x`).
  while [ "$i" -lt "${#parts[@]}" ] && [[ "${parts[$i]}" == *=* && "${parts[$i]}" != /* ]]; do
    i=$((i + 1))
  done
  [ "${parts[$i]:-}" = "git" ] || return 0
  i=$((i + 1))

  # Walk git's own options to find the subcommand, tracking -C so a command
  # that targets another directory is judged against that directory.
  local dir="$hook_cwd" subcmd=""
  while [ "$i" -lt "${#parts[@]}" ]; do
    case "${parts[$i]}" in
      -C) dir="${parts[$((i + 1))]:-$dir}"; i=$((i + 2)) ;;
      -c) i=$((i + 2)) ;;
      -*) i=$((i + 1)) ;;
      *)  subcmd="${parts[$i]}"; i=$((i + 1)); break ;;
    esac
  done

  case "$subcmd" in
    checkout|switch) ;;
    *) return 0 ;;
  esac

  local -a rest=("${parts[@]:$i}")
  local target="" new_branch=0 j=0

  while [ "$j" -lt "${#rest[@]}" ]; do
    case "${rest[$j]}" in
      --) return 0 ;;                       # pathspec form: restoring files
      -b|-B|-c|-C|--orphan) new_branch=1; target="${rest[$((j + 1))]:-}"; break ;;
      --help|-h) return 0 ;;
      -) target="-"; break ;;                # previous branch
      -*) j=$((j + 1)) ;;
      *) target="${rest[$j]}"; break ;;
    esac
  done

  [ -n "$target" ] || return 0
  target="${target%\"}"; target="${target#\"}"
  target="${target%\'}"; target="${target#\'}"

  # `git checkout <thing>` is ambiguous. An existing path is a file restore and
  # leaves HEAD alone; anything git can resolve to a commit moves HEAD.
  if [ "$new_branch" -eq 0 ] && [ "$subcmd" = "checkout" ]; then
    [ "$target" = "." ] && return 0
    [ -e "$dir/$target" ] && return 0
    if [ "$target" != "-" ] &&
       ! git -C "$dir" rev-parse --verify --quiet "${target}^{commit}" >/dev/null 2>&1; then
      return 0
    fi
  fi

  local top main
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 0
  main=$(git -C "$dir" worktree list --porcelain 2>/dev/null | awk 'NR==1 && $1=="worktree"{print $2; exit}')
  [ -n "$main" ] && [ "$top" = "$main" ] || return 0

  local current
  current=$(git -C "$main" branch --show-current 2>/dev/null)

  # Re-checking out the branch already there is a no-op, not a violation.
  [ -n "$current" ] && [ "$target" = "$current" ] && return 0

  if [ "$target" = "-" ]; then
    printf 'Blocked: the main worktree (%s) stays on %s. Switching back to the previous branch would move it. Work in a linked worktree under %s/.worktrees/ instead.' \
      "$main" "${current:-its current branch}" "$main"
    return 0
  fi

  local slug="${target//\//-}"
  local existing
  existing=$(git -C "$main" worktree list --porcelain 2>/dev/null |
    awk -v b="refs/heads/$target" '$1=="worktree"{w=$2} $1=="branch" && $2==b{print w; exit}')

  if [ -n "$existing" ]; then
    printf 'Blocked: the main worktree (%s) stays on %s. Branch "%s" is already checked out at %s — work there instead (use `git -C %s ...` or absolute paths).' \
      "$main" "${current:-its current branch}" "$target" "$existing" "$existing"
  elif [ "$new_branch" -eq 1 ]; then
    printf 'Blocked: the main worktree (%s) stays on %s. To start branch "%s", create a linked worktree instead: `git -C %s worktree add -b %s .worktrees/%s`, then work in %s/.worktrees/%s.' \
      "$main" "${current:-its current branch}" "$target" "$main" "$target" "$slug" "$main" "$slug"
  else
    printf 'Blocked: the main worktree (%s) stays on %s. To work on "%s", create a linked worktree instead: `git -C %s worktree add .worktrees/%s %s`, then work in %s/.worktrees/%s.' \
      "$main" "${current:-its current branch}" "$target" "$main" "$slug" "$target" "$main" "$slug"
  fi
}

# Check each command in a chain independently (`foo && git checkout x`).
while IFS= read -r seg; do
  [ -n "$seg" ] || continue
  reason=$(check_segment "$seg")
  [ -n "$reason" ] && deny "$reason"
done < <(printf '%s\n' "$cmd" | tr ';|&\n' '\n\n\n\n')

exit 0
