const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { rides } = require('./lib/rides');
const { runRide, publicRide, createBrowserRun, getBrowserRun, actInBrowserRun } = require('./lib/runner');
const { createShareToken, verifyShareToken, shareLinksSurviveRestart } = require('./lib/share');
const { agentCard, handleA2A } = require('./lib/a2a');

const root = __dirname; const publicDir = path.join(root, 'public'); const runsDir = path.join(root, 'runs'); const eventsFile = path.join(root, 'events.ndjson');
fs.mkdirSync(runsDir, { recursive: true });

const securityHeaders = {
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'
};
function json(res, status, body) { res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function serveFile(res, file) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
  fs.readFile(file, (error, data) => { if (error) return json(res, 404, { error: 'Not found' }); res.writeHead(200, { ...securityHeaders, 'content-type': types[path.extname(file)] || 'application/octet-stream' }); res.end(data); });
}
function persistRun(result) {
  const files = fs.readdirSync(runsDir).filter(name => name.endsWith('.json'));
  if (files.length >= 500) {
    const oldest = files.map(name => ({ name, mtime: fs.statSync(path.join(runsDir, name)).mtimeMs })).sort((a, b) => a.mtime - b.mtime).slice(0, files.length - 499);
    for (const file of oldest) fs.unlinkSync(path.join(runsDir, file.name));
  }
  fs.writeFileSync(path.join(runsDir, `${result.runId}.json`), JSON.stringify(result, null, 2));
}
function readPersistedRun(runId) {
  const safeId = path.basename(String(runId || ''));
  if (!safeId || safeId !== runId) throw new Error('Invalid run ID.');
  return JSON.parse(fs.readFileSync(path.join(runsDir, `${safeId}.json`), 'utf8'));
}
function recordEvent(name, metadata = {}) {
  const allowed = new Set(['landing_viewed', 'run_completed', 'scorecard_created', 'scorecard_viewed', 'challenge_started', 'team_page_viewed', 'checkout_clicked', 'contact_clicked']);
  if (!allowed.has(name)) throw new Error('Unknown event.');
  if (fs.existsSync(eventsFile) && fs.statSync(eventsFile).size >= 5_000_000) return;
  const cleanMetadata = Object.fromEntries(Object.entries(metadata).slice(0, 8).map(([key, value]) => [String(key).slice(0, 40), String(value).slice(0, 120)]));
  const event = { at: new Date().toISOString(), name, metadata: cleanMetadata };
  fs.appendFileSync(eventsFile, `${JSON.stringify(event)}\n`);
  console.log(`[event] ${JSON.stringify(event)}`);
}
function safeHttpsUrl(value) { try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.toString() : ''; } catch { return ''; } }
function cleanSource(value) { return /^[a-z0-9_-]{1,40}$/i.test(String(value || '')) ? String(value).toLowerCase() : 'direct'; }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/.well-known/agent.json')) {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const protocol = forwardedProto === 'https' ? 'https' : 'http';
      const host = req.headers.host || 'localhost';
      return json(res, 200, agentCard(`${protocol}://${host}`));
    }
    if (req.method === 'POST' && url.pathname === '/a2a') {
      const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
      const protocol = forwardedProto === 'https' ? 'https' : 'http';
      const origin = `${protocol}://${req.headers.host || 'localhost'}`;
      const handled = handleA2A(await readBody(req), {
        origin,
        salesEmail: process.env.SALES_EMAIL || '',
        teamPrice: '€199/month'
      });
      if (handled.run) persistRun(handled.run);
      if (handled.completed) recordEvent('run_completed', { source: handled.run.acquisitionSource || 'a2a_registry', rideId: handled.run.ride.id, agentType: 'a2a', outcome: handled.run.outcome, score: handled.run.rating.score });
      return json(res, handled.response.error ? 400 : 200, handled.response);
    }
    if (req.method === 'GET' && url.pathname === '/api/rides') return json(res, 200, rides.map(publicRide));
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const body = await readBody(req); const result = await runRide(body);
      persistRun(result); recordEvent('run_completed', { source: cleanSource(body.source), rideId: result.ride.id, agentType: result.agent.type, outcome: result.outcome, score: result.rating.score });
      return json(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/browser-runs') {
      const body = await readBody(req); const result = createBrowserRun({ ...body, source: cleanSource(body.source) }); persistRun(result); return json(res, 201, result);
    }
    const browserActionMatch = url.pathname.match(/^\/api\/browser-runs\/([^/]+)\/actions$/);
    if (req.method === 'POST' && browserActionMatch) {
      const result = actInBrowserRun(decodeURIComponent(browserActionMatch[1]), (await readBody(req)).action);
      persistRun(result);
      if (result.outcome !== 'in_progress') recordEvent('run_completed', { source: result.acquisitionSource || 'direct', rideId: result.ride.id, agentType: 'browser', outcome: result.outcome, score: result.rating.score });
      return json(res, 200, result);
    }
    const browserRunMatch = url.pathname.match(/^\/api\/browser-runs\/([^/]+)$/);
    if (req.method === 'GET' && browserRunMatch) return json(res, 200, getBrowserRun(decodeURIComponent(browserRunMatch[1])));
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
      const id = path.basename(url.pathname); return serveFile(res, path.join(runsDir, `${id}.json`));
    }
    if (req.method === 'POST' && url.pathname === '/api/shares') {
      const body = await readBody(req); const result = readPersistedRun(body.runId); const token = createShareToken(result);
      recordEvent('scorecard_created', { source: cleanSource(body.source), rideId: result.ride.id, outcome: result.outcome, score: result.rating.score });
      return json(res, 201, { token, path: `/share.html#${token}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/shares/verify') {
      const scorecard = verifyShareToken((await readBody(req)).token); return json(res, 200, scorecard);
    }
    if (req.method === 'POST' && url.pathname === '/api/events') {
      const body = await readBody(req); recordEvent(body.name, body.metadata); return json(res, 202, { ok: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, {
      externalAdaptersEnabled: process.env.ALLOW_LOCAL_ADAPTERS === 'true',
      checkoutUrl: safeHttpsUrl(process.env.CHECKOUT_URL || ''), salesEmail: process.env.SALES_EMAIL || '',
      teamPrice: '€199/month', shareLinksSurviveRestart: shareLinksSurviveRestart()
    });
    if (req.method === 'GET' && url.pathname === '/api/health') return json(res, 200, { ok: true, rides: rides.length, shareLinksSurviveRestart: shareLinksSurviveRestart() });
    const requested = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = path.resolve(publicDir, requested);
    if (path.relative(publicDir, file).startsWith('..')) return json(res, 403, { error: 'Forbidden' });
    return serveFile(res, file);
  } catch (error) { return json(res, 400, { error: error.message }); }
});

if (require.main === module) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(`Agent Amusement Park running at http://${host}:${port}`));
}
module.exports = { server };

