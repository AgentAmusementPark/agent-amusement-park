const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CAMPAIGNS = new Set(['github', 'smithery', 'mcp_registry', 'reddit', 'chatgpt', 'claude', 'newsletter']);
const ENTRYPOINTS = new Set(['web_demo', 'web_browser', 'mcp', 'a2a']);
const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'co.jp']);

function referringDomain(value) {
  if (typeof value !== 'string') return null;
  const hostname = value.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,120}$/.test(hostname) || !hostname.includes('.') || /^\d+(?:\.\d+){3}$/.test(hostname)) return null;
  const labels = hostname.split('.');
  if (labels.some(label => !label || label.startsWith('-') || label.endsWith('-'))) return null;
  const suffix = labels.slice(-2).join('.');
  const domain = labels.slice(-(TWO_PART_SUFFIXES.has(suffix) ? 3 : 2)).join('.');
  return domain === 'a2apark.com' || domain === suffix && TWO_PART_SUFFIXES.has(suffix) ? null : domain;
}

function campaignSource(value) {
  if (typeof value !== 'string') return null;
  const source = value.trim().toLowerCase();
  return CAMPAIGNS.has(source) ? source : null;
}

function verifiedTest(req, env = process.env) {
  const expected = env.RIDE_ATTRIBUTION_TEST_TOKEN;
  const supplied = req.headers['x-a2apark-test-token'];
  if (!expected || typeof supplied !== 'string' || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function startContext(req, entrypoint, submitted = {}, env = process.env) {
  if (!ENTRYPOINTS.has(entrypoint)) throw new Error('Invalid ride entrypoint.');
  const testClass = verifiedTest(req, env) ? 'verified_test' : 'unclassified';
  if (!entrypoint.startsWith('web_')) return { entrypoint, referring_domain: null, campaign_source: null, test_class: testClass };
  const host = String(req.headers.host || '').toLowerCase().split(':')[0];
  const canonical = host === 'a2apark.com' || (env.COMPLETION_ENVIRONMENT !== 'production' && ['127.0.0.1', 'localhost'].includes(host));
  const input = submitted && typeof submitted === 'object' && !Array.isArray(submitted) ? submitted : {};
  return {
    entrypoint,
    referring_domain: canonical ? referringDomain(input.referringDomain) : null,
    campaign_source: canonical ? campaignSource(input.campaignSource) : null,
    test_class: testClass === 'verified_test' ? testClass : canonical && input.internal === true ? 'self_marked_internal' : 'unclassified'
  };
}

class RideAttribution {
  constructor(completionLedgerPath) {
    this.path = path.join(path.dirname(completionLedgerPath), 'ride-attribution.jsonl');
  }

  recordStart(run, context) {
    if (!run?.runId || !run?.createdAt || !ENTRYPOINTS.has(context?.entrypoint)) throw new Error('Invalid ride attribution start.');
    const record = {
      run_id: run.runId,
      started_at: run.createdAt,
      entrypoint: context.entrypoint,
      referring_domain: context.referring_domain || null,
      campaign_source: context.campaign_source || null,
      test_class: context.test_class
    };
    const fd = fs.openSync(this.path, 'a', 0o600);
    try {
      const line = Buffer.from(`${JSON.stringify(record)}\n`);
      let offset = 0;
      while (offset < line.length) {
        const written = fs.writeSync(fd, line, offset, line.length - offset);
        if (!written) throw new Error('Ride attribution write made no progress.');
        offset += written;
      }
      fs.fsyncSync(fd);
    }
    finally { fs.closeSync(fd); }
    return record;
  }
}

module.exports = { RideAttribution, startContext, referringDomain, campaignSource, verifiedTest };
