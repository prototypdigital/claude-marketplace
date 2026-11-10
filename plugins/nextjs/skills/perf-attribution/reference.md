---
name: perf-attribution-reference
description: Dated observations of Lighthouse and Chrome behaviour behind the perf-attribution skill — measurement traps, LCP candidacy, rendering cost and measured no-wins. Read from SKILL.md; not a skill.
---

# Observed behaviours

Things Lighthouse and Chrome did that are not in their documentation, each with when and where it was seen. They are observations, not rules: verify on your Lighthouse and Chrome versions before building on one, and date your own additions.

## Measurement

- Run-to-run spread on one machine is ±3–5 points. A two-run median produced a false 91; a gain visible at 6 runs vanished at 16. (Lighthouse 13, 2026-09 to 2026-10)
- The first run after a local server switch can load the previous build. A fresh profile, a discarded warm-up and a build marker in the served HTML catch it. (2026-10-29)
- Lighthouse's simulator (Lantern) models HTTP/3 and plain HTTP as HTTP/1.1: the same page scored 95 over h2 and 84 with everything over h3. Run Chrome with `--disable-quic`; put an h2 proxy in front of a local server. (Lighthouse 12–13)
- `--disable-storage-reset` keeps the HTTP cache and silently switches throttling to devtools; a high score with a tiny transfer size is a cache artefact. (Lighthouse 12+)
- The default trace window ends about 2.4 s after `load`; PageSpeed Insights keeps recording. A 7 MB hero video was invisible in the default window (95) and scored 69 on PageSpeed Insights. `pauseAfterLoadMs: 6000` shows it. (2026-09)
- A consent script that serves a stub to bots makes CI and PageSpeed Insights measure a different page from the one users see. Record the third-party state per run; compare only matching runs. (2026-10 to 2026-11)
- `--extra-headers` values are written into every report, JSON and HTML, and cause CORS preflights on cross-origin assets. (Lighthouse 13)
- A Mac measured TBT around 100 ms where a 2-vCPU CI runner measured 750–940 ms. A simulated CPU multiplier of about 6 on the Mac came closest; 20 overshot. (2026-10)
- Bimodal scores came from: a scheduler race on whether async chunks start before first paint; a script-rewriting CDN feature that raised chunk priority; a route-level loading skeleton that throttled the reveal. Split runs by FCP cluster. (2026-10)
- Scores depend on the runner's single-core speed and its distance from the origin. A new runner, tier or host is a new baseline. (2026-10)

## LCP candidacy (Chrome)

- A candidate is sized by its painted rect, transforms included, and clipped by overflow: a hero letter animated from `scale(3)` was the LCP element. Starting at 1.15 moved the page 80 → 89. (2026-09)
- An image covering the full viewport is treated as background and excluded; a cookie banner's text became the LCP instead. Clipping one row off the hero made it the LCP again (77 → 93). (2026-10)
- An element animating `opacity` or `filter` is its own candidate.
- `loading="lazy"` images inside a `display: none` ancestor are fetched immediately; so are lazy images within Chrome's distance threshold (about 1250 px on mobile), which covers off-screen carousel slides.
- Next.js 16: `<Image priority>` preloads the image but no longer sets `fetchpriority="high"`; 130 of 180 pages failed the LCP discovery check until the attribute was added explicitly. (2026-11)

## Rendering

- A `:has()` to the left of a combinator invalidates the whole document on every DOM insertion (801 → 409 ms of style recalc when removed). (Chrome, 2026-10)
- Motion libraries that write inline transforms every frame restyle every frame; off-screen animations that cannot be composited do too.
- Work deferred past `load` still counts toward TBT until Time to Interactive; React commits and layout effects cannot yield.
- Removing one forced-layout reader moves the cost to the next reader. (2026-10)
- A pending image sized only with `max-height` shifts layout when it arrives; a Bold fallback-font width ratio off by 3% caused most of a page's content CLS (0.041 → 0.002 with `size-adjust` on that weight only; recalibrating every weight made it worse). (2026-10)

## Measured on one Next.js 16 site — "measure, don't assume", not rules

Each held on that site under that version. The point is that the textbook answer was wrong there, so it may be wrong on yours.

- `experimental.inlineCss`: flat on the score; the CSS was duplicated into the server-components payload.
- A Suspense boundary around the whole body: −17 to −25.
- Font preload: −3 to −5. Folding the font CSS: flat.
- Server-rendering sections whose leaf components stayed client components: flat, and the document grew.
- Below-the-fold `dynamic()` sections and 5–6 kB server-payload trims: inside the noise.
- Moving static assets from a separate host onto the page's own origin: +4 and FCP −0.3 to −0.45 s (this one won).
- Starting every non-critical script after the first media LCP entry: +9 to +11 locally, +3 to +5 live; the first tap can respond about 300 ms later, so pages whose LCP needs hydration were excluded.
