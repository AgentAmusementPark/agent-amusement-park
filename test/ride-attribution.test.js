const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'a2apark-attribution-'));
process.env.COMPLETION_ENVIRONMENT = 'test';
process.env.COMPLETION_LEDGER_PATH = path.join(root, 'completions.jsonl');
process.env.RIDE_ATTRIBUTION_TEST_TOKEN = 'private-test-token';
process.env.CANONICAL_ORIGIN = '';
const { server } = require('../server');
const { startContext, referringDomain, campaignSource, RideAttribution } = require('../lib/ride-attribution');
const { aggregate } = require('../tools/ride-report');
const attributionPath = path.join(root, 'ride-attribution.jsonl');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

function records(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
}

test('attribution keeps only broad domains and recognized campaigns', () => {
  assert.equal(referringDomain('member123.medialiteracyireland.ie'), 'medialiteracyireland.ie');
  assert.equal(referringDomain('www.publisher.co.uk'), 'publisher.co.uk');
  assert.equal(referringDomain('bench.a2apark.com'), null);
  assert.equal(referringDomain('192.168.1.4'), null);
  assert.equal(referringDomain('person@publisher.ie/path'), null);
  assert.equal(campaignSource('GitHub'), 'github');
  assert.equal(campaignSource('email-address@example.org'), null);
});

test('exact host and verified test token determine trusted class', () => {
  const input = { referringDomain: 'id123.publisher.ie', campaignSource: 'github', internal: true };
  const canonical = startContext({ headers: { host: 'a2apark.com' } }, 'web_browser', input, process.env);
  assert.deepEqual(canonical, { entrypoint: 'web_browser', referring_domain: 'publisher.ie', campaign_source: 'github', test_class: 'self_marked_internal' });
  const bench = startContext({ headers: { host: 'bench.a2apark.com' } }, 'web_browser', input, process.env);
  assert.deepEqual(bench, { entrypoint: 'web_browser', referring_domain: null, campaign_source: null, test_class: 'unclassified' });
  const testRun = startContext({ headers: { host: 'a2apark.com', 'x-a2apark-test-token': 'private-test-token' } }, 'web_browser', input, process.env);
  assert.equal(testRun.test_class, 'verified_test');
  assert.deepEqual(startContext({ headers: { host: 'a2apark.com' } }, 'mcp', input, process.env), {
    entrypoint: 'mcp', referring_domain: null, campaign_source: null, test_class: 'unclassified'
  });
});

test('website sends minimal attribution only on the Park host and honors the existing internal switch', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
  const functionSource = source.match(/function rideAttribution\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(functionSource);
  const evaluate = (hostname, search, stored) => vm.runInNewContext(`${functionSource}\nrideAttribution()`, {
    location: { hostname, search }, URL, URLSearchParams,
    document: { referrer: 'https://person123.publisher.ie/article?private=1' },
    localStorage: { getItem: () => stored }
  });
  assert.deepEqual(JSON.parse(JSON.stringify(evaluate('bench.a2apark.com', '?internal=1', '1'))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(evaluate('a2apark.com', '?utm_source=github', '1'))), {
    referringDomain: 'publisher.ie', campaignSource: 'github', internal: true
  });
  assert.equal(evaluate('a2apark.com', '', null).internal, false);
});

test('companion record contains no visitor identifiers or ride content', () => {
  const ledger = new RideAttribution(process.env.COMPLETION_LEDGER_PATH);
  const record = ledger.recordStart({ runId: 'random-run', createdAt: '2026-10-10T10:00:00.000Z' }, {
    entrypoint: 'web_demo', referring_domain: 'publisher.ie', campaign_source: null, test_class: 'verified_test'
  });
  assert.deepEqual(Object.keys(record), ['run_id', 'started_at', 'entrypoint', 'referring_domain', 'campaign_source', 'test_class']);
  assert.equal(fs.statSync(attributionPath).mode & 0o777, 0o600);
  assert.deepEqual(records(attributionPath), [record]);
});

