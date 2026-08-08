---
name: pr-review-loop
description: Wires automated comment-only PR reviews — a GitHub Actions backstop on every PR push plus a local hook that reviews PRs the moment an agent opens them. Use when setting up automated PR review.
profiles:
  - frontend
  - backend
  - fullstack
  - devops
---

# pr-review-loop

Use this skill when wiring automated PR reviews into a project: every opened or updated pull request gets a prompt, comment-only review from a headless agent, without a human having to ask for one.

The loop has two triggers that complement each other:

- **GitHub Actions backstop** — machine-independent; reviews every PR on open and on every new push, regardless of who (or what) created it.
- **Local PostToolUse hook** — instant; when an agent session runs `gh pr create`, a detached headless reviewer starts before the Actions runner has even booted.

Both triggers should drive the same reviewer behavior — install this pack alongside its companion, `bluetemberg-agents-pr-reviewer`, and point both triggers' prompts at that agent's review protocol so authors get one consistent review voice.

## Triggers

- Setting up automated PR review for a repository
- An agent workflow that opens PRs and needs same-session review feedback
- Migrating ad-hoc "please review my PR" prompts into a standing loop

## Protocol

1. Install the `bluetemberg-agents-pr-reviewer` companion pack — both triggers below drive its review protocol.
2. Wire the GitHub Actions backstop (Part 1) so every PR gets reviewed regardless of origin.
3. Wire the local PostToolUse hook (Part 2) for instant same-session feedback when an agent opens a PR.
4. Apply the shared review policy (Part 3) identically in both triggers' prompts.
5. Work through the completion checklist before considering the loop live.

## Part 1 — GitHub Actions backstop

Create `.github/workflows/pr-review.yml`. This is the machine-independent half: it re-reviews on every push to the PR branch, catches PRs opened outside agent sessions, and needs no local setup.

```yaml
name: PR review

on:
  pull_request:
    types: [opened, synchronize]

concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write
  issues: read

jobs:
  review:
    # pull-requests: write is required to post comments, but it also permits
    # gh pr review --approve via the API — a fork PR that prompt-injects the
    # reviewer could otherwise self-approve. Skip forks outright: they can't
    # read the auth secret below anyway, so the job would only fail noisily.
    if: github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # The only GitHub write path granted to the reviewer below. It can list
      # comments, post one summary, and post inline comments — approve,
      # request-changes, merge, and arbitrary gh api access stay impossible
      # regardless of what the reviewed diff prompts the model into.
      # Canonical source: prototypdigital/bluetemberg#226
      # (.claude/hooks/post-review-comment.sh) — keep this copy in sync with it.
      # Written via `bash post-review-comment.sh` below rather than a direct
      # exec, so the heredoc body can share this step's YAML indentation
      # without corrupting the shebang line (which must start at byte 0 to
      # be kernel-interpreted — indented, it would just be a dead comment).
      - name: Write review-posting wrapper
        run: |
          cat > post-review-comment.sh <<'EOF'
          set -euo pipefail
          usage() { echo "usage: post-review-comment.sh <pr-url> list|summary <body>|inline <path> <line> <body>" >&2; exit 1; }
          [[ $# -ge 2 ]] || usage
          pr_url=$1; action=$2
          url_re='^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)$'
          [[ "$pr_url" =~ $url_re ]] || usage
          owner=${BASH_REMATCH[1]}; repo=${BASH_REMATCH[2]}; number=${BASH_REMATCH[3]}
          case "$action" in
            list)
              [[ $# -eq 2 ]] || usage
              exec gh api "repos/$owner/$repo/pulls/$number/comments" --paginate
              ;;
            summary)
              [[ $# -eq 3 ]] || usage
              exec gh pr review "$number" --repo "$owner/$repo" --comment --body "$3"
              ;;
            inline)
              [[ $# -eq 5 ]] || usage
              commit_id=$(gh pr view "$number" --repo "$owner/$repo" --json headRefOid -q .headRefOid)
              exec gh api "repos/$owner/$repo/pulls/$number/comments" \
                -f body="$5" -f commit_id="$commit_id" -f path="$3" -F line="$4" -f side=RIGHT
              ;;
            *) usage ;;
          esac
          EOF

      - uses: anthropics/claude-code-action@v1
        with:
          claude_code_oauth_token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
          # Or API-key auth instead:
          # anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            Review PR #${{ github.event.pull_request.number }} in
            ${{ github.repository }} and post the review on GitHub.

            1. Fetch context: gh pr view --json title,body,files and gh pr diff.
            2. Review intent-first and diff-focused, with severity-tiered
               findings using Conventional Comments labels
               (issue/warning/suggestion/nitpick/praise). Substance over style.
            3. Check existing comments first with:
               bash post-review-comment.sh <pr-url> list
               and do not duplicate anything already posted — on synchronize,
               only review what changed since the last review (see the
               pr-reviewer agent's dedup baseline protocol).
            4. Post exactly one summary:
               bash post-review-comment.sh <pr-url> summary "<body>"
               For line-specific findings:
               bash post-review-comment.sh <pr-url> inline <path> <line> "<body>"
            5. Comment only — the posting script enforces this. End the
               summary with: "Automated review (pr-review-loop)".
          claude_args: |
            --allowedTools "Bash(gh pr view:*),Bash(gh pr diff:*),Bash(bash post-review-comment.sh:*),Read,Grep,Glob"
```

Auth setup, one of:

