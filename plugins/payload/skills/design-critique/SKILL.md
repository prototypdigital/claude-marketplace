---
name: design-critique
description: Critiques built UI across accessibility, hierarchy, copy, consistency, and device lenses, runs hostile QA, and returns an impact-ranked fix list. Use before shipping a view or when it feels off.
profiles:
  - design-engineer
---

# design-critique

Use this skill when a view or flow is built and needs an honest, multi-angle review before it ships — the pass that finds what is wrong, where, and what to fix first.

## Triggers

- A view or flow is functionally built and ready for a quality pass
- Before shipping, deploying, or presenting a design
- The work "feels off" but the problem hasn't been named
- A milestone is reached and the next move is "find what's wrong, pick a few to fix"

## Required behavior

1. The agent MUST critique across each lens one at a time, returning specific issues with locations (selectors or line numbers) — never general praise or "looks good."
2. The agent MUST report only what to fix, not what is already fine.
3. The agent MUST run a hostile-QA pass: actively try to break the UI (bad input, slow network, empty data, wrong locale, unusual viewport) and name what visibly happens in each unhandled case.
4. The agent MUST end with an impact-ranked fix list, and MUST NOT rank the easy fixes first — rank by visible impact.
5. The agent SHOULD reference the project's visual direction and banned-moves list when judging stock drift and copy.

## The lenses

Run each in turn, giving the worst few issues per lens with locations:

1. **Accessibility** — contrast ratios (actual numbers, not "looks fine"), semantic HTML vs. divs, visible and distinct focus states, keyboard reachability, alt text and input labels.
2. **Visual hierarchy** — what the eye lands on first; what gets lost; whether emphasis matches importance.
3. **Copy** — does it sound human? Check against the banned-words list; flag AI tells and filler.
4. **Consistency** — spacing, type, alignment, and state transitions across the view.
5. **Stock-UI drift** — does it feel generic? Compare against the comp / visual direction.
6. **Device fit** — does it hold on the device the real user actually has, not just a laptop?

Every finding names a location, a measured value, and a fix. Vague is useless:

```text
BAD:  Contrast looks a bit low on the buttons.
GOOD: .btn-primary text #8a8a8a on #f0f0f0 = 2.1:1, fails WCAG AA
      (needs 4.5:1) — darken to #595959.
```

## Hostile QA

```text
Act as a hostile QA tester. Walk through this UI and list every way to break it:
bad input, slow network, wrong file format, empty state, no API response, odd
locale, unusual screen size. Rank by likelihood in real use, not severity. For
each, name what visibly happens right now (the unhandled case).
```

## Impact-ranked fix list

Close with: of everything raised across the lenses and the break list, the three fixes with the largest visible impact — not the easiest. For each: the issue, the fix, and a rough time estimate. The hard fixes are usually the ones that matter.

## Completion checklist

- Every finding has a location (selector or line number).
- All six lenses covered.
- Hostile-QA pass done.
- Fixes are impact-ranked, not easiest-first.
- No praise-only output.

## When NOT to use

- Early exploration where the design isn't built yet (use visual-direction instead)
- A full accessibility audit/remediation (defer to a dedicated a11y specialist)
- Non-visual code review
