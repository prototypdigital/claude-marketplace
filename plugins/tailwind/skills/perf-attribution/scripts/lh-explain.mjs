#!/usr/bin/env node
// lh-explain — what one Lighthouse report says the score is paying for, in the order that
// matters: the LCP element and its phases, every request that started before the observed LCP
// (the set Lighthouse's simulator charges to the LCP), the origins' protocol and latency, the
// main thread, third parties and layout-shift sources. Reads a report JSON; runs nothing.
//
// Usage: node lh-explain.mjs <report.json> [--top=12]
// Node 20+, no dependencies. Audit ids differ across Lighthouse versions; a section prints
// "n/a" when its audit is absent rather than guessing.

import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
if (!file) {
  console.error('usage: lh-explain.mjs <report.json> [--top=12]')
  process.exit(1)
}
const topN = Number((args.find((a) => a.startsWith('--top=')) ?? '--top=12').slice(6))
const report = JSON.parse(readFileSync(file, 'utf8'))
const audits = report.audits ?? {}
const items = (id) => audits[id]?.details?.items ?? null
const url = report.mainDocumentUrl ?? report.finalDisplayedUrl ?? report.requestedUrl
const origin = new URL(url).origin
const kb = (bytes) => `${Math.round((bytes ?? 0) / 1024)} kB`
const ms = (v) => (typeof v === 'number' ? `${Math.round(v)} ms` : 'n/a')
const short = (u) => {
  try {
    const parsed = new URL(u)
    const text = parsed.origin === origin ? parsed.pathname + parsed.search : parsed.host + parsed.pathname
    return text.length > 72 ? `${text.slice(0, 69)}…` : text
  } catch {
    return String(u).slice(0, 72)
  }
}
const h = (title) => console.log(`\n## ${title}`)
const row = (...cells) => console.log(`  ${cells.join('  ')}`)

// ---- header
const cfg = report.configSettings ?? {}
console.log(`# ${url}`)
console.log(
  `Lighthouse ${report.lighthouseVersion} · ${cfg.formFactor ?? '?'} · ${cfg.throttlingMethod ?? '?'} · cpu ×${cfg.throttling?.cpuSlowdownMultiplier ?? '?'} · performance ${Math.round((report.categories?.performance?.score ?? 0) * 100)}`,
)

// ---- metrics: simulated (the score) next to observed (what the trace saw)
const m = audits.metrics?.details?.items?.[0] ?? {}
h('Metrics — simulated / observed')
row('FCP', ms(m.firstContentfulPaint), '/', ms(m.observedFirstContentfulPaint))
row('LCP', ms(m.largestContentfulPaint), '/', ms(m.observedLargestContentfulPaint))
row('SI ', ms(m.speedIndex), '/', ms(m.observedSpeedIndex))
row('TBT', ms(m.totalBlockingTime), '  TTI', ms(m.interactive))
row('CLS', typeof m.cumulativeLayoutShift === 'number' ? m.cumulativeLayoutShift.toFixed(3) : 'n/a')
row('TTFB', ms(audits['server-response-time']?.numericValue))

// ---- LCP element and phases: read this before anything about bytes.
// Lighthouse 13 reports them in `lcp-breakdown-insight` (a node item plus a subpart table);
// 12 in `largest-contentful-paint-element` (a node table plus a phase table).
function lcpElement() {
  const insight = items('lcp-breakdown-insight')
  if (insight) {
    const node = insight.find((i) => i.type === 'node')
    const phases = (insight.find((i) => i.type === 'table')?.items ?? []).map((p) => ({ label: p.label ?? p.subpart, timing: p.duration }))
    return node ? { node, phases } : null
  }
  const legacy = items('largest-contentful-paint-element')
  const node = legacy?.[0]?.items?.[0]?.node
  if (!node) return null
  return { node, phases: (legacy?.[1]?.items ?? []).map((p) => ({ label: p.phase, timing: p.timing, percent: p.percent })) }
}
h('LCP element')
const lcp = lcpElement()
if (!lcp) console.log('  n/a (no lcp-breakdown-insight or largest-contentful-paint-element audit)')
else {
  const r = lcp.node.boundingRect ?? {}
  row(lcp.node.selector ?? '?')
  row(`label: ${(lcp.node.nodeLabel ?? lcp.node.snippet ?? '').slice(0, 100)}`)
  row(`painted rect: ${r.width ?? '?'}×${r.height ?? '?'} at ${r.left ?? '?'},${r.top ?? '?'}`)
  for (const p of lcp.phases) row(`${String(p.label).padEnd(22)} ${ms(p.timing)}${typeof p.percent === 'number' ? ` (${Math.round(p.percent)}%)` : ''}`)
}
const lcpFlags = [
  'lcp-lazy-loaded',
  'prioritize-lcp-image',
  'lcp-discovery-insight',
  'render-blocking-resources',
  'render-blocking-insight',
  'document-latency-insight',
  'font-display',
  'font-display-insight',
  'uses-responsive-images',
  'unsized-images',
  'image-delivery-insight',
]
  .map((id) => audits[id])
  .filter((a) => a && typeof a.score === 'number' && a.score < 1)
if (lcpFlags.length) {
  console.log('  failing audits on the LCP path:')
  for (const a of lcpFlags) row(`- ${a.id}: ${a.title}${a.displayValue ? ` — ${a.displayValue}` : ''}`)
}

