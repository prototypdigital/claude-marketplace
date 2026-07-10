---
name: ci-cd-best-practices
description: Audits CI/CD pipeline config (GitHub Actions, GitLab CI) for SHA pinning, dep caching, deploy gates, parallelism, OIDC. Use when adding or editing workflow files or fixing slow/flaky pipelines.
---

# ci-cd-best-practices

Use this skill when creating or modifying CI/CD pipeline configuration.

## Triggers

- New or modified GitHub Actions, GitLab CI, or similar workflow files
- Build performance complaints or flaky pipeline investigation
- Adding new jobs, steps, or deployment stages

## Protocol

### Step 1 — Pin every action to a commit SHA (supply-chain integrity)

Never use `latest` or a mutable tag. Tags can be silently retargeted to malicious
code — exactly what happened in the March 2025 `tj-actions/changed-files`
compromise (CVE-2025-30066), where every version tag was repointed to a commit
that exfiltrated CI secrets into public logs. A full-length commit SHA is the only
immutable reference.

GitHub's docs call for SHA-pinning third-party actions; OpenSSF and security
tooling extend this to **all** actions, including first-party ones like
`actions/checkout`, since any tag is mutable.

```yaml
BAD:
  - uses: actions/checkout@v4          # mutable tag — can be moved
  - uses: actions/checkout@latest
  - uses: docker://node:latest

GOOD:
  - uses: actions/checkout@b4ffde65f46336ab88eb53be808477a3936bae11  # v4.1.1
  - uses: docker://node:20.12.2-alpine  # pin images by digest (@sha256:...) in prod
```

Pair pinning with Dependabot or Renovate so pinned SHAs still receive security updates.

### Step 2 — Cache dependency installs

Every job that installs dependencies must cache them. Without caching, each run re-downloads the entire dependency tree.

```yaml
BAD:
  steps:
    - run: npm ci

GOOD (GitHub Actions):
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: '20'
        cache: 'npm'         # caches ~/.npm automatically
    - run: npm ci
```

For multi-workspace monorepos, cache keys must include the lock file hash:

```yaml
  - uses: actions/cache@v4
    with:
      path: ~/.npm
      key: ${{ runner.os }}-npm-${{ hashFiles('**/package-lock.json') }}
      restore-keys: ${{ runner.os }}-npm-
```

### Step 3 — Enforce the deploy gate

Lint, type-check, and tests MUST all pass before any deploy step can run. Use `needs:` to enforce order.

```yaml
BAD:
  jobs:
    test:   { ... }
    deploy: { ... }    # runs in parallel with test — can deploy broken code

GOOD:
  jobs:
    lint:    { ... }
    typecheck: { ... }
    test:
      needs: [lint, typecheck]
    deploy:
      needs: [test]
      if: github.ref == 'refs/heads/main'
```

### Step 4 — Parallelize independent jobs

Jobs with no dependency between them should run concurrently to reduce wall-clock time.

```yaml
BAD (sequential):
  jobs:
    ci:
      steps:
        - run: npm run lint
        - run: npm run typecheck
        - run: npm test

GOOD (parallel):
  jobs:
    lint:      { steps: [{ run: npm run lint }] }
    typecheck: { steps: [{ run: npm run typecheck }] }
    test:      { steps: [{ run: npm test }] }
    deploy:    { needs: [lint, typecheck, test] }
```

### Step 5 — Use path filters to skip irrelevant runs

On monorepos or repos with multiple concerns, avoid running the full pipeline for unrelated changes.

```yaml
on:
  push:
    paths:
      - 'src/**'
      - 'package*.json'
      - '.github/workflows/ci.yml'
    paths-ignore:
      - 'docs/**'
      - '**.md'
```

### Step 6 — Surface failures clearly

- Set `continue-on-error: false` (the default) — never mask failures with `true` in core jobs.
- Upload test reports or coverage as artifacts so failures are readable without reading raw logs.
- Use concurrency groups to cancel stale runs when a newer push supersedes them:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

### Step 7 — Least privilege and secretless auth

GitHub recommends a read-only default token, elevated per-job only where needed, and OIDC instead of long-lived cloud secrets.

```yaml
permissions:
  contents: read          # workflow-wide default
jobs:
  deploy:
    permissions:
      contents: read
      id-token: write      # only the job that needs OIDC
```

- Default the `GITHUB_TOKEN` to read-only; grant the minimum extra scope per job.
- Authenticate to cloud providers with OIDC (short-lived tokens), not secrets stored in the repo.

## Pipeline audit checklist

- [ ] Every action is pinned to a full commit SHA (not a tag/`latest`); images pinned by digest in prod
- [ ] Pinned SHAs are kept current by Dependabot/Renovate
- [ ] Dependency install steps have a cache configured with a lock-file-hash key
- [ ] Deploy jobs have `needs:` pointing to lint + typecheck + test
- [ ] Independent jobs run in parallel (no artificial sequencing)
- [ ] Path filters skip irrelevant workflows on documentation or unrelated changes
- [ ] `continue-on-error: true` is not set on any core quality gate job
- [ ] Concurrency group set to cancel stale runs
- [ ] Default `GITHUB_TOKEN` is read-only, elevated per-job only where needed
- [ ] Cloud auth uses OIDC, not long-lived secrets

## When NOT to use

- Application code changes that don't touch pipeline configuration files
- Local development tooling setup (pre-commit hooks, editor configs)
