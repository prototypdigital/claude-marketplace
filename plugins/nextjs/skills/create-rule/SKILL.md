---
name: create-rule
description: Scaffold a new bluetemberg rule in the correct format — frontmatter, a Why/Rules/BAD-GOOD/config/gotchas body, and sync.
---

# create-rule

Use this skill when asked to add, create, or write a new always-on rule for the project.

## Triggers

- "add a rule that..."
- "create a rule for..."
- "write a rule to enforce..."
- "we should always / never ..." stated as a standing convention
- Any request to encode a passive, always-applied coding standard for the AI tooling

## Required behavior

1. The agent MUST decide rule-vs-skill BEFORE writing anything. Write a **rule** when the behavior is always-on, passive, and needs no invocation (a standard the model should hold in context at all times). Write a **skill** instead when the behavior requires explicit invocation, judgment, or multiple coordinated steps — in that case stop and use the `create-skill` skill.

2. The agent MUST check `llm/rules/` for an existing rule covering the same behavior before creating anything. If one exists, extend it rather than adding a near-duplicate, and report which file.

3. The agent MUST gather the following — if any is unclear from the request, ask:
   - **name**: kebab-case identifier matching the behavior (e.g. `early-returns`, `never-read-env`, `nextjs-public-env-vars`)
   - **description**: one tight sentence stating the rule, imperative voice (this becomes the frontmatter `description` and is what the model sees first)
   - **scope**: the glob the rule applies to. Use `"**"` for project-wide rules; narrow it (e.g. `"**/*.tsx"`, `"**/*.test.ts"`) when the rule is language- or area-specific

4. The agent MUST create the file at exactly `llm/rules/{name}.md` — never any other path or filename.

5. The agent MUST write frontmatter with exactly `description` and `scope`, then a body that follows the house structure (in this order, omitting a section only when it genuinely does not apply):

   **`# Title`** — human-readable rule name.

   **Why (1–2 sentences)** — the consequence the rule prevents. A rule with no stated consequence reads as arbitrary and gets ignored.

   **`## Rules`** — the concrete directives as a tight list. Prefer imperative, testable statements (`if (!x) return` over "consider returning early").

   **BAD / GOOD examples** — at least one fenced code pair showing the wrong way and the corrected way. This is the highest-signal section; never skip it for a rule that constrains code.

   **Config / setup** — any config snippet needed to enforce the rule (tsconfig flag, lint rule, env wiring), when applicable.

   **`## Gotchas`** — edge cases, false-positive traps, or platform-specific caveats, when applicable.

6. The agent MUST keep directives concrete and consequence-driven — no vague guidance ("write clean code"). Every directive should be something a reviewer could check. Specifically:
   - **Pair every prohibition with the positive replacement** — "read from `process.env`" beside "never read `.env`", not a bare "don't". A prohibition alone leaves the model to guess the substitute.
   - **Apply the deletion test** to every line: would removing it cause a mistake? If not, cut it — bloated always-on rules get ignored. Prefer many small rules over one long one.
   - **A rule is advisory, not a guarantee** (instruction-following is ~77% even for strong models). A non-negotiable invariant belongs in a deterministic gate (a guardrail/hook, linter, or CI), with the rule explaining the *why*. Full bar: [Authoring Standards](https://github.com/prototypdigital/bluetemberg-packs/wiki/Authoring-Standards#rules--always-on-passive-context).

7. The agent MUST run `npm run sync:llm-config` (or the project's documented sync command) after writing the file, so the rule propagates to all platform directories (`.claude/rules/`, `.cursor/rules/`, `.github/instructions/`). Do not report the rule as created until sync succeeds.

8. The agent MUST NOT create a rule for behavior that requires explicit invocation or multi-step judgment — that is a skill (`create-skill`).

## Rule template

```markdown
---
description: {One tight imperative sentence stating the rule.}
scope: "**"
---

# {Rule title}

{Why — one or two sentences on the consequence if not followed.}

## Rules

- {Concrete, checkable directive.}
- {Concrete, checkable directive.}

## Examples

\`\`\`ts
// BAD — {why this is wrong}
{counter-example}

// GOOD — {why this is right}
{corrected example}
\`\`\`

## Gotchas

- {Edge case or false-positive trap, if any.}
```

## Examples

- "Add a rule that we always use early returns instead of nested ifs" → creates `llm/rules/early-returns.md`, scope `"**"`, with a BAD nested-if / GOOD guard-clause pair
- "Never let NEXT_PUBLIC vars hold secrets" → creates `llm/rules/nextjs-public-env-vars.md`, scope `"**/*.{ts,tsx}"`, with the secret-name blocklist and BAD/GOOD access patterns

## When NOT to use

- The behavior must be explicitly invoked or involves multiple coordinated steps — author a skill with `create-skill` instead
- A rule covering the same behavior already exists in `llm/rules/` — extend it
- The request is to install an official pack, not author a custom local rule
