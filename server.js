const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { rides } = require('./lib/rides');
const { runRide, publicRide, createBrowserRun, getBrowserRun, actInBrowserRun } = require('./lib/runner');
const { createShareToken, verifyShareToken, shareLinksSurviveRestart } = require('./lib/share');
const { agentCard, handleA2A } = require('./lib/a2a');

const root = __dirname; const publicDir = path.join(root, 'public'); const runsDir = path.join(root, 'runs');
fs.mkdirSync(runsDir, { recursive: true });

const structuredData = '{"@context":"https://schema.org","@type":"WebSite","name":"A2APark","url":"https://a2apark.com/","description":"An agent amusement park and behavioral evaluation engine with evidence-backed scorecards.","creator":{"@type":"Person","name":"Sarah van Oorsouw"},"publisher":{"@type":"Person","name":"Sarah van Oorsouw"}}';
const structuredDataHash = crypto.createHash('sha256').update(structuredData).digest('base64');
const securityHeaders = {
  'content-security-policy': `default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self' 'sha256-${structuredDataHash}'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
  'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'
};
function json(res, status, body) { res.writeHead(status, { ...securityHeaders, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) { return new Promise((resolve, reject) => { let body = ''; req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function serveFile(res, file) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.jsonld': 'application/ld+json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
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
function safeHttpsUrl(value) { try { const parsed = new URL(value); return parsed.protocol === 'https:' ? parsed.toString() : ''; } catch { return ''; } }
function safeHttpsOrigin(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed.origin : '';
  } catch { return ''; }
}
function requestOrigin(req, env = process.env) {
  const canonical = safeHttpsOrigin(env.CANONICAL_ORIGIN || '');
  if (canonical) return canonical;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto === 'https' ? 'https' : 'http';
  return `${protocol}://${req.headers.host || 'localhost'}`;
}
function canonicalRedirect(req, url, env = process.env) {
  const canonical = safeHttpsOrigin(env.CANONICAL_ORIGIN || '');
  if (!canonical) return '';
  const hostname = String(req.headers.host || '').split(':')[0].toLowerCase();
  const redirectHosts = new Set(['www.a2apark.com', 'agent-amusement-park.onrender.com']);
  for (const extra of String(env.CANONICAL_REDIRECT_HOSTS || '').split(',')) if (extra.trim()) redirectHosts.add(extra.trim().toLowerCase());
  if (!redirectHosts.has(hostname)) return '';
  return `${canonical}${url.pathname}${url.search}`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const redirect = canonicalRedirect(req, url);
    if (redirect) { res.writeHead(308, { ...securityHeaders, location: redirect, 'cache-control': 'public, max-age=3600' }); return res.end(); }
    const origin = requestOrigin(req);
    const benchOrigin = safeHttpsOrigin(process.env.BENCH_ORIGIN || '');
    if (req.method === 'GET' && (url.pathname === '/bench' || url.pathname === '/teams.html') && benchOrigin) {
      res.writeHead(308, { ...securityHeaders, location: `${benchOrigin}/${url.search}`, 'cache-control': 'public, max-age=3600' }); return res.end();
    }
    if (req.method === 'GET' && url.pathname === '/bench') return serveFile(res, path.join(publicDir, 'teams.html'));
    if (req.method === 'GET' && (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/.well-known/agent.json')) {
      return json(res, 200, agentCard(origin));
    }
    if (req.method === 'POST' && url.pathname === '/a2a') {
      const handled = handleA2A(await readBody(req), {
        origin,
        salesEmail: process.env.SALES_EMAIL || '',
        benchOrigin
      });
      if (handled.run) persistRun(handled.run);
      return json(res, handled.response.error ? 400 : 200, handled.response);
    }
    if (req.method === 'GET' && url.pathname === '/api/rides') return json(res, 200, rides.map(publicRide));
    if (req.method === 'POST' && url.pathname === '/api/runs') {
      const body = await readBody(req); const result = await runRide(body);
      persistRun(result);
      return json(res, 201, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/browser-runs') {
      const result = createBrowserRun(await readBody(req)); persistRun(result);
      return json(res, 201, { ...result, participantUrl: `${origin}${result.participantUrl}` });
    }
    const browserActionMatch = url.pathname.match(/^\/api\/browser-runs\/([^/]+)\/actions$/);
    if (req.method === 'POST' && browserActionMatch) {
      const result = actInBrowserRun(decodeURIComponent(browserActionMatch[1]), (await readBody(req)).action);
      persistRun(result);
      return json(res, 200, result);
    }
    const browserRunMatch = url.pathname.match(/^\/api\/browser-runs\/([^/]+)$/);
    if (req.method === 'GET' && browserRunMatch) return json(res, 200, getBrowserRun(decodeURIComponent(browserRunMatch[1])));
    if (req.method === 'GET' && url.pathname.startsWith('/api/runs/')) {
      const id = path.basename(url.pathname); return serveFile(res, path.join(runsDir, `${id}.json`));
    }
    if (req.method === 'POST' && url.pathname === '/api/shares') {
      const body = await readBody(req); const result = readPersistedRun(body.runId); const token = createShareToken(result);
      const sharePath = `/share.html#${token}`;
      return json(res, 201, { token, path: sharePath, url: `${origin}${sharePath}` });
    }
    if (req.method === 'POST' && url.pathname === '/api/shares/verify') {
      const scorecard = verifyShareToken((await readBody(req)).token); return json(res, 200, scorecard);
    }
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, {
      externalAdaptersEnabled: process.env.NODE_ENV !== 'production' || process.env.ALLOW_LOCAL_ADAPTERS === 'true',
      checkoutUrl: safeHttpsUrl(process.env.CHECKOUT_URL || ''), salesEmail: process.env.SALES_EMAIL || '',
      canonicalOrigin: origin, benchOrigin, benchAvailable: Boolean(benchOrigin), shareLinksSurviveRestart: shareLinksSurviveRestart()
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
  server.listen(port, host, () => console.log(`A2APark running at http://${host}:${port}`));
}
module.exports = { server, safeHttpsOrigin, requestOrigin, canonicalRedirect, structuredData };