- `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` locally and add the result as a repository secret (uses a Claude subscription).
- `ANTHROPIC_API_KEY` — add an API key as a repository secret and pass `anthropic_api_key` instead (pay-per-token).

The `concurrency` group cancels a stale in-flight review when a new push arrives, so a rapid push train produces one review of the final state instead of five overlapping ones. The `if` condition means fork PRs get no run at all rather than a job that starts, fails to read the auth secret, and errors — see `## When NOT to use` for repos where that coverage gap matters.

## Part 2 — Local PostToolUse hook

The local half closes the latency gap: the reviewer starts the moment `gh pr create` succeeds inside an agent session. The canonical reference implementation is [prototypdigital/bluetemberg#226](https://github.com/prototypdigital/bluetemberg/pull/226) (`.claude/hooks/spawn-pr-review.sh`, `.claude/hooks/post-review-comment.sh`, and the `.claude/settings.json` entry) — copy it rather than reinventing it. The pattern:

1. **Match precisely.** A `PostToolUse` hook with matcher `Bash` reads the hook input from stdin and word-boundary-matches `gh pr create` in `tool_input.command`, so compound commands (`git push && gh pr create ...`) match but `echo "gh pr create"` lookalikes are the author's problem, not a trigger.
2. **Extract the PR URL** from the hook's `tool_response`, falling back to `gh pr view --json url` in the hook's `cwd`.
3. **Detach and exit 0 immediately.** `PostToolUse` hooks block the authoring session's turn — `nohup claude -p "<review prompt>" ... & disown`, then `exit 0`. The authoring session never waits on the review.
4. **Enforce comment-only at the tool boundary, not just in the prompt.** Ship `.claude/hooks/post-review-comment.sh` (same three subcommands as the Actions wrapper above: `list` / `summary` / `inline`) and grant only `Bash(gh pr view:*),Bash(gh pr diff:*),Bash(<path-to-wrapper>:*),Read,Grep,Glob`. Do not grant raw `Bash(gh pr review:*)` or `Bash(gh api:*)` — those permit `--approve` and arbitrary API calls, which the reviewer's own credentials (the developer's authenticated `gh` session, typically broader than a CI job's scoped token) can act on if a malicious diff prompt-injects the model. Routing writes through the wrapper makes that structurally impossible instead of prompt-enforced. This also removes recursion risk: the reviewer can't run `gh pr create`.
5. **Degrade silently.** If `claude` or `jq` is not installed, or no PR URL can be found, exit 0 without complaint — the Actions backstop still covers the PR.

Register the hook in the project's committed `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/spawn-pr-review.sh",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

This wiring is manual for now: Bluetemberg packs cannot ship hooks by design (guardrail posture — packs are content, not executable config). Engine-synced Claude hooks are tracked in [prototypdigital/bluetemberg#225](https://github.com/prototypdigital/bluetemberg/issues/225); once that lands, this section becomes a pack-shipped artifact instead of copy-paste.

## Part 3 — Review policy

Both triggers must enforce the same policy, in the workflow prompt and the hook prompt alike:

1. **Comment-only, enforced structurally.** Both triggers route all GitHub writes through the posting wrapper (`post-review-comment.sh`) instead of granting `gh pr review:*` / `gh api:*` directly — see Parts 1 and 2. `--approve`, `--request-changes`, merge, and close stay impossible at the tool-permission level, not just by prompt instruction. An automated reviewer that gates merges will eventually lock a release behind a false positive; a human decides what blocks.
2. **Dedupe before posting, with a durable baseline.** The reviewer fetches every existing comment with pagination (`gh api --paginate ...`, not a single unpaginated call — the API defaults to 30 per page) and drops findings already raised, by a human, itself on a previous push, or another bot. It also reads its own past summaries for the `<!-- pr-reviewer: reviewed <sha> -->` marker (see the pr-reviewer agent) and only reviews what changed since that commit, rather than re-scanning the full diff on every push.
3. **One summary per review.** Exactly one review-level comment per invocation, with inline comments carrying the line-specific findings. No comment sprays.
4. **Signed off as automated.** Every summary ends with a fixed sign-off line (e.g. `Automated review (pr-review-loop)`) plus the reviewed-commit marker, so humans can filter it and the dedupe step can recognize its own prior reviews.

## Completion checklist

- [ ] `bluetemberg-agents-pr-reviewer` installed alongside this skill — both triggers drive its review protocol.
- [ ] `.github/workflows/pr-review.yml` committed with `pull_request: [opened, synchronize]`, the fork-PR `if` guard, per-PR concurrency, and the posting-wrapper step.
- [ ] Auth secret (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) added to the repository.
- [ ] Local hook script and `post-review-comment.sh` committed and registered under `PostToolUse` → `Bash` in `.claude/settings.json` (per bluetemberg#226), detaching and exiting 0 immediately.
- [ ] Reviewer tools scoped with `--allowedTools` in both triggers — no edit tools, no `gh pr create`, no raw `gh pr review:*` / `gh api:*` (writes go through the wrapper only).
- [ ] Policy verified in both prompts: comment-only, paginated dedupe with a commit-baseline marker, one summary, automated sign-off line.

## When NOT to use

- Repositories where a human review gate is the point — this loop supplements human review, it never replaces the approval
- Forked-PR-heavy public repos without secret-access controls — the Actions backstop above explicitly skips fork PRs (`if: github.event.pull_request.head.repo.full_name == github.repository`), since they can't read the auth secret anyway; those PRs get no automated review from this loop at all
- One-off review requests — use the code-review skill directly instead of wiring standing automation
