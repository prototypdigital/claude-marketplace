---
name: code-review
description: Reviews a pull request or code diff before merge — establishes intent, reviews changed lines, reports severity-tiered findings with fixes. Use for PR review or pre-PR self-review.
---

# code-review

Use this skill when reviewing a pull request or a set of code changes before merge.

## Triggers

- Pull request review (any size)
- Post-implementation self-review before opening a PR
- Peer review requested by a teammate

## Required behavior

1. The agent MUST establish intent before reading any code — run `git log --oneline origin/main..HEAD` and `git diff --stat origin/main..HEAD`, read the PR description if available, and state the intent in one sentence. A finding is only valid if it conflicts with the stated intent or introduces unacceptable risk.
2. The agent MUST review the diff, not the full files — run `git diff origin/main..HEAD` and focus on changed lines and their enclosing function or block. Full files should only be read when a change cannot be understood without broader context.
3. The agent MUST reason before critiquing — for each changed area, trace: (a) what the code does after the change, (b) what inputs it accepts and their valid ranges, (c) what can go wrong. Only raise a finding once a concrete consequence can be stated, not a theoretical one.
4. The agent MUST format every finding using Conventional Comments labels with a file and line reference (see Finding format below).
5. The agent MUST check these categories in priority order: correctness, security, error handling, API contracts, performance, test coverage.
6. The agent MUST write a summary after all findings: restate the PR intent, count findings by severity, give a merge verdict (Block / Request changes / Approve with suggestions / Approve), and cite one specific `praise`.
7. The agent SHOULD acknowledge one thing done well per review — cite file and line, not a generic compliment.
8. The agent MUST NOT comment on formatting, whitespace, or style without a project style-guide reference — these belong to automated tools.
9. The agent MUST NOT raise speculative findings — every finding needs a concrete consequence, not a theoretical one.
10. The agent MUST NOT flag issues already caught by CI (type errors, lint failures, failing tests reported in the pipeline).

## Finding format

Every finding must include a file and line reference (`src/foo.ts:42`).

```text
<label>(<optional-scope>): <what in one sentence>

<why — one or two sentences on the consequence if not fixed>

<fix — corrected snippet or concrete alternative, if applicable>
```

| Label | Blocks merge? | Meaning |
|---|---|---|
| `issue` | Yes | Correctness bug, security vulnerability, or data loss risk — must fix before merge |
| `warning` | Recommended | Concrete regression or bad pattern likely to cause problems — strongly advised to fix |
| `suggestion` | No | Worth considering; optional improvement |
| `nitpick` | No | Purely stylistic, no behavioral impact; author can ignore |
| `praise` | — | Something done well — always cite a specific file and line |

Note: `issue`, `suggestion`, `nitpick`, and `praise` follow the Conventional Comments spec. `warning` is a project-level extension for major-but-non-blocking findings.

## Examples

- A PR adds an API endpoint without input validation → `issue(security): src/routes/upload.ts:34 — user-supplied filename passed to fs.writeFile with no sanitisation; path traversal can write to arbitrary paths`
- A PR switches from `Promise.all` to sequential awaits in a loop → `warning(performance): src/jobs/sync.ts:88 — sequential awaits over N items degrades from O(1) to O(N) wait time; use Promise.all to restore concurrent execution`
- A PR extracts a 60-line function into two focused helpers → `praise: src/sync/transform.ts:12-34 — splitting resolveProfiles into two helpers makes the branching logic easy to follow without scrolling`

## Reviewing AI-generated code

When the change under review was produced by an LLM (or an agent), add these checks — they target failure modes specific to generated code:

- **Distrust green tests that were also generated.** A passing test written by the same model that wrote the code is not evidence of correctness — model-authored tests encode the model's *assumption* of intent, and a large share are invalid (one study found only ~44–59% of self-generated tests were valid). Confirm each test asserts the *intended* behavior before treating it as a signal; test-first generation only helps when the tests carry a real, externally-validated signal (e.g. human-confirmed examples), not when the model both writes and trusts its own tests.
- **Scrutinize multi-turn diff edits for regressions.** Code produced as incremental diffs across several turns is more likely to be incorrect *and* insecure than code regenerated whole — security properties that held in an earlier turn can silently break in a later diff. On multi-turn AI edits, re-check the security-relevant behavior of the *current* full state, not just the latest diff, and prefer a whole-file regeneration when correctness or security is critical.
- **Verify every new dependency exists.** Generated code may import hallucinated packages; confirm any added dependency is the real, intended package before approving (see the security pack's package-hallucination / slopsquatting rule).

Sources: TiCoder (IEEE TSE 2024, <https://arxiv.org/abs/2404.10100>) and "Revisiting Self-Debugging" (<https://arxiv.org/abs/2501.12793>) for test-signal validity; MT-Sec (NeurIPS 2025, <https://arxiv.org/abs/2510.13859>) for diff-vs-whole-program correctness and security in multi-turn generation.

## Completion checklist

- [ ] Stated the PR intent in one sentence before reading any code.
- [ ] Reviewed the diff (`git diff origin/main..HEAD`), not full files.
- [ ] Every finding has a Conventional-Comments label, a `file:line` reference, and a concrete consequence.
- [ ] Covered the categories in priority order: correctness, security, error handling, API contracts, performance, tests.
- [ ] Wrote a summary that restates the intent, counts findings by severity, and gives a merge verdict.
- [ ] Cited exactly one specific `praise` (file and line, not generic).
- [ ] For AI-generated changes, ran the three extra checks: distrust self-generated tests, re-check current-state security on multi-turn edits, verify every new dependency exists.

## When NOT to use

- Automated formatting-only PRs (no behavior change)
- Generated code (migrations created by a tool, lock file updates)
- Work-in-progress draft PRs explicitly not ready for review
- Vendored or third-party code outside the PR author's control