test('HTTP starts preserve responses and the completion ledger while applying host separation', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const post = async (route, host, body, token = '') => {
      const { status, data } = await new Promise((resolve, reject) => {
        const request = http.request({ hostname: '127.0.0.1', port: server.address().port, path: route, method: 'POST',
          headers: { host, 'content-type': 'application/json', ...(token ? { 'x-a2apark-test-token': token } : {}) }
        }, response => {
          let text = '';
          response.on('data', chunk => { text += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, data: JSON.parse(text) }));
        });
        request.on('error', reject);
        request.end(JSON.stringify(body));
      });
      assert.equal(status, route === '/a2a' ? 200 : 201, JSON.stringify(data));
      return data;
    };
    const body = { rideId: 'bureaucracy', agentName: 'Attribution check', attribution: {
      referringDomain: 'person123.publisher.ie', campaignSource: 'github', internal: true
    } };
    const canonical = await post('/api/browser-runs', 'a2apark.com', body);
    const bench = await post('/api/browser-runs', 'bench.a2apark.com', body);
    assert.equal('attribution' in canonical, false);
    assert.equal('attribution' in bench, false);
    assert.equal(records(process.env.COMPLETION_LEDGER_PATH).length, 0);
    const demo = await post('/api/runs', 'a2apark.com', {
      rideId: 'bureaucracy', agent: { type: 'builtin', id: 'safe' },
      attribution: { referringDomain: 'www.publisher.co.uk', campaignSource: 'email@example.org' }
    }, 'private-test-token');
    assert.equal(demo.outcome, 'passed');
    assert.equal('attribution' in demo, false);
    const a2a = await post('/a2a', 'a2apark.com', {
      jsonrpc: '2.0', id: 'attribution-check', method: 'message/send',
      params: { message: { messageId: 'attribution-check', role: 'user', parts: [{ kind: 'text', text: JSON.stringify({ skill: 'start_ride', rideId: 'market' }) }] } }
    });
    const a2aRun = a2a.result.artifacts[0].parts[0].data.run;
    const starts = records(attributionPath);
    assert.deepEqual(starts.find(item => item.run_id === canonical.runId), {
      run_id: canonical.runId, started_at: canonical.createdAt, entrypoint: 'web_browser',
      referring_domain: 'publisher.ie', campaign_source: 'github', test_class: 'self_marked_internal'
    });
    assert.deepEqual(starts.find(item => item.run_id === bench.runId), {
      run_id: bench.runId, started_at: bench.createdAt, entrypoint: 'web_browser',
      referring_domain: null, campaign_source: null, test_class: 'unclassified'
    });
    assert.equal(starts.find(item => item.run_id === demo.runId).test_class, 'verified_test');
    assert.equal(starts.find(item => item.run_id === demo.runId).referring_domain, 'publisher.co.uk');
    assert.equal(starts.find(item => item.run_id === a2aRun.runId).entrypoint, 'a2a');
    const completions = records(process.env.COMPLETION_LEDGER_PATH);
    assert.equal(completions.length, 1);
    assert.equal(completions[0].run_id, demo.runId);
    assert.deepEqual(Object.keys(completions[0]).sort(), ['event_id', 'run_id', 'completed_at', 'ride_id', 'ride_version', 'completion_status', 'result_status', 'environment'].sort());
  } finally {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('report keeps older completions unattributed and excludes controlled tests from operational counts', () => {
  const completions = [
    { run_id: 'historic', completed_at: '2026-10-09T10:00:00.000Z', result_status: 'passed' },
    { run_id: 'new', completed_at: '2026-10-10T10:00:00.000Z', result_status: 'failed' },
    { run_id: 'unknown', completed_at: '2026-10-10T11:00:00.000Z', result_status: 'passed' },
    { run_id: 'internal', completed_at: '2026-10-10T12:00:00.000Z', result_status: 'passed' }
  ];
  const starts = [
    { run_id: 'new', started_at: '2026-10-10T09:00:00.000Z', entrypoint: 'web_demo', referring_domain: null, campaign_source: 'github', test_class: 'verified_test' },
    { run_id: 'unknown', started_at: '2026-10-10T10:30:00.000Z', entrypoint: 'web_demo', referring_domain: null, campaign_source: null, test_class: 'unclassified' },
    { run_id: 'internal', started_at: '2026-10-10T11:30:00.000Z', entrypoint: 'web_demo', referring_domain: null, campaign_source: null, test_class: 'self_marked_internal' }
  ];
  const report = aggregate(completions, starts);
  assert.equal(report.total_completed, 4);
  assert.equal(report.total_operational_completed, 1);
  assert.equal(report.total_excluded_internal_or_test, 2);
  assert.equal(report.completed_without_attribution, 1);
  assert.equal(report.by_day['2026-10-09'].by_source.legacy_or_missing_attribution, 1);
  assert.equal(report.by_day['2026-10-10'].by_test_class.verified_test, 1);
  assert.equal(report.by_day['2026-10-10'].operational_completed, 1);
});
