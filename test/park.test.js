const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const testLedgerRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'a2apark-server-ledger-'));
process.env.COMPLETION_LEDGER_PATH = path.join(testLedgerRoot, 'test', 'completions.jsonl');
process.env.COMPLETION_ENVIRONMENT = 'test';
const { runRide, createBrowserRun, actInBrowserRun, externalAdaptersEnabled, validateAgent } = require('../lib/runner');
const { rides } = require('../lib/rides');
const { createShareToken, verifyShareToken, scorecardFor } = require('../lib/share');
const { agentCard, commercialPath, handleA2A } = require('../lib/a2a');
const { CompletionLedgerError } = require('../lib/completion-ledger');
const { server, safeHttpsOrigin, requestOrigin, canonicalRedirect, structuredData, completionLedger } = require('../server');
const benchAvailabilityCopy = 'The A2AParkBench public website is available, with links to the free regression runner and public failure corpus. Private team workflows and paid access remain gated; live checkout is not enabled.';
test.after(() => fs.rmSync(testLedgerRoot, { recursive: true, force: true }));

function ledgerRecords() {
  const content = fs.readFileSync(process.env.COMPLETION_LEDGER_PATH, 'utf8');
  return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('park exposes three materially different rides', () => {
  assert.deepEqual(rides.map(r => r.id), ['bureaucracy', 'market', 'hostileweb']);
  assert.deepEqual(rides.map(r => r.version), ['1', '1', '1']);
  assert.equal(new Set(rides.map(r => r.kind)).size, 3);
});

for (const ride of rides) {
  test(`safe agent passes ${ride.id} with a preserved evidence trace`, async () => {
    const run = await runRide({ rideId: ride.id, agent: { type: 'builtin', id: 'safe' } });
    assert.equal(run.outcome, 'passed');
    assert.ok(run.rating.score >= 90, JSON.stringify(run.rating));
    assert.ok(run.trace.length > 1);
    for (const entry of run.trace) {
      assert.ok(entry.observation); assert.ok(entry.action); assert.ok(entry.events); assert.ok(entry.stateAfter);
    }
  });
}

test('hazardous behavior is visible and cannot pass on final appearance alone', async () => {
  const run = await runRide({ rideId: 'market', agent: { type: 'builtin', id: 'reckless' } });
  assert.equal(run.outcome, 'failed');
  assert.ok(run.trace.some(step => step.events.some(event => event.type === 'hazard')));
  assert.ok(run.rating.score < 60);
});

test('a goal-only market run succeeds but scores below a verified negotiation', async () => {
  const safe = await runRide({ rideId: 'market', agent: { type: 'builtin', id: 'safe' } });
  const goalOnly = await runRide({ rideId: 'market', agent: { type: 'builtin', id: 'goal-only' } });
  assert.equal(goalOnly.outcome, 'passed');
  assert.ok(goalOnly.rating.score < safe.rating.score);
});

test('browser participant mode preserves the same structured trace and scoring', () => {
  let run = createBrowserRun({ rideId: 'bureaucracy', agentName: 'Hard Sell', source: 'test_source' });
  const actions = [
    { type: 'READ_NOTICE' }, { type: 'TAKE_TICKET' },
    { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
    { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
  ];
  for (const action of actions) run = actInBrowserRun(run.runId, action);
  assert.equal(run.agent.id, 'Hard Sell'); assert.equal(run.outcome, 'passed'); assert.equal(run.rating.score, 100);
  assert.equal(run.acquisitionSource, 'test_source');
  assert.equal(run.trace.length, actions.length); assert.deepEqual(run.trace[2].action, actions[2]);
  assert.ok(run.trace.every(step => step.observation && step.stateAfter && step.events));
});

test('A2A card advertises a callable standards endpoint and park skills', () => {
  const card = agentCard('https://a2apark.com');
  assert.equal(card.protocolVersion, '0.3.0');
  assert.equal(card.name, 'A2APark');
  assert.equal(card.provider.organization, 'A2APark');
  assert.match(card.description, /Created and operated by Sarah van Oorsouw/);
  assert.equal(card.url, 'https://a2apark.com/a2a');
  assert.equal(card.preferredTransport, 'JSONRPC');
  assert.deepEqual(card.supportedInterfaces, [{ url: 'https://a2apark.com/a2a', protocolBinding: 'JSONRPC', protocolVersion: '0.3' }]);
  assert.equal(card.documentationUrl, 'https://a2apark.com/#how-it-works');
  assert.deepEqual(card.skills.map(skill => skill.id), ['list-rides', 'start-ride', 'act-in-ride']);
});

test('invalid and production-disabled agents are rejected before evaluation', async () => {
  assert.equal(externalAdaptersEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(externalAdaptersEnabled({ NODE_ENV: 'production', ALLOW_LOCAL_ADAPTERS: 'true' }), true);
  assert.throws(() => validateAgent({ type: 'external', url: 'http://127.0.0.1:8787/act' }, { NODE_ENV: 'production' }), /disabled/);
  await assert.rejects(runRide({ rideId: 'bureaucracy', agent: { type: 'builtin', id: 'does-not-exist' } }), /Unknown built-in agent/);
  await assert.rejects(runRide({ rideId: 'bureaucracy', agent: { type: 'mystery' } }), /Unknown agent type/);
});

test('A2A registry capability probe receives a valid completed response', () => {
  const response = handleA2A({
    jsonrpc: '2.0', id: 'registry-probe', method: 'message/send',
    params: { message: { messageId: 'registry-probe-message', role: 'user', parts: [{ text: 'Hello, what can you do?' }] } }
  }).response;
  assert.equal(response.result.status.state, 'completed');
  assert.match(response.result.artifacts[0].parts[0].data.message, /behavioral evaluation rides/i);
});

test('A2A responses expose a non-payable commercial path only when contact is configured', () => {
  const request = {
    jsonrpc: '2.0', id: 'commercial-probe', method: 'message/send',
    params: { message: { messageId: 'commercial-probe-message', role: 'user', parts: [{ text: 'Hello, what can you do?' }] } }
  };
  const withoutContact = handleA2A(request).response.result.artifacts[0].parts[0].data;
  assert.equal(withoutContact.commercial, undefined);
  const withContact = handleA2A(request, {
    origin: 'https://a2apark.com', salesEmail: 'a2apark@example.test'
  }).response.result.artifacts[0].parts[0].data;
  assert.deepEqual(withContact.commercial, commercialPath({
    origin: 'https://a2apark.com', salesEmail: 'a2apark@example.test'
  }));
  assert.equal(withContact.commercial.paymentAvailable, false);
  assert.equal(withContact.commercial.product, 'A2AParkBench');
  assert.equal(withContact.commercial.planUrl, 'https://a2apark.com/teams.html');
  assert.equal(withContact.commercial.note, benchAvailabilityCopy);
  const withBenchWebsite = handleA2A(request, {
    origin: 'https://a2apark.com', salesEmail: 'a2apark@example.test', benchOrigin: 'https://bench.a2apark.com'
  }).response.result.artifacts[0].parts[0].data.commercial;
  assert.equal(withBenchWebsite.status, 'interest_only');
  assert.equal(withBenchWebsite.planUrl, 'https://bench.a2apark.com/');
  assert.equal(withBenchWebsite.paymentAvailable, false);
  assert.match(withBenchWebsite.description, /Private hosted workflows, customer entitlement, and paid CI remain gated/);
});

test('canonical origin and legacy-host redirects preserve paths and queries', () => {
  const env = { CANONICAL_ORIGIN: 'https://a2apark.com' };
  assert.equal(safeHttpsOrigin('https://a2apark.com'), 'https://a2apark.com');
  assert.equal(safeHttpsOrigin('http://a2apark.com'), '');
  assert.equal(requestOrigin({ headers: { host: 'agent-amusement-park.onrender.com', 'x-forwarded-proto': 'https' } }, env), 'https://a2apark.com');
  const location = canonicalRedirect(
    { headers: { host: 'agent-amusement-park.onrender.com' } },
    new URL('/share.html?src=legacy', 'http://localhost'), env
  );
  assert.equal(location, 'https://a2apark.com/share.html?src=legacy');
  assert.equal(canonicalRedirect({ headers: { host: 'a2apark.com' } }, new URL('/a2a', 'http://localhost'), env), '');
});

test('forward-facing pages use A2APark identity and canonical metadata', () => {
  const pages = ['index.html', 'play.html', 'share.html', 'legal.html', 'teams.html'];
  for (const page of pages) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
    assert.match(html, /A2APark/);
    assert.match(html, /rel="canonical" href="https:\/\/a2apark\.com\//);
    assert.doesNotMatch(html, /Agent Amusement Park|Private Park/);
  }
  const teams = fs.readFileSync(path.join(__dirname, '..', 'public', 'teams.html'), 'utf8');
  assert.match(teams, /Public resources available/);
  assert.doesNotMatch(teams, /€199|useful-signal guarantee/i);
  for (const page of ['index.html', 'play.html', 'share.html', 'legal.html', 'teams.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', page), 'utf8');
    assert.match(html, new RegExp(benchAvailabilityCopy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), page);
    assert.match(html, /href="https:\/\/bench\.a2apark\.com\/"[^>]*>Explore A2AParkBench/, page);
    assert.doesNotMatch(html, /A2AParkBench is not yet open|separate Bench service is not yet open/, page);
  }
  const home = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.match(home, /Created and operated by Sarah van Oorsouw/);
  assert.match(home, /id="how-it-works"/);
  assert.match(home, /href="\/favicon\.ico"/);
  assert.match(home, /id="external-option" hidden/);
  const browserNameInput = home.match(/<input id="browser-agent-name"[^>]*>/)[0];
  assert.match(browserNameInput, /placeholder="Codex browser agent"/);
  assert.doesNotMatch(browserNameInput, /value="Hard Sell"/);
  assert.ok(fs.statSync(path.join(__dirname, '..', 'public', 'favicon.svg')).size > 0);
  assert.match(home, new RegExp(`<script type="application/ld\\+json">${structuredData.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}</script>`));
  const robots = fs.readFileSync(path.join(__dirname, '..', 'public', 'robots.txt'), 'utf8');
  assert.match(robots, /Sitemap: https:\/\/a2apark\.com\/sitemap\.xml/);
  const sitemap = fs.readFileSync(path.join(__dirname, '..', 'public', 'sitemap.xml'), 'utf8');
  assert.match(sitemap, /https:\/\/a2apark\.com\/teams\.html/);
  assert.doesNotMatch(sitemap, /<loc>https:\/\/a2apark\.com\/(?:a2a|\.well-known)/);
});

test('legacy Render ingress redirects every public interface in one hop without losing attribution', async () => {
  const previousCanonical = process.env.CANONICAL_ORIGIN;
  const previousBench = process.env.BENCH_ORIGIN;
  const previousCheckout = process.env.CHECKOUT_URL;
  process.env.CANONICAL_ORIGIN = 'https://a2apark.com';
  process.env.BENCH_ORIGIN = 'https://bench.a2apark.com';
  delete process.env.CHECKOUT_URL;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const request = ({ path: requestPath, method = 'GET', host = 'agent-amusement-park.onrender.com', body = '' }) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: requestPath, method, headers: { host, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, res => {
      let data = ''; res.on('data', chunk => { data += chunk; }); res.on('end', () => resolve({ status: res.statusCode, location: res.headers.location, body: data }));
    });
    req.on('error', reject); if (body) req.write(body); req.end();
  });
  try {
    const cases = [
      ['/?src=reddit_ai_agents', 'https://a2apark.com/?src=reddit_ai_agents'],
      ['/play.html?runId=example', 'https://a2apark.com/play.html?runId=example'],
      ['/share.html?src=scorecard', 'https://a2apark.com/share.html?src=scorecard'],
      ['/teams.html?src=legacy', 'https://a2apark.com/teams.html?src=legacy'],
      ['/.well-known/agent-card.json', 'https://a2apark.com/.well-known/agent-card.json'],
      ['/.well-known/agent.json', 'https://a2apark.com/.well-known/agent.json']
    ];
    for (const [requestPath, expected] of cases) {
      const response = await request({ path: requestPath });
      assert.equal(response.status, 308, requestPath);
      assert.equal(response.location, expected, requestPath);
    }
    const rpcBody = JSON.stringify({ jsonrpc: '2.0', id: 'redirect', method: 'message/send', params: { message: { messageId: 'redirect', role: 'user', parts: [{ kind: 'text', text: '{"skill":"list_rides"}' }] } } });
    const redirectedRpc = await request({ path: '/a2a?src=legacy_agent', method: 'POST', body: rpcBody });
    assert.equal(redirectedRpc.status, 308);
    assert.equal(redirectedRpc.location, 'https://a2apark.com/a2a?src=legacy_agent');
    const canonicalCard = await request({ path: '/.well-known/agent-card.json', host: 'a2apark.com' });
    assert.equal(canonicalCard.status, 200);
    assert.equal(JSON.parse(canonicalCard.body).url, 'https://a2apark.com/a2a');
    const canonicalRpc = await request({ path: '/a2a', method: 'POST', host: 'a2apark.com', body: rpcBody });
    assert.equal(canonicalRpc.status, 200);
    assert.equal(JSON.parse(canonicalRpc.body).result.status.state, 'completed');
    const canonicalTeams = await request({ path: '/teams.html?src=local_boundary', host: 'a2apark.com' });
    assert.equal(canonicalTeams.status, 200);
    assert.match(canonicalTeams.body, /Public resources available/);
    const benchConvenience = await request({ path: '/bench?src=park', host: 'a2apark.com' });
    assert.equal(benchConvenience.status, 308);
    assert.equal(benchConvenience.location, 'https://bench.a2apark.com/?src=park');
    const configResponse = await request({ path: '/api/config', host: 'a2apark.com' });
    const config = JSON.parse(configResponse.body);
    assert.equal(config.benchOrigin, 'https://bench.a2apark.com');
    assert.equal(config.benchPublicWebsiteAvailable, true);
    assert.equal(config.benchAvailable, true);
    assert.equal(config.benchPrivateWorkflowsAvailable, false);
    assert.equal(config.benchPaidAccessAvailable, false);
    assert.equal(config.checkoutUrl, '');
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousCanonical === undefined) delete process.env.CANONICAL_ORIGIN; else process.env.CANONICAL_ORIGIN = previousCanonical;
    if (previousBench === undefined) delete process.env.BENCH_ORIGIN; else process.env.BENCH_ORIGIN = previousBench;
    if (previousCheckout === undefined) delete process.env.CHECKOUT_URL; else process.env.CHECKOUT_URL = previousCheckout;
  }
});

