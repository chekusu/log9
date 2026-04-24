import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const rootDir = process.cwd()
const targets = [
  { name: '@log9/api', summary: 'apps/api/coverage/coverage-summary.json' },
  { name: '@log9/core', summary: 'packages/core/coverage/coverage-summary.json' },
  { name: '@log9/cloudflare', summary: 'packages/sdk-cloudflare/coverage/coverage-summary.json' },
]

function readSummary(relativePath) {
  const absolutePath = path.join(rootDir, relativePath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`缺少覆盖率文件: ${relativePath}`)
  }

  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'))
}

function createMetricSummary(summary) {
  return {
    lines: { covered: summary.lines.covered, total: summary.lines.total, pct: summary.lines.pct },
    statements: { covered: summary.statements.covered, total: summary.statements.total, pct: summary.statements.pct },
    functions: { covered: summary.functions.covered, total: summary.functions.total, pct: summary.functions.pct },
    branches: { covered: summary.branches.covered, total: summary.branches.total, pct: summary.branches.pct },
  }
}

function assertPerfectCoverage(name, metrics) {
  for (const [metric, value] of Object.entries(metrics)) {
    if (value.pct !== 100) {
      throw new Error(`${name} 的 ${metric} 覆盖率为 ${value.pct}%，未达到 100%`)
    }
  }
}

function createEmptyTotals() {
  return {
    lines: { covered: 0, total: 0 },
    statements: { covered: 0, total: 0 },
    functions: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  }
}

function addTotals(accumulator, metrics) {
  for (const key of Object.keys(accumulator)) {
    accumulator[key].covered += metrics[key].covered
    accumulator[key].total += metrics[key].total
  }
}

function finalizeTotals(totals) {
  const result = {}
  for (const [key, value] of Object.entries(totals)) {
    result[key] = {
      covered: value.covered,
      total: value.total,
      pct: value.total === 0 ? 100 : Number(((value.covered / value.total) * 100).toFixed(2)),
    }
  }
  return result
}

const mergedTotals = createEmptyTotals()
const report = []

for (const target of targets) {
  const summary = readSummary(target.summary)
  const total = summary.total
  const metrics = createMetricSummary(total)
  assertPerfectCoverage(target.name, metrics)
  report.push({
    package: target.name,
    summaryPath: target.summary,
    lines: metrics.lines.pct,
    statements: metrics.statements.pct,
    functions: metrics.functions.pct,
    branches: metrics.branches.pct,
  })
  addTotals(mergedTotals, metrics)
}

const combinedMetrics = finalizeTotals(mergedTotals)
assertPerfectCoverage('仓库聚合', combinedMetrics)

const outputDir = path.join(rootDir, 'coverage')
fs.mkdirSync(outputDir, { recursive: true })

const output = {
  generatedAt: new Date().toISOString(),
  packages: report,
  combined: {
    summaryPath: 'coverage/coverage-summary.json',
    lines: combinedMetrics.lines.pct,
    statements: combinedMetrics.statements.pct,
    functions: combinedMetrics.functions.pct,
    branches: combinedMetrics.branches.pct,
    totals: combinedMetrics,
  },
}

fs.writeFileSync(path.join(outputDir, 'coverage-summary.json'), `${JSON.stringify(output, null, 2)}\n`)

console.log(JSON.stringify(output, null, 2))
