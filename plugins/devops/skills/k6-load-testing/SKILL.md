---
name: k6-load-testing
description: Standardizes k6 load tests — scenario taxonomy, shared config/requests libs, baseline-driven p95 thresholds, __ENV parametrization, and a CI smoke gate. Use when writing or editing k6 scripts.
profiles:
  - backend
  - fullstack
  - devops
---

# k6-load-testing

Use this skill when you add or change a k6 load test — a new scenario, a threshold, a request helper, or the CI wiring that runs them. The goal: one shared config/requests layer feeds every scenario, thresholds come from measured baselines rather than guesses, and the suite is parametrized by environment so it can run against any deploy without editing scripts.

## Triggers

- Adding or editing a `.js` k6 scenario (a script that imports `k6/http` and exports `options` + a default function).
- Choosing which scenario type fits a goal ("we need to find the breaking point", "check for memory leaks", "verify it survives a traffic spike").
- Setting, tightening, or relaxing a `thresholds` entry (`http_req_duration: ['p(95)<...']`).
- Wiring k6 into CI (a workflow that runs a scenario on PR or schedule).

## Protocol

### Step 1 — Pick the scenario by its goal, not by feel

Each scenario type answers one question. Pick the one that matches the goal; don't reach for `load` by default.

```text
What are you trying to learn?
  Does it work at all, right now?              → smoke    (1–5 VUs, < 1 min, runs on every PR)
  Does it hold up at expected traffic?         → load     (steady VUs at projected peak)
  Where does it break?                         → stress   (ramp VUs past peak until errors climb)
  Does it degrade over hours (leaks, pools)?   → soak     (moderate VUs held for 1h+)
  Does it survive a sudden burst?              → spike    (flat → sharp jump → flat)
  What's the max throughput before saturation? → capacity (ramp arrival rate, watch p95 cliff)
  Is a specific write/form path safe?          → submission (isolate the POST path, low VUs)
```

A scenario MUST set `scenarios` (or `stages`) and `thresholds` in its exported `options`. One file = one scenario type; do not multiplex stages from different goals into one script.

### Step 2 — Extract the shared lib; never copy-paste parametrization

Two scenarios that hardcode the same base URL, route list, or threshold have already drifted. Put shared concerns in `lib/` and import them.

```text
BAD:  every scenario repeats `const BASE = 'https://staging...'`,
      its own `const routes = [...]`, and its own `http.get(BASE + r, {headers})`.
      Editing a header or threshold means touching N files; they fall out of sync.

GOOD: lib/config.js   → BASE_URL, per-route p95 THRESHOLDS, __ENV-driven slug/locale pools
      lib/requests.js → typed helpers: getPage(route, params), submitForm(payload)
      scenario.js     → import { thresholds } from './lib/config.js'
                        import { getPage } from './lib/requests.js'
```

`config.js` owns thresholds and the `__ENV` pools (Step 4). `requests.js` owns typed request helpers reused across scenarios. Scenarios compose them — they hold only their own VU/stage shape.

### Step 3 — Set p95 thresholds from a measured baseline

A threshold is a promise about a route's real behavior. Derive it; do not guess a round number.

```text
1. Run smoke/load once against a representative environment.
2. Read the per-route p95 from the summary.
3. Set the threshold a deliberate margin above baseline (e.g. p95 ≈ 180ms → set p(95)<250).
4. Tighten only after a measured improvement; relax only with a written reason (e.g. "added
   third-party call, +120ms is expected"). A relaxed threshold without a reason hides a regression.
```

Scope thresholds per route, not one global number — a fast static page and a slow search endpoint should not share a budget. Abort early on catastrophic failure with `abortOnFail` so a broken deploy fails fast instead of running the full ramp.

### Step 4 — Parametrize with `__ENV`, default for local

Hardcoded URLs and a single test slug make the suite lie about real traffic. Read environment, mix the input pool, fall back to a safe local default.

```text
BAD:  const res = http.get('https://staging.example.com/en/products/widget-1')

GOOD: // lib/config.js
      export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
      export const SLUGS   = (__ENV.SLUGS   || 'home,about').split(',')
      export const LOCALES = (__ENV.LOCALES || 'en').split(',')
      // scenario picks a random slug × locale per iteration so load is representative
```

For a multi-locale app, the slug × locale matrix MUST be injected, not baked in — otherwise the test hammers one cached path and reports an unrealistically good p95.

### Step 5 — Choose the output mode for the context

```text
CI / PR gate          → stdout summary (default); fail the job on threshold breach
Local / staging viz   → InfluxDB + Grafana (k6 run --out influxdb=...); docker-compose for dashboards
Artifact / trend      → JSON (k6 run --out json=results.json); archive for over-time comparison
```

### Step 6 — Wire CI: smoke blocks, heavy runs are scheduled

```text
On every PR        → smoke only, against staging. BLOCKS merge on threshold breach.
On schedule/manual  → load / stress / soak / capacity. WARNS (or gates a deploy), never blocks a PR
                      — a 30-minute soak must not sit in the PR critical path.
```

The CI job MUST pass `BASE_URL` (and slug/locale pools) via env so the same scripts target staging in CI and localhost locally.

## Completion checklist

- [ ] Scenario type matches the stated goal (Step 1 decision tree), one type per file
- [ ] No base URL, route list, or threshold is hardcoded in a scenario — all imported from `lib/config.js` / `lib/requests.js`
- [ ] Every threshold is per-route and traceable to a measured baseline, not a guessed round number
- [ ] Inputs (`BASE_URL`, slugs, locales) read from `__ENV` with a safe local default; multi-locale matrix is injected
- [ ] Output mode fits the context (stdout in CI, InfluxDB/Grafana for dashboards, JSON for archival)
- [ ] Smoke runs on PR and blocks on breach; heavy scenarios run on schedule/manual, not in the PR path

## When NOT to use

- The change is a unit/integration/e2e correctness test, not a performance/concurrency test — k6 is the wrong tool.
- A one-off `curl`/`ab` sanity check with no thresholds, no CI, and no reuse — a full scenario is overkill.
- Tuning the system under test (DB indexes, cache config) rather than the test that measures it.
