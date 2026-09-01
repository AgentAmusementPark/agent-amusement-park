const crypto = require('node:crypto');

const runtimeSecret = process.env.PARK_SHARE_SECRET || crypto.randomBytes(32).toString('hex');

function stableJson(value) { return JSON.stringify(value); }

function traceDigest(trace) {
  return crypto.createHash('sha256').update(stableJson(trace)).digest('hex');
}

function publicAgent(agent) {
  return { type: agent?.type || 'unknown', id: String(agent?.id || 'External agent').slice(0, 80) };
}

function scorecardFor(result) {
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const events = trace.flatMap(step => step.events || []);
  return {
    version: 1,
    issuedAt: new Date().toISOString(),
    run: {
      id: result.runId,
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

module.exports = { createShareToken, verifyShareToken, shareLinksSurviveRestart, scorecardFor };
