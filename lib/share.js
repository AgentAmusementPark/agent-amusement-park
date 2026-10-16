const crypto = require('node:crypto');

const runtimeSecret = process.env.PARK_SHARE_SECRET || crypto.randomBytes(32).toString('hex');

function stableJson(value) { return JSON.stringify(value); }

function traceDigest(trace) {
  return crypto.createHash('sha256').update(stableJson(trace)).digest('hex');
}

function publicAgent(agent) {
  return { type: agent?.type || 'unknown', id: agent?.type === 'builtin' ? agent.id : 'Anonymous agent' };
}

function publicIdFor(runId) {
  return `run-${crypto.createHmac('sha256', runtimeSecret).update(`public-id:${runId}`).digest('hex').slice(0, 24)}`;
}

function createPublicationToken(runId) {
  return `${runId}.${crypto.createHmac('sha256', runtimeSecret).update(`publish:${runId}`).digest('base64url')}`;
}

function verifyPublicationToken(token) {
  if (typeof token !== 'string' || token.length > 200) throw new Error('Invalid private publication link.');
  const [runId, signature, extra] = token.split('.');
  if (!runId || !signature || extra) throw new Error('Invalid private publication link.');
  const expected = Buffer.from(createPublicationToken(runId));
  const supplied = Buffer.from(token);
  if (expected.length !== supplied.length || !crypto.timingSafeEqual(expected, supplied)) throw new Error('Invalid private publication link.');
  return runId;
}

function scorecardFor(result) {
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const events = trace.flatMap(step => step.events || []);
  return {
    version: 1,
    issuedAt: new Date().toISOString(),
    run: {
      id: publicIdFor(result.runId),
      createdAt: result.createdAt,
      ride: result.ride,
      agent: publicAgent(result.agent),
      outcome: result.outcome,
      rating: result.rating,
      evidence: {
        steps: trace.length,
        hazards: events.filter(event => event.type === 'hazard').length,
        executionErrors: events.filter(event => event.type === 'error').length,
        traceSha256: traceDigest(trace)
      }
    }
  };
}

function sign(encodedPayload) {
  return crypto.createHmac('sha256', runtimeSecret).update(encodedPayload).digest('base64url');
}

function createShareToken(result) {
  const encodedPayload = Buffer.from(stableJson(scorecardFor(result))).toString('base64url');
  return `${encodedPayload}.${sign(encodedPayload)}`;
}

function verifyShareToken(token) {
  if (typeof token !== 'string' || token.length > 20_000) throw new Error('Invalid scorecard token.');
  const [encodedPayload, suppliedSignature, extra] = token.split('.');
  if (!encodedPayload || !suppliedSignature || extra) throw new Error('Invalid scorecard token.');
  const expectedSignature = sign(encodedPayload);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) throw new Error('Scorecard signature is invalid.');
  const scorecard = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (scorecard?.version !== 1 || !scorecard?.run?.ride?.id || !scorecard?.run?.rating) throw new Error('Scorecard payload is invalid.');
  return scorecard;
}

function shareLinksSurviveRestart() { return Boolean(process.env.PARK_SHARE_SECRET); }

module.exports = { createShareToken, verifyShareToken, shareLinksSurviveRestart, scorecardFor, publicIdFor, createPublicationToken, verifyPublicationToken };
