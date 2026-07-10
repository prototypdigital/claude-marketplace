---
name: migration-safety
description: Reviews or writes database schema migrations against a zero-downtime checklist — destructive ops, lock analysis, batching, rollback path. Use when creating or reviewing a migration pre-deploy.
---

# migration-safety

Use this skill when creating or reviewing database schema migrations. Every migration must survive a zero-downtime deploy and have a tested rollback path.

## Triggers

- New migration file creation
- Schema change review
- Pre-deploy database change validation

## Protocol

### Step 1 — Flag destructive operations (requires explicit approval before merge)

Scan the migration for:

- `DROP TABLE`, `DROP COLUMN`, `DROP INDEX`
- `ALTER COLUMN` that changes type or removes `DEFAULT`
- `TRUNCATE`

```text
BAD:  ALTER TABLE orders DROP COLUMN legacy_status;
      -- Data is gone the moment this runs. No rollback without a backup.

GOOD (two-phase approach):
  -- Migration 001: Add new_status, backfill from legacy_status
  ALTER TABLE orders ADD COLUMN new_status VARCHAR;
  UPDATE orders SET new_status = legacy_status;
  -- Deploy and verify application reads new_status correctly.
  -- Migration 002 (separate deploy): drop legacy_status once no code reads it
  ALTER TABLE orders DROP COLUMN legacy_status;
```

### Step 2 — Lock analysis for hot tables

DDL that takes a full table lock on a table under concurrent writes will cause downtime.

```text
Is the table written to by live production traffic (orders, users, events)?
  YES → Check lock safety of the operation:

  Adding a NOT NULL column WITH a NON-VOLATILE default (a constant, or an
  IMMUTABLE/STABLE expression — now() counts as stable), Postgres 11+
    → Metadata-only: no table rewrite. Still takes a brief ACCESS EXCLUSIVE lock
      to update the catalog, so set a short lock_timeout on a hot table.

  Adding a NOT NULL column WITH a VOLATILE default (clock_timestamp(), random())
    → Full table + index REWRITE — NOT safe on a large table.

  Adding a nullable column → metadata-only, safe.

  CREATE INDEX (no CONCURRENTLY)
    → SHARE lock: blocks writes (INSERT/UPDATE/DELETE) but allows reads — NOT safe on a hot table.
  CREATE INDEX CONCURRENTLY
    → Does not block writes (slower, two scans, cannot run in a transaction block;
      a failed build leaves an INVALID index that must be dropped and rebuilt).

BAD:  ALTER TABLE orders ADD COLUMN priority INTEGER NOT NULL DEFAULT random();
      -- VOLATILE default forces a full table rewrite, locking out the table on a large dataset.

GOOD: ALTER TABLE orders ADD COLUMN priority INTEGER NOT NULL DEFAULT 0;
      -- Non-volatile default is metadata-only in PG 11+ (pre-11: add nullable, backfill, then constrain).
```

### Step 3 — Data migration batching

```text
Row count < ~10k  → single-statement update is usually fine
Row count ≳ ~10k  → batch it to avoid replication lag and long locks
                    (heuristic — tune to row width + index structure; GitLab caps
                     loop batches at ~10k. Prefer "each batch < a few seconds"
                     over a fixed row count.)
```

```sql
-- Postgres batch template
DO $$
DECLARE rows_updated INT;
BEGIN
  LOOP
    UPDATE orders SET new_status = legacy_status
      WHERE new_status IS NULL
      LIMIT 1000;
    GET DIAGNOSTICS rows_updated = ROW_COUNT;
    EXIT WHEN rows_updated = 0;
    PERFORM pg_sleep(0.1);  -- yield between batches
  END LOOP;
END$$;
```

### Step 4 — Rollback path

Every migration MUST have a tested down migration. "Revert the commit" is not a rollback.

```text
BAD:  No down migration provided.
      -- or: Drops the column we just added after rows were written to it (data loss)

GOOD:
  Up:   ALTER TABLE users ADD COLUMN mfa_enabled BOOLEAN DEFAULT false;
  Down: ALTER TABLE users DROP COLUMN mfa_enabled;
  -- Safe because we are dropping a column we just added, before any dependents.
  -- If rows were already written: document the data loss risk explicitly in the PR.
```

### Step 5 — Staging verification

Before approving:

1. Run the up migration against a copy of production data in staging.
2. Run the down migration immediately after — confirm the schema is restored.
3. Record duration. If >5 s on staging, plan for longer on prod (larger dataset). Consider a maintenance window or a non-locking alternative.

## Completion checklist

- [ ] Destructive operations have an explicit approval note in the PR
- [ ] Hot-table DDL uses lock-safe methods (CONCURRENTLY, nullable-first)
- [ ] Data migrations >10k rows use batching with sleep between batches
- [ ] Down migration exists and is tested in staging
- [ ] Migration duration noted; maintenance window planned if >5 s on staging
- [ ] Any dropped column/table has zero remaining references in application code

## When NOT to use

- Application code changes that don't modify the database schema
- Seed data or test fixture updates
- Read-only migrations (creating views, adding comments)
