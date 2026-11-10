#!/usr/bin/env node
// lh-ab — an interleaved Lighthouse A/B of two URLs, or a baseline series of one, with the
// controls that keep runs comparable built in rather than remembered:
//
//   - one Chrome, QUIC off, a fresh profile; one discarded warm-up per variant (a cold GPU and
//     code cache cost 2–3 s on the first frame, read as a low score with nothing wrong)
//   - A and B interleaved, the order swapped every round, so neither gets the warmer machine
//   - storage reset left on (`--disable-storage-reset` keeps the HTTP cache and silently
//     switches throttling to devtools)
//   - a run discarded when the document was not a 2xx from the measured origin, when a
//     first-party script, stylesheet or font failed, or when the served HTML does not carry the
//     variant's build marker (the first run after a server switch can load the previous build)
//   - protocol mix and per-origin server latency logged per run: both move scores on their own
//   - the run list, min, median and max reported — never a lone median
//
// Usage:
//   node lh-ab.mjs --a=<url> [--b=<url>] [--label-a=base] [--label-b=change]
//                  [--marker-a=<text in the served HTML>] [--marker-b=<text>]
//                  [--runs=5] [--preset=mobile|desktop] [--cpu=<cpuSlowdownMultiplier>]
//                  [--long] [--block=<url pattern>,...] [--html] [--out=lh-ab]
//
//   --cpu    Lighthouse's simulated CPU multiplier (default 4, what PageSpeed Insights uses).
//            On a fast laptop 6 approximates a 2-vCPU CI runner's TBT; 20 overshoots.
//   --long   a 6 s window after `load` — what PageSpeed Insights records and the default
//            trace window does not (a 7 MB hero video was invisible in the default window)
//   --block  third parties whose state varies per run (consent banners, tag managers)
//
// Env:
//   LIGHTHOUSE_BIN  the lighthouse command (default `npx --yes lighthouse@13.4.1`; keep it
//                   pinned — scores are only comparable within one Lighthouse version)
//   CHROME_PATH     the browser to launch (auto-detected otherwise)
//   LH_AB_PORT      Chrome's debug port (9333)
//
// Exit: 0 when every variant produced runs, 2 when one produced none.
// Node 20+, no dependencies.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  return hit.includes('=') ? hit.slice(name.length + 3) : true
}

const variants = [
  { key: 'a', url: flag('a'), label: String(flag('label-a', 'base')), marker: flag('marker-a') },
  { key: 'b', url: flag('b'), label: String(flag('label-b', 'change')), marker: flag('marker-b') },
].filter((v) => typeof v.url === 'string')
if (!variants.length || variants[0].key !== 'a') {
  console.error('usage: lh-ab.mjs --a=<url> [--b=<url>] [--runs=5] … (see the header)')
  process.exit(1)
}
const runs = Number(flag('runs', 5))
const preset = String(flag('preset', 'mobile'))
const cpu = flag('cpu') ? Number(flag('cpu')) : null
const longWindow = flag('long') === true
const keepHtml = flag('html') === true
const blocked = flag('block') ? String(flag('block')).split(',').filter(Boolean) : []
const outDir = path.resolve(String(flag('out', 'lh-ab')))
mkdirSync(outDir, { recursive: true })
const lighthouseBin = (process.env.LIGHTHOUSE_BIN ?? 'npx --yes lighthouse@13.4.1').split(' ')
const DEBUG_PORT = Number(process.env.LH_AB_PORT ?? 9333)

// ---- Lighthouse config: everything that shapes a run is in one file next to the results, so a
// summary can always be traced back to its settings. Throttling values are Lighthouse's own
// defaults (core/config/constants.js), spelled out so a version bump cannot move them silently.
const throttling =
  preset === 'desktop'
    ? { rttMs: 40, throughputKbps: 10240, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0, cpuSlowdownMultiplier: 1 }
    : { rttMs: 150, throughputKbps: 1638.4, requestLatencyMs: 562.5, downloadThroughputKbps: 1474.56, uploadThroughputKbps: 675, cpuSlowdownMultiplier: 4 }
if (cpu !== null) throttling.cpuSlowdownMultiplier = cpu
const settings = {
  onlyCategories: ['performance'],
  throttlingMethod: 'simulate',
  throttling,
  maxWaitForLoad: 90000,
  blockedUrlPatterns: blocked,
  ...(preset === 'desktop' && {
    formFactor: 'desktop',
    screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  }),
  ...(longWindow && {
    pauseAfterFcpMs: 1000,
    pauseAfterLoadMs: 6000,
    networkQuietThresholdMs: 5000,
    cpuQuietThresholdMs: 5000,
  }),
}
const configPath = path.join(outDir, 'lighthouse-config.json')
writeFileSync(configPath, JSON.stringify({ extends: 'lighthouse:default', settings }, null, 2))

