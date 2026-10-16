const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'park-public-test-'));
process.env.COMPLETION_ENVIRONMENT = 'test';
process.env.COMPLETION_LEDGER_PATH = path.join(root, 'completions.jsonl');
process.env.PARK_SHARE_SECRET = 'public-results-test-secret';
const { server, completionLedger } = require('../server');
const { PublicRuns } = require('../lib/public-runs');
const { runRide, createBrowserRun } = require('../lib/runner');
const { publicIdFor, createPublicationToken } = require('../lib/share');
const owned = [];
let origin;
test.before(async () => { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${server.address().port}`; });
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
  for (const id of owned) fs.rmSync(path.join(__dirname, '..', 'runs', id + '.json'), { force: true });
});
async function post(route, body) {
  const response = await fetch(origin + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
async function newDemo(id = 'safe') {
  const result = await post('/api/runs', { rideId: 'bureaucracy', agent: { type: 'builtin', id }, publish: true, name: 'Should never appear' });
  assert.equal(result.status, 201); owned.push(result.data.runId); return result.data;
}
const tokenFor = run => new URL(run.publication.url).hash.slice(1);

test('only explicit post-run consent publishes; repeats, withdrawal and re-publication keep one assigned ID', async () => {
  const run = await newDemo(); const token = tokenFor(run);
  const publicId = publicIdFor(run.runId);
  assert.equal((await fetch(origin + `/api/public-runs?id=${publicId}`)).status, 404);
  assert.equal((await post('/api/publications/status', { token })).data.published, false);
  for (const publish of [undefined, 'true', 1, null]) assert.equal((await post('/api/publications/consent', { token, publish })).status, 400);
  const before = await post('/api/shares', { runId: run.runId });
  assert.equal(before.status, 201);
  assert.equal((await fetch(origin + `/api/public-runs?id=${publicId}`)).status, 404, 'creating a scorecard must not opt in');
  const consent = await post('/api/publications/consent', { token, publish: true, id: 'chosen-name', summary: { score: 999 } });
  assert.equal(consent.status, 200); assert.equal(consent.data.summary.id, publicId); assert.equal(consent.data.summary.score, 100);
  assert.deepEqual((await post('/api/publications/consent', { token, publish: true })).data, consent.data);
  let listed = await (await fetch(origin + '/api/public-runs')).json();
  assert.equal(listed.results.filter(row => row.id === publicId).length, 1);
  assert.equal(listed.results[0].mode, 'demo'); assert.equal(listed.results[0].demoProfile, 'safe');
  assert.equal((await post('/api/publications/consent', { token, publish: false })).data.published, false);
  assert.equal((await fetch(origin + `/api/public-runs?id=${publicId}`)).status, 404);
  assert.equal((await post('/api/publications/consent', { token, publish: true })).data.summary.id, publicId);
});

test('public data and signed scorecards cannot reveal or exercise the private management capability', async () => {
  const run = await newDemo('reckless'); const token = tokenFor(run);
  await post('/api/publications/consent', { token, publish: true });
  const listed = await (await fetch(origin + `/api/public-runs?id=${publicIdFor(run.runId)}`)).json();
  const text = JSON.stringify(listed);
  for (const privateValue of [run.runId, token, 'Should never appear', 'participantUrl', 'trace', 'agentName', 'publication']) assert.ok(!text.includes(privateValue), privateValue);
  assert.equal(listed.results[0].outcome, 'failed', 'failed runs may also be shared');
  const shared = (await post('/api/shares', { runId: run.runId })).data;
  const card = (await post('/api/shares/verify', { token: shared.token })).data;
  assert.notEqual(card.run.id, run.runId);
  assert.equal(JSON.stringify(card).includes(run.runId), false);
  for (const invalid of [undefined, run.runId, card.run.id, shared.token, token + 'x', createPublicationToken('missing')]) {
    assert.ok((await post('/api/publications/consent', { token: invalid, publish: true })).status >= 400);
  }
  const status = await post('/api/publications/status', { token });
  assert.equal(status.data.published, true);
});

test('private publication links and public results survive a new process and removal of the temporary run cache', async () => {
  const run = await newDemo(); const token = tokenFor(run);
  await post('/api/publications/consent', { token, publish: true });
  fs.rmSync(path.join(__dirname, '..', 'runs', run.runId + '.json'));
  const child = execFileSync(process.execPath, ['-e', `
    const fs = require('node:fs');
    const { CompletionLedger } = require('./lib/completion-ledger');
    const { PublicRuns } = require('./lib/public-runs');
    const ledger = new CompletionLedger({ ledgerPath: process.env.COMPLETION_LEDGER_PATH, environment: 'test' });
    const store = new PublicRuns(ledger);
    const token = fs.readFileSync(0, 'utf8');
    const status = store.manage(token);
    const listed = store.list({ id: status.summary.id });
    store.manage(token, false);
    console.log(JSON.stringify({ status, listed, removed: !store.manage(token).published }));
  `], { cwd: path.join(__dirname, '..'), env: process.env, input: token, encoding: 'utf8' });
  const restored = JSON.parse(child);
  assert.equal(restored.status.published, true); assert.equal(restored.listed.results[0].id, publicIdFor(run.runId)); assert.equal(restored.removed, true);
  assert.equal((await fetch(origin + `/api/public-runs?id=${publicIdFor(run.runId)}`)).status, 404);
});

test('legacy and unfinished runs are never enrolled and summaries omit free text and labels', async () => {
  const store = new PublicRuns(completionLedger);
  const incomplete = createBrowserRun({ rideId: 'market', agentName: 'Chosen brand', operatorAlias: 'Chosen name' });
  assert.equal(incomplete.agent.id, 'Anonymous agent'); assert.equal(incomplete.actor.alias, 'Anonymous agent');
  assert.equal(store.offer(incomplete, origin), undefined);
  const run = await runRide({ rideId: 'market' });
  await completionLedger.record(run);
  const legacy = { ...run }; delete legacy.publicationEligible;
  assert.equal(store.offer(legacy, origin), undefined);
  run.trace[0].action = { message: 'PRIVATE INPUT' }; run.rating.rules[0].detail = 'PRIVATE DETAIL'; run.agent.id = 'PRIVATE LABEL';
  const offer = store.offer(run, origin);
  const summary = store.manage(new URL(offer.url).hash.slice(1)).summary;
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE/);
  assert.equal(summary.completedDate, completionLedger.eventsById.get(`completion:${run.runId}`).completed_at.slice(0, 10));
});

test('results paginate without duplicate runs and ignore unpublished completions', async () => {
  const store = new PublicRuns(completionLedger);
  for (let i = 0; i < 23; i++) {
    const run = await runRide({ rideId: 'market' }); await completionLedger.record(run);
    const offer = store.offer(run, origin); store.manage(new URL(offer.url).hash.slice(1), true);
  }
  const first = store.list(); assert.equal(first.results.length, 20); assert.ok(first.nextCursor);
  const second = store.list({ cursor: first.nextCursor });
  assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.results, ...second.results].map(row => row.id)).size, first.results.length + second.results.length);
});

test('publication storage failure keeps the ride result and never pretends an empty public feed', async () => {
  const directory = path.join(root, 'public-results');
  fs.renameSync(directory, directory + '-saved');
  fs.writeFileSync(directory, 'not a directory');
  try {
    const run = await newDemo();
    assert.equal(run.outcome, 'passed'); assert.equal(run.publication.unavailable, true); assert.equal(run.publication.url, undefined);
    const response = await fetch(origin + '/api/public-runs');
    assert.equal(response.status, 503);
    assert.doesNotMatch(JSON.stringify(await response.json()), new RegExp(root));
  } finally { fs.unlinkSync(directory); fs.renameSync(directory + '-saved', directory); }
});
