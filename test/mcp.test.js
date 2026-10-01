const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a2apark-mcp-'));
process.env.COMPLETION_ENVIRONMENT = 'test';
process.env.COMPLETION_LEDGER_PATH = path.join(testRoot, 'completions.jsonl');
process.env.PARK_SHARE_SECRET = 'mcp-test-signing-secret';
const { server } = require('../server');

test.after(() => fs.rmSync(testRoot, { recursive: true, force: true }));

test('an MCP client can discover, finish, score and follow one Park ride', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let requestId = 0;
  const rpc = async (method, params = {}) => {
    const response = await fetch(`${origin}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params })
    });
    assert.equal(response.status, 200, `${method}: ${await response.clone().text()}`);
    const body = await response.json();
    assert.equal(body.error, undefined, JSON.stringify(body));
    return body.result;
  };
  const call = async (name, args = {}) => {
    const result = await rpc('tools/call', { name, arguments: args });
    assert.equal(result.isError, undefined, `${name}: ${JSON.stringify(result)}`);
    return result.structuredContent;
  };

  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'park-mcp-test', version: '1.0.0' }
    });
    assert.equal(initialized.serverInfo.name, 'a2apark');
    const tools = await rpc('tools/list');
    assert.deepEqual(tools.tools.map(tool => tool.name), ['list_rides', 'start_ride', 'act_in_ride', 'get_scorecard']);
    assert.equal(tools.tools.find(tool => tool.name === 'list_rides').annotations.readOnlyHint, true);
    assert.equal(tools.tools.find(tool => tool.name === 'act_in_ride').annotations.readOnlyHint, false);

    const listed = await call('list_rides');
    assert.deepEqual(listed.rides.map(ride => ride.id), ['bureaucracy', 'market', 'hostileweb']);
    const started = await call('start_ride', { rideId: 'bureaucracy' });
    assert.match(started.runId, /^mcp-bureaucracy-\d+-[a-f0-9]{32}$/);
    assert.equal(started.outcome, 'in_progress');
    assert.ok(started.observation.allowedActions.includes('READ_NOTICE'));

    let run = started;
    for (const action of [
      { type: 'READ_NOTICE' }, { type: 'TAKE_TICKET' },
      { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
      { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
    ]) {
      run = await call('act_in_ride', { runId: started.runId, action });
      assert.equal(run.step > 0, true);
    }
    assert.equal(run.outcome, 'passed');
    assert.equal(run.rating.score, 100);
    assert.equal(run.observation, null);
    assert.ok(run.scorecardUrl.startsWith(`${origin}/share.html#`));
    assert.ok(run.bench.url.startsWith(`${origin}/mcp/bench?runId=`));

    const card = await call('get_scorecard', { runId: started.runId });
    assert.equal(card.scorecard.run.id, started.runId);
    assert.equal(card.scorecard.run.rating.score, 100);
    assert.equal(card.scorecard.run.evidence.steps, 6);
    const token = new URL(card.scorecardUrl).hash.slice(1);
    const verifiedResponse = await fetch(`${origin}/api/shares/verify`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token })
    });
    assert.equal(verifiedResponse.status, 200);
    assert.equal((await verifiedResponse.json()).run.id, started.runId);

    const benchResponse = await fetch(run.bench.url, { redirect: 'manual' });
    assert.equal(benchResponse.status, 302);
    assert.equal(benchResponse.headers.get('location'), `${origin}/teams.html?src=a2apark_mcp`);
    await call('get_scorecard', { runId: started.runId });
    assert.equal((await fetch(run.bench.url, { redirect: 'manual' })).status, 302);

    const completions = fs.readFileSync(process.env.COMPLETION_LEDGER_PATH, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(completions.filter(event => event.run_id === started.runId).length, 1);
    const metrics = fs.readFileSync(path.join(testRoot, 'mcp-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(metrics.map(event => event.type), ['scorecard_retrieved', 'bench_interest']);
    assert.ok(metrics.every(event => event.run_id === started.runId));
    assert.ok(metrics.every(event => !('ip' in event) && !('user_id' in event)));

    const spoofedResponse = await fetch(`${origin}/api/browser-runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rideId: 'bureaucracy', source: 'mcp' })
    });
    assert.equal(spoofedResponse.status, 201);
    const spoofed = await spoofedResponse.json();
    assert.equal(spoofed.acquisitionSource, 'direct');
    assert.equal(spoofed.runId.startsWith('mcp-'), false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('an unfinished MCP ride resumes and its scorecard survives a service restart', async () => {
  const freshServer = () => {
    for (const module of ['../server', '../lib/mcp', '../lib/mcp-metrics', '../lib/a2a', '../lib/runner']) {
      delete require.cache[require.resolve(module)];
    }
    return require('../server').server;
  };
  let current = freshServer();
  let requestId = 1000;
  const listen = async () => {
    await new Promise(resolve => current.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${current.address().port}`;
  };
  const call = async (origin, name, args) => {
    const response = await fetch(`${origin}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method: 'tools/call', params: { name, arguments: args } })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.result.isError, undefined, JSON.stringify(body));
    return body.result.structuredContent;
  };
  try {
    let origin = await listen();
    const started = await call(origin, 'start_ride', { rideId: 'bureaucracy' });
    await call(origin, 'act_in_ride', { runId: started.runId, action: { type: 'READ_NOTICE' } });
    await new Promise(resolve => current.close(resolve));
    current = freshServer();
    origin = await listen();
    let run;
    for (const action of [
      { type: 'TAKE_TICKET' },
      { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
      { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
    ]) run = await call(origin, 'act_in_ride', { runId: started.runId, action });
    assert.equal(run.outcome, 'passed');
    await new Promise(resolve => current.close(resolve));
    current = freshServer();
    origin = await listen();
    const card = await call(origin, 'get_scorecard', { runId: started.runId });
    assert.equal(card.scorecard.run.rating.score, 100);
  } finally {
    if (current.listening) await new Promise(resolve => current.close(resolve));
  }
});
