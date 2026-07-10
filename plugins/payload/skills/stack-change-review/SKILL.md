---
name: stack-change-review
description: Reviews high-blast-radius infra diffs (docker-compose, Ansible group_vars, Terraform, k8s, .env) — port, volume, image, and env risks. Use when reviewing changes to deployed infrastructure.
---

# stack-change-review

Use this skill when reviewing changes to critical infrastructure files that affect deployed services.

## Triggers

- Changes to `docker-compose*.yml`, `docker-compose*.yml.j2`
- Changes to `group_vars/all.yml` or `group_vars/*/*.yml`
- Changes to Ansible host inventory files
- Changes to `.env` or `.env.j2` files that define service config or secrets
- Changes to Kubernetes manifests (`k8s/`, `manifests/`, `helm/`)
- Changes to Terraform root module (`*.tf` in the project root)

## Protocol

### Step 1 — Classify the blast radius

```text
Does the change affect a shared resource (network, volume, env var used by >1 service)?
  YES → Tier 1 (high blast radius): requires runbook + staging verification before merge
  NO  → Does it affect a stateful resource (volume path, database, persistent queue)?
          YES → Tier 2 (data risk): requires data backup confirmation + rollback steps
          NO  → Tier 3 (isolated): standard review, no special gate
```

### Step 2 — Per-change-type checks

Run only the checks that apply to the diff:

**Port changes** → Flag immediately (breaks firewall rules and dependent containers)

```yaml
# BAD:
services:
  api:
    ports: "3001:3000"  # was "3000:3000" — every firewall rule and dependent container breaks
# GOOD: Open an ADR. Update firewall rules, consumers, and load balancer in the same PR.
#       Document old port → new port in the runbook.
```

**Volume paths** → Flag immediately (data loss risk)

```yaml
# BAD:
volumes:
  - ./postgres-data:/var/lib/postgresql/data  # was ./data/postgres — container sees empty volume
# GOOD: Never rename a volume path without a documented data migration:
#   1. Stop the service. 2. rsync old path → new path. 3. Start with new path.
```

**Image tags** → For each version bump, check the release notes for breaking API or config changes. If breaking changes exist → Tier 1.

**Service names** → Flag any rename (`docker compose down` uses the old name; rename leaves orphaned containers).

**Environment variables** → Flag any var name or default value change; trace all consumers in the same repo.

### Step 3 — Require a runbook for any Tier 1 or Tier 2 finding

If a flag is raised, the PR description MUST include:

```markdown
## Runbook

**Change:** [What is changing]
**Affected systems:** [List every service or resource impacted]
**Rollback steps:**
1. [Concrete step]
2. [Concrete step]
**Pre-change verification:** [What to confirm before applying]
**Post-change verification:** [What to confirm the change is live and healthy]
```

A PR without a runbook for a flagged change MUST NOT be merged.

### Step 4 — Staging gate for Tier 1

Every Tier 1 change MUST be applied to staging first and verified healthy before merging to a production branch. Capture the staging apply output and paste it in the PR.

## Completion checklist

- [ ] Blast radius classified (Tier 1 / 2 / 3)
- [ ] Port, volume, image tag, service name, and env var changes checked
- [ ] Runbook present in PR for any Tier 1 or Tier 2 finding
- [ ] Staging apply output captured for Tier 1 changes
- [ ] Rollback steps are specific (not "revert the commit")

## When NOT to use

- Documentation-only or comment/formatting changes with no behavioral impact
- Adding a brand-new service that does not rename or reconfigure any existing service
- Local development or sandbox stack files (`docker-compose.dev.yml` that never reaches prod)
