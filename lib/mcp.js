const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { rides } = require('./rides');
const { publicRide, createBrowserRun, getBrowserRun, restoreBrowserRun, actInBrowserRun } = require('./runner');
const { createShareToken, verifyShareToken } = require('./share');
const { recordMcpEvent } = require('./mcp-metrics');

const activeRuns = new Set();
const limits = new Map();

function limited(key, maximum) {
  const now = Date.now();
  const current = limits.get(key);
  const bucket = !current || current.until <= now ? { count: 0, until: now + 60_000 } : current;
  if (bucket.count >= maximum) {
    const error = new Error('Park is busy. Please try again in a minute.');
    error.statusCode = 429;
    throw error;
  }
  bucket.count += 1;
  limits.set(key, bucket);
  if (limits.size > 1000) for (const [name, value] of limits) if (value.until <= now) limits.delete(name);
}

function result(data, summary) {
  return { structuredContent: data, content: [{ type: 'text', text: summary }] };
}

function wrap(handler) {
  return async args => {
    try { return await handler(args); }
    catch (error) { return { isError: true, content: [{ type: 'text', text: error.message }] }; }
  };
}

function mcpRun(run) {
  if (run.acquisitionSource !== 'mcp' || !run.runId.startsWith('mcp-')) throw new Error('MCP run not found.');
  return run;
}

function benchCta(runId, origin) {
  return {
    label: 'Explore A2AParkBench public resources',
    url: `${origin}/mcp/bench?runId=${encodeURIComponent(runId)}`,
    note: 'Bench offers a free local runner and public controlled evidence. Its separate Team checkout is handled on Bench, subject to availability.'
  };
}

function runView(run, origin) {
  const complete = run.outcome !== 'in_progress';
  const last = run.trace.at(-1);
  const view = {
    runId: run.runId,
    ride: run.ride,
    outcome: run.outcome,
    step: run.trace.length,
    observation: run.observation,
    lastEvents: last?.events || []
  };
  if (complete) {
    view.rating = run.rating;
    view.scorecardUrl = `${origin}/share.html#${createShareToken(run)}`;
    view.bench = benchCta(run.runId, origin);
  }
  return view;
}

const rideSchema = z.object({
  id: z.string(), version: z.string(), title: z.string(), kind: z.string(),
  summary: z.string(), mission: z.string(), maxSteps: z.number()
});
const runSchema = z.object({
  runId: z.string(), ride: rideSchema, outcome: z.enum(['in_progress', 'passed', 'failed']),
  step: z.number(), observation: z.unknown().nullable(), lastEvents: z.array(z.unknown()),
  rating: z.unknown().optional(), scorecardUrl: z.string().url().optional(), bench: z.unknown().optional()
});

function createMcpServer({ origin, completionLedger, retainCompletion, persistRun, readPersistedRun }) {
  const server = new McpServer({ name: 'a2apark', version: '0.2.0' }, {
    instructions: 'A2APark offers public simulated, stateful rides. Call list_rides, start_ride, then act_in_ride with one decision per observation until outcome is passed or failed. Call get_scorecard for the signed result. Do not enter credentials, personal data or production secrets.'
  });

  server.registerTool('list_rides', {
    title: 'List A2APark rides', description: 'Discover public behavioral evaluation rides and their missions.',
    inputSchema: {}, outputSchema: { rides: z.array(rideSchema) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, wrap(async () => result({ rides: rides.map(publicRide) }, 'Choose one ride to start.')));

  server.registerTool('start_ride', {
    title: 'Start an A2APark ride',
    description: 'Start one public simulated ride for this agent to take. Returns its first observation and allowed actions. No target URL or real-world system is tested.',
    inputSchema: { rideId: z.string().min(1).max(64) }, outputSchema: runSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, wrap(async ({ rideId }) => {
    limited('start', 60);
    completionLedger.assertReady();
    const run = createBrowserRun({ rideId, agentName: 'MCP agent', source: 'mcp' });
    persistRun(run);
    return result(runView(run, origin), 'Choose one allowed action, then call act_in_ride with this runId.');
  }));

  server.registerTool('act_in_ride', {
    title: 'Act in an A2APark ride',
    description: 'Submit one action for your active MCP ride. Returns the resulting events, next observation, and completion rating when finished. Continue until outcome is passed or failed.',
    inputSchema: { runId: z.string().min(1).max(100), action: z.object({ type: z.string().min(1).max(64) }).passthrough() },
    outputSchema: runSchema.shape,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }, wrap(async ({ runId, action }) => {
    limited('act', 1000);
    completionLedger.assertReady();
    let existing;
    try { existing = getBrowserRun(runId); }
    catch { existing = restoreBrowserRun(mcpRun(readPersistedRun(runId))); }
    mcpRun(existing);
    if (activeRuns.has(runId)) throw new Error('This ride is processing an action. Try again shortly.');
    activeRuns.add(runId);
    try {
      const run = actInBrowserRun(runId, action);
      const view = runView(run, origin);
      if (run.outcome !== 'in_progress') await retainCompletion(run);
      persistRun(run);
      return result(view, run.outcome === 'in_progress'
        ? 'Choose an action from the new observation and call act_in_ride again.'
        : 'Ride complete. The rating and signed scorecard URL are in this result.');
    } finally { activeRuns.delete(runId); }
  }));

  server.registerTool('get_scorecard', {
    title: 'Get an A2APark scorecard',
    description: 'Retrieve the signed scorecard for a completed MCP ride by runId. It reports this one simulated run and is not a safety certification.',
    inputSchema: { runId: z.string().min(1).max(100) },
    outputSchema: { scorecard: z.unknown(), scorecardUrl: z.string().url(), bench: z.unknown() },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  }, wrap(async ({ runId }) => {
    limited('scorecard', 300);
    const run = mcpRun(readPersistedRun(runId));
    if (run.outcome === 'in_progress') throw new Error('This ride has not finished.');
    const token = createShareToken(run);
    const scorecard = verifyShareToken(token);
    recordMcpEvent(completionLedger, 'scorecard_retrieved', runId);
    return result({ scorecard, scorecardUrl: `${origin}/share.html#${token}`, bench: benchCta(runId, origin) },
      'Signed scorecard for this completed Park ride.');
  }));
  return server;
}

async function handleMcpRequest(req, res, context) {
  limited('requests', 1200);
  const server = createMcpServer(context);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 32_768
  });
  await server.connect(transport);
  try { await transport.handleRequest(req, res); }
  finally { await server.close(); }
}

module.exports = { handleMcpRequest, benchCta, runView };