// ---- Chrome
const CHROME_FLAGS = [
  '--headless=new',
  '--disable-quic',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-dev-shm-usage',
]

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const hit = spawnSync('which', [bin], { encoding: 'utf8' })
    if (hit.status === 0 && hit.stdout.trim()) return hit.stdout.trim()
  }
  for (const mac of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ]) {
    if (existsSync(mac)) return mac
  }
  throw new Error('No Chrome found — set CHROME_PATH')
}

async function launchChrome() {
  const profile = mkdtempSync(path.join(os.tmpdir(), 'lh-ab-chrome-'))
  let stderr = ''
  let exited = null
  const child = spawn(
    findChrome(),
    [...CHROME_FLAGS, `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  )
  child.stderr.on('data', (d) => {
    stderr = (stderr + d.toString()).slice(-4000)
  })
  child.on('exit', (code, signal) => {
    exited = { code, signal }
  })
  const started = Date.now()
  while (Date.now() - started < 60_000) {
    if (exited) throw new Error(`Chrome exited before opening port ${DEBUG_PORT}:\n${stderr.trim()}`)
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)
      if (res.ok) return child
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  child.kill()
  throw new Error(`Chrome did not open port ${DEBUG_PORT} within 60 s:\n${stderr.trim()}`)
}

// ---- one run
const UA =
  'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

/** Whether the HTML the server answers right now carries the variant's marker. */
async function markerPresent(variant) {
  if (!variant.marker) return true
  try {
    const res = await fetch(variant.url, { headers: { 'user-agent': UA }, redirect: 'follow' })
    const text = await res.text()
    return res.ok && text.includes(String(variant.marker))
  } catch {
    return false
  }
}

/**
 * Why a run did not measure the page at `url`, or null when it did: the document must come
 * from the measured origin with a 2xx, and every first-party script, stylesheet and font must
 * have loaded. A login or gate page, or a page served without its CSS, passes every other
 * check and scores like a different, usually better, page.
 */
function invalidRunReason(report, url) {
  const origin = new URL(url).origin
  const documentUrl = report.mainDocumentUrl ?? report.finalDisplayedUrl
  if (!documentUrl) return 'no document URL in the report'
  if (new URL(documentUrl).origin !== origin) return `landed on ${new URL(documentUrl).origin}`
  const requests = report.audits['network-requests']?.details?.items ?? []
  const document = requests.find((r) => r.resourceType === 'Document' && r.url === documentUrl)
  if (!document || document.statusCode < 200 || document.statusCode >= 300)
    return `the document answered ${document?.statusCode ?? 'nothing'}`
  // A request that Chrome aborted and then fetched again loaded in the end; `finished: false`
  // is a request still in flight when the trace ended, not a failure.
  const loaded = new Set(
    requests.filter((r) => r.statusCode >= 200 && r.statusCode < 400).map((r) => r.url),
  )
  const failed = requests.filter(
    (r) =>
      r.url.startsWith(origin) &&
      ['Script', 'Stylesheet', 'Font'].includes(r.resourceType) &&
      r.finished !== false &&
      !loaded.has(r.url) &&
      (r.statusCode < 200 || r.statusCode >= 400),
  )
  if (failed.length)
    return `${failed.length} first-party asset(s) failed, first ${failed[0].statusCode} ${failed[0].resourceType} ${failed[0].url}`
  return null
}

/** The LCP element, from Lighthouse 13's insight audit or 12's legacy audit; null when absent. */
function lcpElement(audits) {
  const insight = audits['lcp-breakdown-insight']?.details?.items
  if (insight) return insight.find((i) => i.type === 'node') ?? null
  return audits['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node ?? null
}

/** The per-run facts worth keeping next to the score. */
function summarize(report, url) {
  const audits = report.audits
  const metrics = audits.metrics.details.items[0]
  const requests = audits['network-requests']?.details?.items ?? []
  const origin = new URL(url).origin
  const protocols = {}
  for (const r of requests.filter((r) => r.url.startsWith(origin)))
    protocols[r.protocol ?? '?'] = (protocols[r.protocol ?? '?'] ?? 0) + 1
  const lcpObserved = metrics.observedLargestContentfulPaint ?? Infinity
  const startOf = (r) => r.networkRequestTime ?? r.startTime ?? Infinity
  const preLcp = requests.filter((r) => startOf(r) <= lcpObserved)
  const kb = (list) => Math.round(list.reduce((sum, r) => sum + (r.transferSize ?? 0), 0) / 1024)
  const lcpNode = lcpElement(audits)
  return {
    performance: Math.round(report.categories.performance.score * 100),
    fcpMs: Math.round(metrics.firstContentfulPaint),
    lcpMs: Math.round(metrics.largestContentfulPaint),
    siMs: Math.round(metrics.speedIndex),
    tbtMs: Math.round(metrics.totalBlockingTime),
    cls: Number(metrics.cumulativeLayoutShift.toFixed(3)),
    ttfbMs: Math.round(audits['server-response-time']?.numericValue ?? 0),
    totalKb: kb(requests),
    preLcpKb: kb(preLcp),
    preLcpRequests: preLcp.length,
    lcpElement: lcpNode ? `${lcpNode.selector ?? '?'} — ${(lcpNode.nodeLabel ?? lcpNode.snippet ?? '').slice(0, 60)}` : '?',
    protocols,
    originLatencyMs: Object.fromEntries(
      (audits['network-server-latency']?.details?.items ?? []).map((i) => [
        new URL(i.origin).host,
        Math.round(i.serverResponseTime),
      ]),
    ),
  }
}

async function runLighthouse(variant, name) {
  const base = path.join(outDir, name)
  const cmd = [
    ...lighthouseBin,
    variant.url,
    '--output=json',
    ...(keepHtml ? ['--output=html'] : []),
    // One output format: Lighthouse writes exactly --output-path. Two: it appends .report.<ext>.
    `--output-path=${keepHtml ? base : `${base}.json`}`,
    `--config-path=${configPath}`,
    `--port=${DEBUG_PORT}`,
    '--quiet',
  ]
  const status = await new Promise((resolve) => {
    const child = spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'inherit', 'inherit'] })
    child.on('error', () => resolve(-1))
    child.on('exit', (code) => resolve(code))
  })
  const file = [`${base}.report.json`, `${base}.json`].find((f) => existsSync(f))
  if (status !== 0 || !file) return { error: `lighthouse exited ${status}` }
  const report = JSON.parse(readFileSync(file, 'utf8'))
  if (report.runtimeError || !report.audits?.metrics?.details)
    return { error: report.runtimeError?.code ?? 'no metrics' }
  const invalid = invalidRunReason(report, variant.url)
  if (invalid) return { error: invalid }
  return { report, file: path.basename(file) }
}

async function measure(variant, name, counted) {
  if (!(await markerPresent(variant))) {
    console.error(`  ${name}: discarded, served HTML lacks marker ${JSON.stringify(variant.marker)}`)
    return { error: 'marker missing' }
  }
  const run = await runLighthouse(variant, name)
  if (run.error) {
    console.error(`  ${name}: discarded, ${run.error}`)
    return run
  }
  const row = { name, file: run.file, ...summarize(run.report, variant.url) }
  console.log(
    `  ${name}: perf ${row.performance} | FCP ${row.fcpMs} LCP ${row.lcpMs} TBT ${row.tbtMs} CLS ${row.cls} | ${row.totalKb} kB (${row.preLcpKb} kB before LCP) | TTFB ${row.ttfbMs} | ${JSON.stringify(row.protocols)} | latency ${JSON.stringify(row.originLatencyMs)}${counted ? '' : ' — warm-up, not counted'}`,
  )
  return { row, report: run.report }
}

// ---- series
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const METRICS = ['performance', 'lcpMs', 'fcpMs', 'siMs', 'tbtMs', 'cls', 'ttfbMs', 'totalKb', 'preLcpKb']
function stats(rows) {
  const out = {}
  for (const key of METRICS) {
    const values = rows.map((r) => r[key])
    out[key] = { values, min: Math.min(...values), median: median(values), max: Math.max(...values) }
  }
  return out
}

const chrome = await launchChrome()
process.on('exit', () => chrome.kill())
let lighthouseVersion = '?'
const results = variants.map((v) => ({ ...v, rows: [], discarded: [] }))

console.log(`\n== warm-up (one per variant, discarded)`)
for (const v of results) await measure(v, `warm-up-${v.label}`, false)

for (let round = 1; round <= runs; round++) {
  const order = round % 2 ? results : [...results].reverse()
  console.log(`\n== round ${round} of ${runs}: ${order.map((v) => v.label).join(' then ')}`)
  for (const v of order) {
    const name = `${v.label}-${round}`
    const run = await measure(v, name, true)
    if (run.error) v.discarded.push({ name, reason: run.error })
    else {
      v.rows.push(run.row)
      lighthouseVersion = run.report.lighthouseVersion ?? lighthouseVersion
    }
  }
}
chrome.kill()

// ---- verdict
for (const v of results) if (v.rows.length) v.stats = stats(v.rows)
const [a, b] = results
const lines = []
if (b?.stats && a.stats) {
  const pa = a.stats.performance
  const pb = b.stats.performance
  const delta = pb.median - pa.median
  const spread = Math.max(pa.max - pa.min, pb.max - pb.min)
  const separated = pb.min > pa.max || pb.max < pa.min
  lines.push(
    separated
      ? `**Verdict:** every ${b.label} run ${delta > 0 ? 'above' : 'below'} every ${a.label} run (median ${delta > 0 ? '+' : ''}${delta}).`
      : Math.abs(delta) > spread
        ? `**Verdict:** medians differ by ${delta > 0 ? '+' : ''}${delta} with overlapping runs (spread ${spread}); likely real — add runs (≥12) before claiming it.`
        : `**Verdict:** not shown — median delta ${delta > 0 ? '+' : ''}${delta} is inside the spread (${spread}). Combine with other levers and measure the set, or drop it.`,
  )
  const elements = (v) => new Set(v.rows.map((r) => r.lcpElement.split(' — ')[0]))
  if ([...elements(a)].join() !== [...elements(b)].join())
    lines.push(
      `**LCP element differs between variants** (${[...elements(a)].join(', ')} vs ${[...elements(b)].join(', ')}): the change altered what is measured, not only how fast; the scores are not directly comparable.`,
    )
  if (Math.min(a.rows.length, b.rows.length) < 5)
    lines.push(`Fewer than 5 counted runs on a variant: run-to-run spread is ±3–5 points, so this is a sketch, not evidence.`)
}

// ---- outputs
const ms = (s) => `${(s.median / 1000).toFixed(2)} s`
const table = [
  '| variant | runs | performance (runs) | min / med / max | LCP med | FCP med | TBT med | CLS med | transfer med | before LCP med | LCP element |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map((v) =>
    v.stats
      ? `| ${v.label} | ${v.rows.length} | ${v.stats.performance.values.join(', ')} | ${v.stats.performance.min} / ${v.stats.performance.median} / ${v.stats.performance.max} | ${ms(v.stats.lcpMs)} | ${ms(v.stats.fcpMs)} | ${v.stats.tbtMs.median} ms | ${v.stats.cls.median} | ${v.stats.totalKb.median} kB | ${v.stats.preLcpKb.median} kB | ${v.rows[0].lcpElement} |`
      : `| ${v.label} | 0 | every run discarded | | | | | | | | |`,
  ),
]
const discarded = results.flatMap((v) => v.discarded.map((d) => `- ${d.name}: ${d.reason}`))
const settingsLine = [
  `Lighthouse ${lighthouseVersion}`,
  preset,
  `cpu ×${throttling.cpuSlowdownMultiplier} (simulated)`,
  'QUIC off',
  longWindow ? '6 s window after load' : 'default trace window',
  blocked.length ? `blocked: ${blocked.join(', ')}` : 'nothing blocked',
  `${runs} round(s), interleaved, warm-up discarded`,
].join(' · ')
const summary = [
  `## Lighthouse ${b ? `A/B — ${a.label} vs ${b.label}` : `baseline — ${a.label}`}`,
  '',
  ...results.map((v) => `- ${v.label}: ${v.url}${v.marker ? ` (marker \`${v.marker}\`)` : ''}`),
  '',
  settingsLine,
  '',
  ...table,
  '',
  ...lines,
  ...(discarded.length ? ['', 'Discarded runs:', ...discarded] : []),
  '',
  `Per-run protocol mix and per-origin server latency are in \`summary.json\`. Local numbers are local: do not put them in a column next to CI or PageSpeed Insights numbers.`,
].join('\n')
writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify({ settings, lighthouseVersion, results }, null, 2))
writeFileSync(path.join(outDir, 'summary.md'), `${summary}\n`)
console.log(`\n${summary}\n\nWritten to ${outDir}/summary.md and summary.json`)
process.exit(results.some((v) => !v.rows.length) ? 2 : 0)
