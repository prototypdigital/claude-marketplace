---
name: figma-to-code
description: Translates a Figma comp, screenshot, or mockup into working UI/HTML/CSS code section-by-section. Use when building UI from a design reference or when generated UI drifts from the comp.
profiles:
  - design-engineer
---

# figma-to-code

Use this skill when translating a design reference — a Figma comp, an exported screenshot, or an approved mockup — into working HTML/CSS/component code while keeping the designer's character intact.

## Triggers

- A Figma frame or screenshot needs to become real UI
- A design reference exists and the build must match it, not approximate it
- Generated UI is drifting from the comp and needs to be brought back
- A view is being built and you are tempted to prompt for the whole page at once

## Required behavior

1. The agent MUST build one section at a time — nav, then hero, then the next — never the whole page in a single prompt. Each section gets its own focused build.
2. The agent MUST stack the inputs in every build prompt: the reference image, the design tokens as explicit values, the relevant banned moves, and the two-word visual-direction name. The screenshot is mood; the tokens are specifics.
3. The agent MUST match proportions, spacing, type, and alignment to the reference, and MUST NOT normalize an unusual choice — it asks instead, because unusual is usually the point.
4. The agent MUST run a drift check after every two sections and before calling a view done (see drift catalog below).
5. The agent MUST re-paste the tokens in every refinement; they fade from context and the model reaches for safe defaults without them.
6. The agent SHOULD edit a value directly when the fix is a sub-30-second CSS change (a hex, a font-size, a margin) rather than spend a prompt on it.
7. When a build is wrong, the agent MUST get more specific — name the exact difference, quote the exact value, re-read or re-export the reference — never ask vaguely for "better."

## The loop

1. **Design the section** in Figma (or start from the approved comp). Real content, real type, real spacing.
2. **Export at 2×.** Higher resolution lets the model read details that small exports flatten.
3. **Prompt with the full stack** (template below).
4. **Compare side by side.** Open the build next to the reference; note specific differences, not "close enough."
5. **Refine surgically.** Name the exact change: "Move X to Y. Don't touch anything else."
6. **Hand-edit when faster.** A value you can fix in 30 seconds, fix yourself.
7. **Repeat per section** — anchored to its reference each time. Never refine an earlier section after moving past it; it will drift.

## Build prompt template

```text
[Attach the section screenshot — exported at 2×]

Build the [section name] section as a single HTML file. Match the reference closely.

Constraints:
- Use these tokens (exact values): [paste palette, type scale, spacing, radii]
- Use these fonts: [Google Fonts links]
- Visual direction: "[two-word name]" — [3-word feel]
- Banned moves: [paste the relevant items]
- Build only this section. Do not add other sections or "improvements."

If something in the reference looks unusual, treat it as intentional — ask me, don't smooth it out.
```

## Refinement contrast

BAD — vague and unscoped; the model fills the gap with generic SaaS:

```text
Make the page look better and build out the rest of it.
```

GOOD — section-scoped, tokens re-pasted, exact change named:

```text
[Attach the hero screenshot — exported at 2×]

Match the hero to the comp. Re-apply these tokens (exact values): [paste palette, type scale, spacing, radii].
Heading is 96px / line-height 0.95 / letter-spacing −2%, left-aligned, full-bleed background.
Do not touch other sections. Do not add improvements.
```

## Drift catalog — check after every two sections

- **Stock drift** — corners rounded that shouldn't be, colors reverted to safer ones, type gone default, shadows or gradients no one asked for, padding gone uniform. Ask: "Has anything drifted toward generic SaaS? Check rounded corners, default colors, normalized spacing, shadows or gradients I didn't ask for." Patch only the drift, with line numbers.
- **Token drift** — a value silently swapped for a "standard" one after the tokens left context. Re-paste tokens; restore the value.
- **Scope creep** — extra sections appended because the model pattern-matched a fuller page. "Build only this section. Do not add anything I haven't asked for."

## Escalation ladder — when a section won't match

Climb, don't simplify:

1. "Match the comp."
2. Describe the difference in design language ("the hero feels too contained — match the full-bleed treatment").
3. Quote exact values ("heading 96px, line-height 0.95, letter-spacing −2%").
4. Give a token reference, not just a value.
5. Re-export the comp at higher resolution.
6. Annotate the comp directly (arrows, labels: "this gap = 64px") and re-export. The most underused move — try it before giving up.

## Completion checklist

- Every section built and anchored to its own reference image, one section per build.
- Tokens re-pasted on the final refinement of each section, not just the first build.
- Drift check run before calling the view done — rounded corners, default colors, normalized spacing.
- No scope creep: nothing built or added beyond the section that was requested.

## When NOT to use

- Building from scratch with no design reference or visual direction (set the direction first)
- Trivial one-off elements — a single button or label — where batching is fine
- Backend, data, or non-visual work