// ---- requests before the observed LCP: the set the simulator charges to it
h('Requests started before the observed LCP')
const requests = items('network-requests') ?? []
const startOf = (r) => r.networkRequestTime ?? r.startTime ?? Infinity
const lcpObserved = m.observedLargestContentfulPaint ?? Infinity
const fcpObserved = m.observedFirstContentfulPaint ?? Infinity
const pre = requests.filter((r) => startOf(r) <= lcpObserved)
const total = requests.reduce((s, r) => s + (r.transferSize ?? 0), 0)
const preBytes = pre.reduce((s, r) => s + (r.transferSize ?? 0), 0)
row(`${pre.length} of ${requests.length} requests, ${kb(preBytes)} of ${kb(total)} transferred`)
const group = (list, key) => {
  const out = {}
  for (const r of list) {
    const k = r[key] ?? '?'
    out[k] = out[k] ?? { n: 0, bytes: 0 }
    out[k].n += 1
    out[k].bytes += r.transferSize ?? 0
  }
  return Object.entries(out).sort((x, y) => y[1].bytes - x[1].bytes)
}
row('by type:    ' + group(pre, 'resourceType').map(([k, v]) => `${k} ${v.n} (${kb(v.bytes)})`).join(', '))
row('by priority:' + group(pre, 'priority').map(([k, v]) => `${k} ${v.n} (${kb(v.bytes)})`).join(', '))
const scriptsBeforeFcp = pre.filter((r) => r.resourceType === 'Script' && startOf(r) <= fcpObserved)
row(`scripts started before FCP: ${scriptsBeforeFcp.length} (${kb(scriptsBeforeFcp.reduce((s, r) => s + (r.transferSize ?? 0), 0))}) — the pre-paint set is the lever, not total weight`)
console.log('  largest:')
for (const r of [...pre].sort((x, y) => (y.transferSize ?? 0) - (x.transferSize ?? 0)).slice(0, topN))
  row(`${String(Math.round(startOf(r))).padStart(6)} ms  ${kb(r.transferSize).padStart(8)}  ${String(r.resourceType ?? '?').padEnd(10)} ${String(r.priority ?? '?').padEnd(8)} ${r.protocol ?? '?'}  ${short(r.url)}`)

// ---- origins
h('Origins')
const protocols = group(requests, 'protocol')
row('protocols: ' + protocols.map(([k, v]) => `${k} ${v.n}`).join(', ') + (protocols.some(([k]) => /h3|quic/i.test(k)) ? '  ← h3 present: Lighthouse models it as HTTP/1.1; rerun with --disable-quic' : ''))
for (const i of items('network-server-latency') ?? []) row(`server latency ${String(Math.round(i.serverResponseTime)).padStart(5)} ms  ${new URL(i.origin).host}`)
for (const i of items('network-rtt') ?? []) row(`rtt            ${String(Math.round(i.rtt)).padStart(5)} ms  ${new URL(i.origin).host}`)

// ---- main thread
h('Main thread')
const breakdown = items('mainthread-work-breakdown')
if (!breakdown) console.log('  n/a')
else for (const i of breakdown.slice(0, 6)) row(`${ms(i.duration).padStart(9)}  ${i.groupLabel ?? i.group}`)
const longTasks = items('long-tasks')
if (longTasks?.length) {
  console.log('  long tasks:')
  for (const t of longTasks.slice(0, topN)) row(`${ms(t.duration).padStart(9)} at ${ms(t.startTime).padStart(8)}  ${short(t.url)}`)
}
const bootup = items('bootup-time')
if (bootup?.length) {
  console.log('  script evaluation + parse:')
  for (const b of bootup.slice(0, topN)) row(`${ms(b.total).padStart(9)}  ${short(b.url)}`)
}
const reflow = audits['forced-reflow-insight']
if (reflow && typeof reflow.score === 'number' && reflow.score < 1)
  row(`forced reflow: ${reflow.displayValue ?? reflow.title} — the first layout reader after a DOM write pays for it; removing one reader moves the cost to the next`)

// ---- third parties (`third-parties-insight` in Lighthouse 13, `third-party-summary` before)
h('Third parties')
const third = items('third-parties-insight') ?? items('third-party-summary')
if (!third?.length) console.log('  none')
else
  for (const t of third.slice(0, topN))
    row(`${kb(t.transferSize).padStart(8)}  main thread ${ms(t.blockingTime ?? t.mainThreadTime).padStart(7)}  ${t.entity?.text ?? t.entity ?? '?'}`)

// ---- layout shifts
h('Layout shifts')
const shifts = items('layout-shifts') ?? items('layout-shift-elements')
if (!shifts?.length) console.log('  none recorded')
else
  for (const s of shifts.slice(0, topN)) {
    const causes = (s.subItems?.items ?? []).map((c) => c.cause ?? c.extra?.value ?? '').filter(Boolean)
    row(`${Number(s.score ?? 0).toFixed(4)}  ${s.node?.selector ?? '?'}${causes.length ? `  ← ${causes.join('; ')}` : ''}`)
  }
console.log("  (Lighthouse's cause is a time-window guess — confirm with a PerformanceObserver before fixing a font)")

// ---- what next
h('Next')
console.log(`  1. Is the LCP element the one the design intends? If not, fix candidacy before touching bytes.
  2. Which of the pre-LCP requests does the proposed change remove or start later? Name them.
  3. Price the ceiling offline: lighthouse <url> -G, edit the devtools log, lighthouse -A.
  4. Prove the fix with lh-ab (interleaved runs), not with one report.`)
