---
name: create-skill
description: Scaffold a new bluetemberg skill to the deep-skill standard — Protocol, decision trees, BAD/GOOD examples, and a completion checklist.
---

# create-skill

Use this skill when asked to add, create, or write a new skill for the project.

## Triggers

- "add a skill that..."
- "create a skill for..."
- "write a skill to..."
- Any request to scaffold a new on-demand workflow for the AI tooling

## Required behavior

1. The agent MUST check `llm/skills/` for an existing skill with the same name or purpose before creating anything. If one exists, report it and stop.

2. The agent MUST gather the following before writing any file — if any is unclear from the request, ask:
   - **name**: kebab-case identifier matching the workflow (e.g. `api-design`, `migration-safety`); ≤64 chars, no reserved words (`anthropic`/`claude`)
   - **description**: the routing signal — `"<What it does>. Use when <trigger contexts>."` in **third person** (never "I…"/"You…"), packed with the keywords a user would actually type (verbs, domain nouns, file extensions). ≤1024 chars. Only `name`+`description` are pre-loaded for auto-invocation, so trigger keywords MUST live here, not only in the body `## Triggers` section. See [Authoring Standards](https://github.com/prototypdigital/bluetemberg-packs/wiki/Authoring-Standards#description--triggering-cross-cutting).
   - **profiles**: which team profiles apply (`frontend`, `backend`, `fullstack`, `devops`, `pure-infra`, `custom`); omit the field entirely if the skill is universal

3. The agent MUST create the file at exactly `llm/skills/{name}/SKILL.md` — never any other path or filename.

4. The agent MUST author the skill to the **deep-skill standard** — a procedure the model can execute, not a restatement of what a base model already knows. Benchmark against `figma-to-code`, `config-echo`, and `create-pack`. Include these sections in order:

   **Opening line** — `Use this skill when [trigger context].`

   **`## Triggers`** — concrete invocation conditions (phrases, verbs, or measurable thresholds), not vague category names; at least two.

   **`## Protocol`** — the ordered steps the model actually follows, written as numbered `### Step N — …`. This replaces a flat MUST/SHOULD list. **Calibrate the structure to the task's degrees of freedom:**
   - **Fragile / deterministic** work (migrations, deploys, destructive ops) → exact steps or commands, a **decision tree** wherever a branch matters (input → which path, no dead ends), and a **BAD/GOOD example** with concrete code or output.
   - **Open-ended judgment** work (a critique, a design review) → higher-freedom prose. Don't force a contrived decision tree or BAD/GOOD pair where it adds no value; a pure ordered diagnostic like `config-echo` may use exact commands instead.
   - Use RFC 2119 keywords (MUST/SHOULD/MAY) inside a step only where authority genuinely varies.

   **`## Completion checklist`** — tick-off criteria the model can verify (`- [ ] …`), not vague quality statements.

   **`## When NOT to use`** — at least one concrete exclusion that exits the skill, to prevent over-firing.

   Be concise: keep `SKILL.md` focused (official ceiling ~500 lines) and push depth into bundled `reference.md` / `examples.md` / `scripts/` linked one level deep rather than inflating one file — ~60–120 lines of dense prose is typical. Too thin (restates generic best practice with no protocol or worked example) and too verbose (over-explains what the model already knows) both fail. For side-effecting skills (deploy/migrate/destructive), set `disable-model-invocation` so they require explicit invocation. Full bar: [Authoring Standards](https://github.com/prototypdigital/bluetemberg-packs/wiki/Authoring-Standards#skills--on-demand-model-invoked-workflows).

5. The agent MUST run `npm run sync:llm-config` after writing the file. This propagates the skill to all platform directories (`.claude/skills/`, `.cursor/skills/`, `.github/skills/`). Do not report the skill as created until sync succeeds.

6. The agent MUST NOT create a skill for behavior that belongs in a rule. Use a **rule** when the behavior is always-on and passive. Use a **skill** when it requires explicit invocation, judgment, or multiple coordinated steps.

## Skill template

````markdown
---
name: {kebab-case-name}
description: {One tight sentence — what it does and when.}
profiles:           # omit this block entirely if universal
  - frontend
---

# {name}

Use this skill when [trigger context].

## Triggers

- "trigger phrase one"
- {measurable condition, e.g. "a function exceeds 30 lines"}

## Protocol

### Step 1 — {imperative action}

{What the model does. Use a decision tree wherever a branch matters:}

```text
Does {condition} hold?
  YES → {path A}
  NO  → {path B}
```

### Step 2 — {imperative action}

```text
BAD:  {the wrong form — concrete code/command/output}
GOOD: {the corrected form}
```

## Completion checklist

- [ ] {verifiable criterion}
- [ ] {verifiable criterion}

## When NOT to use

- {Situation where this skill is the wrong tool or adds noise}
````

## Examples

- "Add a skill that audits API endpoints for REST conventions" → creates `llm/skills/api-design/SKILL.md` with `backend` + `fullstack` profiles, a Protocol whose steps walk naming → pagination → error contract → versioning (each with a decision tree or BAD/GOOD), and a completion checklist
- "Create a skill that checks database migrations before merge" → creates `llm/skills/migration-safety/SKILL.md` with `backend` + `fullstack` profiles, a Protocol with a lock-safety decision tree and a BAD/GOOD destructive-change example

## When NOT to use

- The behavior should fire on every interaction — write a rule in `llm/rules/` instead
- A skill covering the same workflow already exists in `llm/skills/`
- The request is to install an official pack, not author a custom local skill
