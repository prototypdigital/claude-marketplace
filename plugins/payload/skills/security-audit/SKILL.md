---
name: security-audit
description: Triages code security findings by severity with detection steps for secrets, injection, auth, input, and dependency risks. Use when reviewing changes pre-deploy or touching auth, input, or uploads.
---

# security-audit

Use this skill when reviewing code changes for security concerns or before deploying to production. Produce a triaged, actionable report — not a raw checklist dump.

## Triggers

- Pre-release or pre-deploy review
- New authentication, authorization, or session management code
- Any code that handles user input, file uploads, external data, or database queries

## Protocol

Steps run in order. Earlier steps are higher severity — stop and fix P0 findings before continuing.

### Step 1 — Secrets scan (P0: block merge immediately)

Search before reading any logic:

```bash
grep -rE "(password|secret|api_key|token|private_key)\s*=\s*['\"][^'\"]{8,}" \
  --include="*.ts" --include="*.js" --include="*.env"
grep -rE "Bearer [A-Za-z0-9\-_]{20,}" .
```

```text
BAD:  const client = new Stripe("sk_live_abc123XYZ")
GOOD: const client = new Stripe(process.env.STRIPE_SECRET_KEY)
```

If a live credential is found: halt, rotate the credential immediately, then continue.

### Step 2 — Injection surfaces (P0: block merge immediately)

For every location that builds a string from user-controlled input:

```text
SQL injection:
  BAD:  db.query(`SELECT * FROM users WHERE id = ${req.params.id}`)
  GOOD: db.query('SELECT * FROM users WHERE id = $1', [req.params.id])

Command injection:
  BAD:  exec(`ffmpeg -i ${req.body.filename} output.mp4`)
  GOOD: execFile('ffmpeg', ['-i', sanitizedPath, 'output.mp4'])

Path traversal:
  BAD:  fs.readFile(`./uploads/${req.params.name}`)
  GOOD: const safe = path.resolve('./uploads', path.basename(req.params.name))
        if (!safe.startsWith(path.resolve('./uploads'))) throw forbidden()
```

### Step 3 — Auth and authorization (P1: fix before merge)

- Every route that modifies data requires an authenticated session check.
- Authorization checks use the server-side session, not a client-supplied ID.
- Passwords are stored hashed with a slow KDF (argon2id / bcrypt / scrypt) and verified with the library's `verify` function (constant-time internally) — never compare passwords with `==`/`===`. Use a raw constant-time compare (`crypto.timingSafeEqual`, `hmac.compare_digest`) only for fixed-length secrets: API tokens, session IDs, HMAC/signature digests.

```text
BAD:  if (req.body.userId === adminId) { /* grant admin access */ }
GOOD: if (req.session.userId !== adminId) return res.status(403).json(...)
```

### Step 4 — Input validation (P1: fix before merge)

- All external input (body, query, params, headers) is validated at the boundary before use.
- File uploads: check MIME type server-side (never trust `Content-Type` alone); enforce byte-size limits.
- Use a schema library (Zod, Joi, Yup) — hand-rolled checks miss edge cases.

### Step 5 — Error responses (P2: fix before release)

Error messages must not expose stack traces, SQL errors, internal file paths, or system identifiers.

```text
BAD:  res.status(500).json({ error: err.stack })
GOOD: logger.error(err)
      res.status(500).json({ type: 'internal_error', message: 'Something went wrong.' })
```

### Step 6 — Dependency scan (P2: advisory)

```bash
npm audit --audit-level=high
```

Flag `high` or `critical` CVEs. Confirm the vulnerable code path is reachable before escalating. A CVE in a dev-only package is not a blocker.

## Severity triage

| Level | Examples | Action |
|---|---|---|
| P0 — block | Hardcoded credential, SQL injection, command injection | Stop. Fix now. Rotate any exposed credentials. |
| P1 — fix before merge | Missing auth check, constant-time bypass, unvalidated upload | Must be resolved in this PR. |
| P2 — fix before release | Stack trace in response, reachable high-CVE dep | Track in backlog, address before next release. |

## Completion checklist

- [ ] Secrets scan completed — no hardcoded credentials
- [ ] All SQL and shell calls use parameterized/safe APIs
- [ ] Auth check present on every state-mutating route
- [ ] Input validated at the system boundary with a schema library
- [ ] Error responses do not leak internal details
- [ ] `npm audit` run; high/critical CVEs triaged by reachability

## When NOT to use

- Pure UI/styling changes with no data handling or network calls
- Documentation-only changes
- Changes fully inside a trusted service boundary with no user-controlled input
