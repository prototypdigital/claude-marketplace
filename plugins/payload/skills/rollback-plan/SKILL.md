---
name: rollback-plan
description: Require and validate a tested rollback plan before merging production deploy, Kubernetes/Terraform, schema-migration, or version-bump PRs. Adds a complexity tier tree, data-loss check, PR template.
---

# rollback-plan

Use this skill when reviewing infrastructure, deployment, or database changes that affect production systems. Every change must have a tested rollback path before merge.

## Triggers

- Changes to deployment manifests (Kubernetes, Docker Compose, Helm values)
- Ansible playbooks targeting production inventory
- Terraform changes to production workspaces
- Database schema migrations
- Dependency or image version bumps in production config
- CI/CD pipeline changes affecting production deploys

## Protocol

### Step 1 — Classify rollback complexity

```text
Is the change stateful (schema migration, volume rename, data transform)?
  YES → Tier A (stateful): rollback requires a tested down migration or data restore procedure.
        Time-to-rollback must be < 15 minutes or a pre-change backup is required.

  NO  → Is the change reversible by re-deploying the previous artifact?
          YES → Tier B (artifact): rollback = re-deploy previous tag.
                Document the exact command; "revert the commit" is not enough.
          NO  → Tier C (destructive, irreversible): flag immediately.
                Change must be gated by a canary deploy and a pre-change backup.
```

### Step 2 — Validate the rollback steps

Reject vague rollback plans:

```text
BAD:  "Rollback: revert the commit"
      "Rollback: undo the change"
      -- These describe intent, not procedure. Ops can't execute them under pressure.

GOOD (Tier B — re-deploy previous artifact):
  1. Identify the last stable image tag: `docker images | grep api | head -5`
  2. Update `IMAGE_TAG` in `.env` to the previous value (e.g., `v1.23.4`)
  3. Run `docker compose up -d api`
  4. Verify health: `curl https://api.example.com/health` returns HTTP 200

GOOD (Tier A — schema migration):
  1. Confirm no application code reads the new column: `grep -r "new_status" src/`
  2. Run down migration: `npm run migrate:down --to 20240610_add_new_status`
  3. Verify schema: `psql -c "\d orders"` — confirm column is absent
  4. Monitor error rate for 5 minutes post-rollback
```

### Step 3 — Check for data loss risk

For any stateful change:

- If rolling back would destroy rows, columns, or files that were written after the change deployed → require a pre-change backup.
- If the backup process takes >5 minutes → include backup timing in the rollback estimate.

```text
Risk levels:
  None → Rollback restores previous state with no data loss (new nullable column, no rows written)
  Low  → Some data loss possible but bounded (backfill not yet complete, partial writes)
  High → Rollback is destructive (dropped column, data transform already applied to production rows)
         → Requires backup before applying the change, not after.
```

### Step 4 — Time-to-rollback gate

If the estimated time to execute the rollback exceeds 15 minutes:

- **Tier A (stateful):** A pre-change backup procedure with a verified restore time is required. A canary deploy may be added as an extra blast-radius limiter but does not replace a tested rollback or data restore procedure — a canary only limits exposure during deploy; it does not restore data.
- **Tier B/C (non-stateful):** A canary deploy plan (so 100% of traffic can be shifted back in < 1 minute) is sufficient.

### Step 5 — PR description block

Every production change PR MUST include:

```markdown
## Rollback plan

**Tier:** [A — stateful / B — artifact / C — destructive]

**Steps:**
1. [Concrete step with exact command]
2. [Concrete step with exact command]

**Time estimate:** [N minutes]

**Data loss risk:** [None / Low — describe / High — backup required]

**Tested in staging:** [Yes / No — explain why not]
```

## Completion checklist

- [ ] Rollback tier classified (A / B / C)
- [ ] Rollback steps are specific commands, not descriptions of intent
- [ ] Data loss risk assessed and documented
- [ ] Time estimate provided; if >15 min → Tier A requires backup procedure; Tier B/C may use canary
- [ ] PR description includes the rollback plan block

## When NOT to use

- Local development or sandbox environments
- Documentation-only changes
- Additive-only changes with no existing state at risk (e.g. a new optional API field with no deploy risk)
