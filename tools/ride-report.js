#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function sourceOf(start) {
  if (!start) return 'legacy_or_missing_attribution';
  if (start.entrypoint === 'mcp' || start.entrypoint === 'a2a') return start.entrypoint;
  if (start.campaign_source) return `campaign:${start.campaign_source}`;
  if (start.referring_domain) return `referral:${start.referring_domain}`;
  return 'direct_or_unknown';
}

function increment(group, key) { group[key] = (group[key] || 0) + 1; }

function aggregate(completions, starts) {
  const startsByRun = new Map(starts.map(start => [start.run_id, start]));
  const uniqueCompletions = new Map(completions.map(event => [event.run_id, event]));
  const days = {};
  const day = date => days[date] ||= { starts: 0, completed: 0, operational_completed: 0, excluded_internal_or_test: 0, passed: 0, failed: 0, by_entrypoint: {}, by_source: {}, by_test_class: {} };
  for (const start of startsByRun.values()) day(start.started_at.slice(0, 10)).starts += 1;
  for (const event of uniqueCompletions.values()) {
    const group = day(event.completed_at.slice(0, 10));
    const start = startsByRun.get(event.run_id);
    group.completed += 1;
    if (start?.test_class === 'verified_test' || start?.test_class === 'self_marked_internal') group.excluded_internal_or_test += 1;
    else if (start) group.operational_completed += 1;
    if (event.result_status === 'passed') group.passed += 1;
    if (event.result_status === 'failed') group.failed += 1;
    increment(group.by_entrypoint, start?.entrypoint || 'legacy_or_missing_attribution');
    increment(group.by_source, sourceOf(start));
    increment(group.by_test_class, start?.test_class || 'legacy_or_missing_attribution');
  }
  return {
    timezone: 'UTC',
    interpretation: 'Counts are rides, not distinct people. Operational completions exclude marked internal and verified tests, and also exclude older or missing attribution. Unclassified is not proof of an outside user.',
    total_starts_with_attribution: startsByRun.size,
    total_completed: uniqueCompletions.size,
    total_operational_completed: Object.values(days).reduce((sum, group) => sum + group.operational_completed, 0),
    total_excluded_internal_or_test: Object.values(days).reduce((sum, group) => sum + group.excluded_internal_or_test, 0),
    completed_without_attribution: [...uniqueCompletions.keys()].filter(runId => !startsByRun.has(runId)).length,
    by_day: Object.fromEntries(Object.entries(days).sort(([a], [b]) => a.localeCompare(b)))
  };
}

if (require.main === module) {
  const completionPath = process.env.COMPLETION_LEDGER_PATH;
  if (!completionPath || !path.isAbsolute(completionPath)) {
    console.error('COMPLETION_LEDGER_PATH must name the existing absolute completion ledger.');
    process.exitCode = 1;
  } else {
    const attributionPath = path.join(path.dirname(completionPath), 'ride-attribution.jsonl');
    console.log(JSON.stringify(aggregate(readJsonl(completionPath), readJsonl(attributionPath)), null, 2));
  }
}

module.exports = { aggregate, sourceOf };
