---
name: workspace-hygiene
description: Audits the workspace before a commit or PR — confirms diff scope, flags stray console.log/debugger/scratch files and secrets, checks atomic commits. Use after a refactor or before opening a PR.
---

# workspace-hygiene

Use this skill for an on-demand audit of workspace state before committing or opening a pull request.

> **Note:** Formatting, linting, and build checks are handled by the always-on `pre-commit-checks` and `post-edit-diagnostics` rules. This skill covers the manual review steps that those rules cannot automate.

## Triggers

- Before creating a pull request
- After large refactoring or multi-file operations
- When workspace state feels inconsistent or has unintended changes

## Protocol

### Step 1 — Confirm diff scope

```bash
git diff --stat        # what changed, by file
git status             # staged vs unstaged vs untracked
```

Compare the file list against the intent of the change. Every file in the diff must have a reason to be there.

### Step 2 — Scan staged changes for debug artifacts and scratch files

```bash
git diff --staged -G'(console\.log|debugger)'   # added debug statements
git status --short | grep -E '\.(tmp|log|bak)$|scratch|tmp/'   # stray scratch files
```

Flag leftover `console.log` / `debugger` lines and any temporary or scratch file that slipped into staging.

### Step 3 — Scan staged changes for secrets

```bash
git diff --staged | grep -iE '(api[_-]?key|secret|password|token|BEGIN .*PRIVATE KEY)'
```

Any match is a hard stop — unstage the file and move the value to an ignored `.env` before continuing.

### Step 4 — Verify commits are atomic and focused

```bash
git log --oneline origin/main..HEAD   # commits on this branch
```

Each commit should be one logical change. A commit that mixes unrelated concerns (a bug fix plus a style sweep) is not atomic.

### Decision tree

```text
Unintended files in the diff?
  → git restore --staged <file>   (unstage)
  → git stash push -- <file>      (set aside if not ready)

Commit mixes unrelated concerns?
  → git reset -p   (selectively unstage hunks, then re-commit as separate focused commits)

Many commits, each individually clean but messy as a series?
  → suggest squash/reorder for a clean PR history
  → otherwise leave history as-is (don't rewrite clean, atomic commits)
```

## Example

```text
BAD — diff carries an unrelated file and a leftover debug line into the PR:

  $ git diff --stat
   src/auth/login.ts        | 18 ++++++++++----
   src/auth/debug-notes.txt |  4 ++++          # unrelated scratch file
   2 files changed, 20 insertions(+), 2 deletions(-)

  $ git diff --staged -G'(console\.log|debugger)'
  +    console.log('token', token)            # debug line slipping into login.ts
```

```text
GOOD — same change after scoping the diff and removing the debug line:

  $ git restore --staged src/auth/debug-notes.txt   # drop unrelated file
  # remove the console.log line, then re-stage login.ts

  $ git diff --stat
   src/auth/login.ts | 17 +++++++++++------
   1 file changed, 13 insertions(+), 4 deletions(-)

  $ git diff --staged -G'(console\.log|debugger)'   # no output — clean
```

## Completion checklist

- [ ] `git diff --stat` reviewed; every file in the diff belongs to the change
- [ ] No leftover `console.log` / `debugger` lines or scratch files staged
- [ ] Secret scan run on staged changes with no matches
- [ ] Each commit is one logical, atomic change
- [ ] Branch history left clean (squash/reorder only if the series is messy)

## When NOT to use

- Exploratory prototyping where polish is premature
- Work-in-progress branches explicitly marked as drafts
