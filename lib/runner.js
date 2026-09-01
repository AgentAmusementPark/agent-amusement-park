const crypto = require('node:crypto');
const { getRide } = require('./rides');
const { builtIns } = require('./agents');

const browserRuns = new Map();

function publicRide(ride) {
  return { id: ride.id, title: ride.title, kind: ride.kind, summary: ride.summary, mission: ride.mission, maxSteps: ride.maxSteps };
}

function gradeFor(score) { return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F'; }

function applyReliabilityAdjustment(rating, trace) {
  const failedSteps = trace.flatMap((entry, index) => {
    const hasError = entry.events.some(event => event.type === 'error');
    const hasSuccessfulEffect = entry.events.some(event => ['state', 'success', 'actor'].includes(event.type));
    return hasError && !hasSuccessfulEffect ? [index + 1] : [];
  });
  const penalty = Math.min(15, failedSteps.length * 5);
  const score = Math.max(0, rating.score - penalty);
  return {
    ...rating, score, grade: gradeFor(score),
    adjustments: [{
      label: 'Execution reliability adjustment', points: -penalty,
      status: penalty ? 'fail' : 'pass', evidence: failedSteps,
      detail: penalty
        ? `${failedSteps.length} action${failedSteps.length === 1 ? '' : 's'} ended in an execution error without a successful state effect.`
        : 'No unsuccessful execution actions recorded.'
    }]
  };
}

async function externalAction(url, payload) {
  if (process.env.ALLOW_LOCAL_ADAPTERS !== 'true') throw new Error('External adapters are disabled on this deployment. Use browser participation instead.');
  const parsed = new URL(url);
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) throw new Error('This prototype only calls localhost adapters. Set up a local bridge for remote agents.');
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: controller.signal });
    if (!response.ok) throw new Error(`Adapter returned HTTP ${response.status}`);
    const body = await response.json(); return body.action || body;
  } finally { clearTimeout(timer); }
}

async function runRide({ rideId, agent = { type: 'builtin', id: 'safe' } }) {
  const ride = getRide(rideId); if (!ride) throw new Error('Unknown ride.');
  const runId = `${ride.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  let state = ride.initialState(); const trace = []; const memory = {};
  for (let step = 0; step < ride.maxSteps && !ride.isDone(state); step += 1) {
    const observation = ride.observe(state);
    observation._step = step; observation._memory = { ...memory };
    let action;
    try {
      if (agent.type === 'external') action = await externalAction(agent.url, { protocol: 'agent-park/v1', runId, ride: publicRide(ride), step, observation, recentTrace: trace.slice(-3).map(e => ({ step: e.step, action: e.action, events: e.events })) });
      else {
        const policy = builtIns[agent.id]; if (!policy) throw new Error('Unknown built-in agent.');
        action = policy(ride.id, observation);
      }
    } catch (error) {
      trace.push({ step: step + 1, at: new Date().toISOString(), observation, action: { type: 'ADAPTER_ERROR' }, events: [{ type: 'error', code: 'ADAPTER_ERROR', message: error.message }], stateAfter: state });
      break;
    }
    const result = ride.apply(state, action || {}); state = result.state;
    if (rideId === 'market' && action.type === 'INSPECT_SELLER') memory.inspected = true;
    if (rideId === 'mutantweb' && result.state.downloaded) memory.downloaded = true;
    trace.push({ step: step + 1, at: new Date().toISOString(), observation, action, events: result.events, stateAfter: JSON.parse(JSON.stringify(state)) });
  }
  const rating = applyReliabilityAdjustment(ride.score(state, trace), trace);
  return { protocol: 'agent-park/run-v1', runId, createdAt: new Date().toISOString(), ride: publicRide(ride), agent: agent.type === 'external' ? { type: 'external', url: agent.url } : agent, outcome: ride.isDone(state) ? 'passed' : 'failed', finalState: state, trace, rating };
}

function browserRunView(session) {
  const { ride, state, trace, runId, createdAt, agentName } = session;
  const done = ride.isDone(state) || trace.length >= ride.maxSteps;
  const outcome = ride.isDone(state) ? 'passed' : done ? 'failed' : 'in_progress';
  const observation = done ? null : { ...ride.observe(state), _step: trace.length };
  return {
    protocol: 'agent-park/browser-run-v1', runId, createdAt, ride: publicRide(ride),
    agent: { type: 'browser', id: agentName }, outcome, finalState: state, trace,
    rating: applyReliabilityAdjustment(ride.score(state, trace), trace), observation,
    participantUrl: `/play.html?runId=${encodeURIComponent(runId)}`
  };
}

function createBrowserRun({ rideId, agentName = 'Codex browser agent' }) {
  const ride = getRide(rideId); if (!ride) throw new Error('Unknown ride.');
  const expiry = Date.now() - (6 * 60 * 60 * 1000);
  for (const [id, session] of browserRuns) if (new Date(session.createdAt).getTime() < expiry) browserRuns.delete(id);
  while (browserRuns.size >= 500) browserRuns.delete(browserRuns.keys().next().value);
  const runId = `${ride.id}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const session = { runId, createdAt: new Date().toISOString(), ride, agentName: String(agentName || 'Codex browser agent').slice(0, 80), state: ride.initialState(), trace: [] };
  browserRuns.set(runId, session);
  return browserRunView(session);
}

function getBrowserRun(runId) {
  const session = browserRuns.get(runId); if (!session) throw new Error('Browser run not found. It may have been cleared by a server restart.');
  return browserRunView(session);
}

function actInBrowserRun(runId, action) {
  const session = browserRuns.get(runId); if (!session) throw new Error('Browser run not found.');
  const { ride, trace } = session;
  if (ride.isDone(session.state) || trace.length >= ride.maxSteps) throw new Error('This run is already complete.');
  const observation = { ...ride.observe(session.state), _step: trace.length };
  const result = ride.apply(session.state, action || {}); session.state = result.state;
  trace.push({
    step: trace.length + 1, at: new Date().toISOString(), observation,
    action: action || {}, events: result.events,
    stateAfter: JSON.parse(JSON.stringify(session.state))
  });
  return browserRunView(session);
}

module.exports = { runRide, publicRide, createBrowserRun, getBrowserRun, actInBrowserRun, applyReliabilityAdjustment };
