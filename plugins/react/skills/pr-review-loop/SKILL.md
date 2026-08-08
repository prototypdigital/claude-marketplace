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
      # EXPECTED_PR_URL additionally pins every call to the one PR being
      # reviewed, so a prompt-injected diff can't redirect comments to
      # another PR in the repo — set as a step env var below, never derived
      # from prompt text the model could influence.
      # Canonical source: prototypdigital/bluetemberg, .claude/hooks/post-review-comment.sh
      # on main — keep this copy in sync with it.
      # Written via `bash post-review-comment.sh` below rather than a direct
      # exec, so the heredoc body can share this step's YAML indentation
      # without corrupting the shebang line (which must start at byte 0 to
      # be kernel-interpreted — indented, it would just be a dead comment).
      - name: Write review-posting wrapper
        run: |
          cat > post-review-comment.sh <<'EOF'
          set -euo pipefail
          usage() { echo "usage: EXPECTED_PR_URL=<pr-url> post-review-comment.sh <pr-url> list|summary <body>|inline <path> <line> <body>" >&2; exit 1; }
          [[ $# -ge 2 ]] || usage
          pr_url=$1; action=$2
          url_re='^https://github\.com/([^/]+)/([^/]+)/pull/([0-9]+)$'
          [[ "$pr_url" =~ $url_re ]] || usage
          owner=${BASH_REMATCH[1]}; repo=${BASH_REMATCH[2]}; number=${BASH_REMATCH[3]}
          if [[ "${EXPECTED_PR_URL:-}" != "$pr_url" ]]; then
            echo "post-review-comment.sh: refusing — <pr-url> ($pr_url) does not match EXPECTED_PR_URL (${EXPECTED_PR_URL:-unset})" >&2
            exit 1
          fi
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
        id: review
        env:
          # Ground truth for the wrapper above — set here, in trusted workflow
          # context, never derived from PR title/body/diff text the model reads.
          EXPECTED_PR_URL: https://github.com/${{ github.repository }}/pull/${{ github.event.pull_request.number }}
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

      # total_cost_usd is not itself a claude-code-action output — only
      # execution_file (the raw `claude -p --output-format json` result) and
      # structured_output are. Parse the file the same way the local hook's
      # worker does, then post through the same wrapper so this step never
      # gains a write path the reviewer itself doesn't already have.
      - name: Post review cost
        if: always() && steps.review.outputs.execution_file != ''
        env:
          EXPECTED_PR_URL: https://github.com/${{ github.repository }}/pull/${{ github.event.pull_request.number }}
          PR_URL: https://github.com/${{ github.repository }}/pull/${{ github.event.pull_request.number }}
          GH_TOKEN: ${{ github.token }}
        run: |
          cost=$(jq -r 'select(.is_error == false) | .total_cost_usd // empty' "${{ steps.review.outputs.execution_file }}")
          if [[ -n "$cost" ]]; then
            bash post-review-comment.sh "$PR_URL" summary "$(printf 'Automated review cost: $%.2f' "$cost")"
          fi
```

Auth setup, one of:

- `CLAUDE_CODE_OAUTH_TOKEN` — run `claude setup-token` locally and add the result as a repository secret (uses a Claude subscription).
- `ANTHROPIC_API_KEY` — add an API key as a repository secret and pass `anthropic_api_key` instead (pay-per-token).

The `concurrency` group cancels a stale in-flight review when a new push arrives, so a rapid push train produces one review of the final state instead of five overlapping ones. The `if` condition means fork PRs get no run at all rather than a job that starts, fails to read the auth secret, and errors — see `## When NOT to use` for repos where that coverage gap matters.

## Part 2 — Local PostToolUse hook

The local half closes the latency gap: the reviewer starts the moment `gh pr create` succeeds inside an agent session. The canonical reference implementation lives in [prototypdigital/bluetemberg](https://github.com/prototypdigital/bluetemberg) on `main` — `.claude/hooks/spawn-pr-review.sh` (the hook entry), `.claude/hooks/run-pr-review.sh` (the detached worker), and `.claude/hooks/post-review-comment.sh` (the posting wrapper) — copy these rather than reinventing them. (Introduced in [#226](https://github.com/prototypdigital/bluetemberg/pull/226); hardened with the `EXPECTED_PR_URL` pin and split into hook+worker in [#231](https://github.com/prototypdigital/bluetemberg/pull/231) — the file paths are the stable reference, not a specific PR diff.) The pattern:

1. **Match precisely.** A `PostToolUse` hook with matcher `Bash` reads the hook input from stdin and word-boundary-matches `gh pr create` in `tool_input.command`, so compound commands (`git push && gh pr create ...`) match but `echo "gh pr create"` lookalikes are the author's problem, not a trigger.
2. **Extract the PR URL** from the hook's `tool_response` — a successful `gh pr create` always prints it; no URL means the command failed or only mentioned `gh pr create`, so nothing spawns. Extraction takes the *first* GitHub PR URL anywhere in the response, so a compound command whose earlier half also prints one (e.g. `gh pr comment 42 --body "see .../pull/7" && gh pr create`) can hand the worker the wrong PR — `EXPECTED_PR_URL` pins every write to whatever URL was extracted, it doesn't verify that URL belongs to *this* `gh pr create` call. Keep `gh pr create` as its own command in agent-authored workflows rather than chaining it after other `gh`/`git` output.
3. **Detach and exit 0 immediately.** `PostToolUse` hooks block the authoring session's turn. The hook only gates and hands off to a worker script — `nohup run-pr-review.sh "$pr_url" ... & disown`, then `exit 0` — so the authoring session never waits on the review, and the worker (which runs the reviewer, then posts the cost comment below) has no time pressure of its own.
4. **Enforce comment-only at the tool boundary, not just in the prompt.** The worker exports `EXPECTED_PR_URL` before invoking the reviewer, and grants only `Bash(gh pr view:*),Bash(gh pr diff:*),Bash(<path-to-post-review-comment.sh>:*),Read,Grep,Glob`. Do not grant raw `Bash(gh pr review:*)` or `Bash(gh api:*)` — those permit `--approve` and arbitrary API calls, which the reviewer's own credentials (the developer's authenticated `gh` session, typically broader than a CI job's scoped token) can act on if a malicious diff prompt-injects the model. `post-review-comment.sh` refuses to act on any `<pr-url>` that doesn't match `EXPECTED_PR_URL`, so a prompt-injected diff can't even redirect comments to a different PR in the repo. This also removes recursion risk: the reviewer can't run `gh pr create`.
5. **Post a cost comment.** After the reviewer's session ends, the worker reads its `total_cost_usd` from the JSON result and posts `Automated review cost: $X.XX (N turns)` directly via `gh pr comment` — fixed template, no model-generated text, so posting it outside the wrapper carries none of the wrapper's risk — so the review layer's own cost is visible where the review lands. Gate this parse-and-post step on `.is_error == false` in the JSON output: on an auth failure `claude -p` still reports `subtype: "success"` with the error text in `.result` and cost `0` — exit status alone doesn't distinguish a real run from a failed one. This gate applies only to the cost comment: the review itself is posted mid-session by the reviewer calling `post-review-comment.sh`, before the worker's `claude -p` call returns and the final JSON result (with its `.is_error` field) even exists.
6. **Degrade silently.** If `claude` or `jq` is not installed, or no PR URL can be found, exit 0 without complaint — the Actions backstop still covers the PR.

Merge this `PostToolUse` entry into the project's `llm/hooks.claude.json` as a sibling of whatever's already there (only create the file fresh if it doesn't exist yet — see [prototypdigital/bluetemberg#225](https://github.com/prototypdigital/bluetemberg/issues/225), shipped in engine 0.9.0). Copying the block below over an existing file instead of merging it will silently drop other event keys — e.g. a `SessionEnd` entry from the `session-retrospective` skill:

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

Run `bluetemberg sync` (or `npm run sync:llm-config`) afterward — it writes this into `.claude/settings.json` for you and preserves any other hooks already wired there (e.g. a `SessionEnd` entry from the `session-retrospective` skill lives under the same file, as a sibling top-level event key). The pack itself still cannot ship this manifest — packs are content, not executable config, and command hooks are only ever honored from the project's own `llm/` — so authoring `llm/hooks.claude.json` once is still a manual, one-time step; everything after that (regenerating `settings.json` on every sync) is automatic.

## Part 3 — Review policy

Both triggers must enforce the same policy, in the workflow prompt and the hook prompt alike:

1. **Comment-only, enforced structurally.** Both triggers route all model-driven GitHub writes through the posting wrapper (`post-review-comment.sh`, pinned to one PR via `EXPECTED_PR_URL`) instead of granting `gh pr review:*` / `gh api:*` directly — see Parts 1 and 2. `--approve`, `--request-changes`, merge, and close stay impossible at the tool-permission level, not just by prompt instruction. The one write that skips the wrapper is the local worker's cost comment (Part 2, step 5): the host script posts it directly via `gh pr comment` after the model's session ends, with a fixed template and no model input, so it carries none of the wrapper's risk. Both triggers supply a custom `prompt`, which puts `claude-code-action`/`claude` in "agent" mode — tools are exactly whatever `--allowedTools` lists, unlike its interactive "tag" mode (`@claude` mentions), which hardcodes a comment-update tool into every run regardless of `--allowedTools`. An automated reviewer that gates merges will eventually lock a release behind a false positive; a human decides what blocks.
2. **Dedupe before posting, with a durable baseline.** The reviewer fetches every existing comment with pagination (`gh api --paginate ...`, not a single unpaginated call — the API defaults to 30 per page) and drops findings already raised, by a human, itself on a previous push, or another bot. It also reads its own past summaries for the `<!-- pr-reviewer: reviewed <sha> -->` marker (see the pr-reviewer agent) and only reviews what changed since that commit, rather than re-scanning the full diff on every push.
3. **One summary per review.** Exactly one review-level comment per invocation, with inline comments carrying the line-specific findings. No comment sprays.
4. **Signed off as automated.** Every summary ends with a fixed sign-off line (e.g. `Automated review (pr-review-loop)`) plus the reviewed-commit marker, so humans can filter it and the dedupe step can recognize its own prior reviews.
5. **Cost is visible, not hidden.** The local trigger posts its own review cost as a follow-up comment (Part 2, step 5). The Actions backstop does the same with a "Post review cost" step (Part 1) that parses `total_cost_usd` out of the `execution_file` output — not itself a claude-code-action output, only `execution_file` and `structured_output` are — and posts it through the wrapper.

## Completion checklist

- [ ] `bluetemberg-agents-pr-reviewer` installed alongside this skill — both triggers drive its review protocol.
- [ ] `.github/workflows/pr-review.yml` committed with `pull_request: [opened, synchronize]`, the fork-PR `if` guard, per-PR concurrency, the posting-wrapper step, `EXPECTED_PR_URL` set as step `env`, and the "Post review cost" step reading `steps.review.outputs.execution_file`.
- [ ] Auth secret (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) added to the repository.
- [ ] Local hook (entry + detached worker) and `post-review-comment.sh` committed and registered under `PostToolUse` → `Bash` in `llm/hooks.claude.json`, synced into `.claude/settings.json`, detaching and exiting 0 immediately.
- [ ] Reviewer tools scoped with `--allowedTools` in both triggers — no edit tools, no `gh pr create`, no raw `gh pr review:*` / `gh api:*` (writes go through the wrapper only, pinned via `EXPECTED_PR_URL`).
- [ ] Policy verified in both prompts: comment-only, paginated dedupe with a commit-baseline marker, one summary, automated sign-off line.

## When NOT to use

- Repositories where a human review gate is the point — this loop supplements human review, it never replaces the approval
- Forked-PR-heavy public repos without secret-access controls — the Actions backstop above explicitly skips fork PRs (`if: github.event.pull_request.head.repo.full_name == github.repository`), since they can't read the auth secret anyway; those PRs get no automated review from this loop at all
- One-off review requests — use the code-review skill directly instead of wiring standing automation