test('A2A callers can discover, start, and complete a stateful ride', () => {
  const send = command => handleA2A({
    jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send',
    params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text: JSON.stringify(command) }] } }
  });
  const listed = send({ skill: 'list_rides' });
  assert.equal(listed.response.result.status.state, 'completed');
  assert.equal(listed.response.result.artifacts[0].parts[0].data.rides.length, 3);
  const started = send({ skill: 'start_ride', rideId: 'bureaucracy', agentName: 'Registry test' });
  let run = started.response.result.artifacts[0].parts[0].data.run;
  assert.equal(run.acquisitionSource, 'a2a_registry');
  const actions = [
    { type: 'READ_NOTICE' }, { type: 'TAKE_TICKET' },
    { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
    { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
  ];
  for (const action of actions) {
    const acted = send({ skill: 'act', runId: run.runId, action });
    run = acted.response.result.artifacts[0].parts[0].data.run;
  }
  assert.equal(run.outcome, 'passed');
  assert.equal(run.rating.score, 100);
});

test('A2A discovery and message sending work over HTTP', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    const cardResponse = await fetch(`${origin}/.well-known/agent-card.json`);
    const card = await cardResponse.json();
    assert.equal(cardResponse.status, 200);
    assert.equal(card.name, 'A2APark');
    assert.equal(card.url, `${origin}/a2a`);
    assert.deepEqual(card.supportedInterfaces, [{ url: `${origin}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '0.3' }]);
    const rpcResponse = await fetch(`${origin}/a2a`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'http-test', method: 'message/send', params: { message: { messageId: 'http-test-message', role: 'user', parts: [{ kind: 'text', text: '{"skill":"list_rides"}' }] } } })
    });
    const rpc = await rpcResponse.json();
    assert.equal(rpcResponse.status, 200);
    assert.equal(rpc.result.artifacts[0].parts[0].data.rides.length, 3);
    const runResponse = await fetch(`${origin}/api/runs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rideId: 'bureaucracy', agent: { type: 'builtin', id: 'safe' }, testMarker: 'controlled-check' }) });
    const run = await runResponse.json();
    assert.equal(runResponse.status, 201, `run creation failed: ${JSON.stringify(run)}`);
    assert.ok(run.runId, `run creation returned no runId: ${JSON.stringify(run)}`);
    const completion = ledgerRecords().find(event => event.run_id === run.runId);
    assert.equal(completion.event_id, `completion:${run.runId}`);
    assert.equal(completion.ride_id, 'bureaucracy');
    assert.equal(completion.ride_version, '1');
    assert.equal(completion.completion_status, 'completed');
    assert.equal(completion.result_status, 'passed');
    assert.equal(completion.environment, 'test');
    assert.match(completion.completed_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const shareResponse = await fetch(`${origin}/api/shares`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ runId: run.runId }) });
    const share = await shareResponse.json();
    assert.equal(shareResponse.status, 201, `scorecard creation failed: ${JSON.stringify(share)}`);
    assert.equal(share.url, `${origin}${share.path}`);
    const benchResponse = await fetch(`${origin}/bench`);
    assert.equal(benchResponse.status, 200);
    assert.match(await benchResponse.text(), /Public resources available/);
    const configResponse = await fetch(`${origin}/api/config`);
    const config = await configResponse.json();
    assert.equal(config.benchOrigin, '');
    assert.equal(config.benchPublicWebsiteAvailable, false);
    assert.equal(config.benchAvailable, false);
    assert.equal(config.benchPrivateWorkflowsAvailable, false);
    assert.equal(config.benchPaidAccessAvailable, false);
    const robotsResponse = await fetch(`${origin}/robots.txt`);
    assert.equal(robotsResponse.status, 200);
    assert.match(robotsResponse.headers.get('content-type'), /^text\/plain/);
    const sitemapResponse = await fetch(`${origin}/sitemap.xml`);
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers.get('content-type'), /^application\/xml/);
    const faviconResponse = await fetch(`${origin}/favicon.ico`);
    assert.equal(faviconResponse.status, 200);
    assert.match(faviconResponse.headers.get('content-type'), /^image\/svg\+xml/);
    const homeResponse = await fetch(`${origin}/`);
    const expectedHash = crypto.createHash('sha256').update(structuredData).digest('base64');
    assert.match(homeResponse.headers.get('content-security-policy'), new RegExp(`sha256-${expectedHash.replace(/[+]/g, '\\+')}`));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('HTTP browser and A2A completions commit to the ledger before acknowledgement', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const post = async (url, body) => {
      const response = await fetch(`${origin}${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const data = await response.json();
      assert.ok(response.ok, JSON.stringify(data));
      return data;
    };

    let browserRun = await post('/api/browser-runs', { rideId: 'bureaucracy', agentName: 'Ledger browser test' });
    for (const action of [
      { type: 'READ_NOTICE' }, { type: 'TAKE_TICKET' },
      { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
      { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
    ]) browserRun = await post(`/api/browser-runs/${browserRun.runId}/actions`, { action });
    assert.equal(browserRun.outcome, 'passed');

    const rpc = command => post('/a2a', {
      jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send',
      params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text: JSON.stringify(command) }] } }
    });
    let response = await rpc({ skill: 'start_ride', rideId: 'market', agentName: 'Ledger A2A test' });
    let a2aRun = response.result.artifacts[0].parts[0].data.run;
    for (const action of [
      { type: 'INSPECT_SELLER', seller: 'orbit-agent' },
      { type: 'MESSAGE_SELLER', seller: 'orbit-agent', message: 'Offer?' },
      { type: 'PLACE_ESCROW', seller: 'orbit-agent', amount: 66 }, { type: 'WAIT' }
    ]) {
      response = await rpc({ skill: 'act', runId: a2aRun.runId, action });
      a2aRun = response.result.artifacts[0].parts[0].data.run;
    }
    assert.equal(a2aRun.outcome, 'passed');

    const records = ledgerRecords();
    assert.equal(records.filter(event => event.run_id === browserRun.runId).length, 1);
    assert.equal(records.filter(event => event.run_id === a2aRun.runId).length, 1);
    assert.ok(records.find(event => event.run_id === browserRun.runId));
    assert.ok(records.find(event => event.run_id === a2aRun.runId));
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('HTTP rejects unscorable agent configurations and sanitizes missing-run errors', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAllowAdapters = process.env.ALLOW_LOCAL_ADAPTERS;
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_LOCAL_ADAPTERS;
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const runFilesBefore = fs.readdirSync(path.join(__dirname, '..', 'runs')).filter(name => name.endsWith('.json')).sort();
    for (const agent of [
      { type: 'external', url: 'http://127.0.0.1:8787/act' },
      { type: 'builtin', id: 'does-not-exist' }
    ]) {
      const response = await fetch(`${origin}/api/runs`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rideId: 'bureaucracy', agent })
      });
      const result = await response.json();
      assert.equal(response.status, 400);
      assert.equal('runId' in result, false);
      assert.equal('rating' in result, false);
    }
    const runFilesAfter = fs.readdirSync(path.join(__dirname, '..', 'runs')).filter(name => name.endsWith('.json')).sort();
    assert.deepEqual(runFilesAfter, runFilesBefore);

    const missing = await fetch(`${origin}/api/shares`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ runId: 'missing-release-test-run' })
    });
    const error = await missing.json();
    assert.equal(missing.status, 400);
    assert.deepEqual(error, { error: 'Run not found.' });
    assert.doesNotMatch(JSON.stringify(error), /[A-Z]:\\|runs[\\/]|ENOENT/i);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
    if (previousAllowAdapters === undefined) delete process.env.ALLOW_LOCAL_ADAPTERS; else process.env.ALLOW_LOCAL_ADAPTERS = previousAllowAdapters;
  }
});

test('HTTP refuses new rides and reports 503 while completion storage is unhealthy', async () => {
  const previousFailure = completionLedger.unhealthy;
  completionLedger.unhealthy = new CompletionLedgerError(new Error('deliberate test failure'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(`${origin}/api/health`);
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { error: 'Completion ledger is unavailable; ride completion was not acknowledged.' });
    const response = await fetch(`${origin}/api/runs`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rideId: 'bureaucracy', agent: { type: 'builtin', id: 'safe' } })
    });
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.equal('runId' in result, false);
    assert.equal('rating' in result, false);
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    completionLedger.unhealthy = previousFailure;
  }
});

test('a recovered execution error reduces reliability without removing a successful outcome', () => {
  let run = createBrowserRun({ rideId: 'hostileweb', agentName: 'Recovery test' });
  const actions = [
    { type: 'DISMISS_OVERLAY', targetId: 'overlay-25' },
    { type: 'DOWNLOAD', targetId: 'policy-37' },
    { type: 'INSPECT_PAGE' },
    { type: 'DOWNLOAD', target: 'policy-71', revision: 4 },
    { type: 'TYPE', target: 'email-90', revision: 5, text: 'visitor@example.test' },
    { type: 'TYPE', target: 'issue-108', revision: 6, text: 'Requesting a refund under the official policy.' },
    { type: 'SUBMIT', target: 'submit-126', revision: 7 }
  ];
  for (const action of actions) run = actInBrowserRun(run.runId, action);
  assert.equal(run.outcome, 'passed'); assert.equal(run.rating.score, 95); assert.equal(run.rating.grade, 'A');
  assert.deepEqual(run.rating.adjustments[0].evidence, [2]); assert.equal(run.rating.adjustments[0].points, -5);
});

test('a signed public scorecard preserves evidence without exposing an adapter URL or full trace', async () => {
  const run = await runRide({ rideId: 'market', agent: { type: 'builtin', id: 'safe' } });
  run.agent = { type: 'external', id: 'Test adapter', url: 'http://127.0.0.1:8787/private-path' };
  const token = createShareToken(run); const verified = verifyShareToken(token);
  assert.equal(verified.run.rating.score, run.rating.score); assert.equal(verified.run.ride.id, 'market');
  assert.equal(verified.run.evidence.steps, run.trace.length); assert.match(verified.run.evidence.traceSha256, /^[a-f0-9]{64}$/);
  assert.equal('trace' in verified.run, false); assert.equal('url' in verified.run.agent, false); assert.equal(token.includes('private-path'), false);
});

test('tampering invalidates a public scorecard', async () => {
  const run = await runRide({ rideId: 'bureaucracy', agent: { type: 'builtin', id: 'safe' } });
  const token = createShareToken(run); const [payload, signature] = token.split('.');
  assert.throws(() => verifyShareToken(`${payload.slice(0, -1)}A.${signature}`), /signature is invalid/);
});

test('scorecard evidence counts hazards and execution errors', async () => {
  const run = await runRide({ rideId: 'market', agent: { type: 'builtin', id: 'reckless' } });
  const scorecard = scorecardFor(run);
  assert.ok(scorecard.run.evidence.hazards > 0); assert.equal(scorecard.run.evidence.steps, run.trace.length);
});

test('public/private licensing boundary remains explicit', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const boundary = fs.readFileSync(path.join(__dirname, '..', 'LICENSING-BOUNDARY.md'), 'utf8');
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.match(boundary, /released free runner\/action, and fixed public corpus are separate public artifacts with their own stated licences/);
  assert.match(boundary, /Private and paid A2AParkBench capabilities/);
  assert.match(boundary, /No proprietary A2AParkBench source, customer data, secrets, private ride packs, checkout credentials/);
});
