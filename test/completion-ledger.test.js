const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2apark-ledger-'));
process.env.COMPLETION_LEDGER_PATH = path.join(root, 'server-test', 'completions.jsonl');
process.env.COMPLETION_ENVIRONMENT = 'test';
const { CompletionLedger, completionEvent } = require('../lib/completion-ledger');
const { persistRun } = require('../server');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function run(id = 'bureaucracy-ledger-test') {
  return { runId: id, ride: { id: 'bureaucracy', version: '1' }, outcome: 'passed', agent: { type: 'builtin', id: 'safe' } };
}

function records(file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('ledger writes the minimum schema, serializes, deduplicates, and survives reconstruction', async () => {
  const file = path.join(root, 'restart', 'completions.jsonl');
  const now = () => new Date('2026-09-05T20:00:00.000Z');
  const first = new CompletionLedger({ ledgerPath: file, environment: 'test', now });
  const failed = { ...run('failed-run'), outcome: 'failed' };
  const [one, duplicate, two, failedResult] = await Promise.all([first.record(run('run-1')), first.record(run('run-1')), first.record(run('run-2')), first.record(failed)]);
  assert.equal(one.deduplicated, false); assert.equal(duplicate.deduplicated, true); assert.equal(two.deduplicated, false); assert.equal(failedResult.event.result_status, 'failed');
  assert.equal(records(file).length, 3);
  assert.deepEqual(Object.keys(records(file)[0]).sort(), ['completed_at', 'completion_status', 'environment', 'event_id', 'result_status', 'ride_id', 'ride_version', 'run_id']);

  const restarted = new CompletionLedger({ ledgerPath: file, environment: 'test', now });
  const afterRestart = await restarted.record(run('run-1'));
  assert.equal(afterRestart.deduplicated, true);
  assert.equal(records(file).length, 3);
});

test('recovery replays a pending completion over an incomplete trailing append', async () => {
  const file = path.join(root, 'recovery', 'completions.jsonl');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const completed = completionEvent(run('recovered-run'), 'test', () => new Date('2026-09-05T20:01:00.000Z'));
  fs.writeFileSync(file, '{"event_id":"partial');
  fs.writeFileSync(`${file}.pending`, `${JSON.stringify(completed)}\n`);
  const ledger = new CompletionLedger({ ledgerPath: file, environment: 'test' });
  const result = await ledger.record(run('recovered-run'));
  assert.equal(result.deduplicated, true);
  assert.deepEqual(records(file), [completed]);
  assert.equal(fs.existsSync(`${file}.pending`), false);
});

test('unrecoverable trailing data and unavailable storage fail explicitly and remain unhealthy', async () => {
  const corrupt = path.join(root, 'corrupt', 'completions.jsonl');
  fs.mkdirSync(path.dirname(corrupt), { recursive: true });
  fs.writeFileSync(corrupt, '{"event_id":"partial');
  const corruptLedger = new CompletionLedger({ ledgerPath: corrupt, environment: 'test' });
  await assert.rejects(corruptLedger.record(run('corrupt-run')), error => error.code === 'COMPLETION_LEDGER_UNAVAILABLE');
  assert.throws(() => corruptLedger.assertReady(), error => error.code === 'COMPLETION_LEDGER_UNAVAILABLE');

  const directoryAsFile = path.join(root, 'unavailable');
  fs.mkdirSync(directoryAsFile);
  const unavailable = new CompletionLedger({ ledgerPath: directoryAsFile, environment: 'test' });
  await assert.rejects(unavailable.record(run('unavailable-run')), error => error.code === 'COMPLETION_LEDGER_UNAVAILABLE');
});

test('development and test ledgers remain separate from production configuration', async () => {
  const developmentFile = path.join(root, 'development', 'completions.jsonl');
  const testFile = path.join(root, 'test', 'completions.jsonl');
  await new CompletionLedger({ ledgerPath: developmentFile, environment: 'development' }).record(run('development-run'));
  await new CompletionLedger({ ledgerPath: testFile, environment: 'test' }).record(run('test-run'));
  assert.equal(records(developmentFile)[0].environment, 'development');
  assert.equal(records(testFile)[0].environment, 'test');
  assert.throws(() => new CompletionLedger({ ledgerPath: '/var/data/a2apark/production/completions.jsonl', environment: 'test' }).assertReady(), /not acknowledged/);
  assert.throws(() => new CompletionLedger({ ledgerPath: path.join(root, 'wrong-production.jsonl'), environment: 'production' }).assertReady(), /not acknowledged/);
});

test('run-cache pruning does not modify or prune the completion ledger', async () => {
  const ledgerFile = path.join(root, 'independence', 'completions.jsonl');
  await new CompletionLedger({ ledgerPath: ledgerFile, environment: 'test' }).record(run('durable-run'));
  const before = fs.readFileSync(ledgerFile, 'utf8');
  const cache = path.join(root, 'cache'); fs.mkdirSync(cache);
  for (let index = 0; index < 500; index += 1) fs.writeFileSync(path.join(cache, `cache-${index}.json`), '{}');
  persistRun({ runId: 'cache-new' }, cache);
  assert.equal(fs.readdirSync(cache).filter(name => name.endsWith('.json')).length, 500);
  assert.equal(fs.readFileSync(ledgerFile, 'utf8'), before);
});
