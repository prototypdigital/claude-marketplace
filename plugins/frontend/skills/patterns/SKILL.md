---
name: patterns
description: Finds and reuses an existing codebase pattern instead of inventing new structure. Use when adding files or abstractions, reviewing folder structure, naming, or module boundaries, or refactoring.
---

# patterns

Use this skill when implementing features, reviewing structure, or deciding how to organize new code.

## Triggers

- New feature implementation that requires architectural decisions
- Code review where folder structure, naming, or module boundaries are in question
- Refactoring to align existing code with established project patterns
- A file exceeds 200 lines or a function exceeds 30 lines

## Protocol

### Step 1 — Search before inventing

Run these searches before creating any new file or abstraction:

```bash
# Find the nearest analog: what is the closest existing feature/module?
# Read its directory. Match the structure exactly.

# Search by pattern type:
grep -r "class.*Service"    src/    # service layer
grep -r "class.*Repository" src/    # data access
grep -r "^export.*function use" src/ # custom hooks
ls src/utils/ src/lib/              # utilities
grep -r "router\.(get|post|put|delete)" src/ # API handlers
```

If a match exists → use it as the template, not as inspiration.
If no match exists → document the new pattern in a one-line comment at the top of the file.

### Step 2 — Apply the taxonomy

| Pattern type | Rule |
|---|---|
| Service class | One domain per class. No cross-service imports. Business logic only. |
| Repository | Data access only. No business logic. Returns domain objects, not raw rows. |
| Custom hook | Encapsulates one concern. Name starts with `use`. Returns stable references. |
| Module boundary | Barrel exports only from `index.ts`. Internal files are private to the module. |
| Utility function | Pure function. No side effects. No framework imports. |

### Step 3 — Decide: extend vs create

```text
Does an existing pattern cover ≥80% of the new use case?
  YES → Extend the existing file (add a method, add a parameter with a default).
        Never duplicate a class to "keep the original clean."
  NO  → Create a new file matching the directory structure of the nearest analog.
        Add a one-line comment at the top naming the pattern it establishes.
```

```text
BAD:  // Existing: UserService.ts with createUser(), getUser()
      // New: UserServiceV2.ts "to avoid touching the original"
      // Result: two classes, split callers, drifting logic

GOOD: // Add updateUser(), deleteUser() to UserService.ts
      // One class remains the canonical home for user business logic
```

### Step 4 — Name consistently

- Match the casing, suffix, and prefix of sibling files.
- If siblings use `kebab-case.ts`, do not introduce `PascalCase.ts`.
- Keep the domain name aligned: `Order` → `OrderService` → `OrderRepository` → `useOrder`.

### Step 5 — Flag when pattern guidance is missing

If the decision is non-obvious (a new pattern type, a deliberate deviation from conventions), open a follow-up to add an ADR or update the relevant documentation. Never leave future readers to reverse-engineer intent.

## Completion checklist

- [ ] Searched for an existing analog before creating anything new
- [ ] New structure matches the directory layout and naming of the nearest sibling
- [ ] No cross-domain imports introduced
- [ ] Files >200 lines or functions >30 lines have been extracted into helpers
- [ ] Non-obvious pattern choices are noted (comment or ADR)

## When NOT to use

- Trivial changes: typo fixes, comment updates, single-line edits
- Generated or vendored code
- Prototypes explicitly marked as throwaway
