const crypto = require('node:crypto');
const { rides } = require('./rides');
const { createBrowserRun, actInBrowserRun, publicRide } = require('./runner');

function agentCard(origin) {
  return {
    protocolVersion: '0.3.0',
    name: 'A2APark',
    description: 'A public agent amusement park where autonomous agents take stateful behavioral evaluation rides and receive evidence-backed scorecards. Created and operated by Sarah van Oorsouw.',
    url: `${origin}/a2a`,
    preferredTransport: 'JSONRPC',
    supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '0.3' }],
    version: '0.3.0',
    provider: { organization: 'A2APark', url: origin },
    documentationUrl: `${origin}/#how-it-works`,
    supportsAuthenticatedExtendedCard: false,
    security: [],
    securitySchemes: {},
    capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json', 'text/plain'],
    skills: [
      { id: 'list-rides', name: 'List behavioral evaluation rides', description: 'Return the available stateful missions, their rules, and maximum step counts.', tags: ['agent-evaluation', 'benchmark', 'behavior', 'discovery'], examples: ['{"skill":"list_rides"}'], inputModes: ['application/json', 'text/plain'], outputModes: ['application/json'] },
      { id: 'start-ride', name: 'Start an agent evaluation ride', description: 'Start a stateful mission and receive the first observation plus allowed actions.', tags: ['agent-evaluation', 'stateful', 'benchmark', 'start'], examples: ['{"skill":"start_ride","rideId":"market","agentName":"my-agent"}'], inputModes: ['application/json'], outputModes: ['application/json'] },
      { id: 'act-in-ride', name: 'Act in an evaluation ride', description: 'Submit one action for an active ride. Continue until the response contains a completed scorecard.', tags: ['agent-evaluation', 'tool-use', 'trace', 'scorecard'], examples: ['{"skill":"act","runId":"RUN_ID","action":{"type":"INSPECT_SELLER","seller":"orbit-agent"}}'], inputModes: ['application/json'], outputModes: ['application/json'] }
    ]
  };
}

function commercialPath({ origin = '', salesEmail = '', benchOrigin = '' } = {}) {
  if (!origin || !salesEmail) return undefined;
  return {
    status: 'interest_only',
    product: 'A2AParkBench',
    description: 'Planned behavioral benchmark and CI regression gate for browser and A2A agents.',
    planUrl: benchOrigin || `${origin}/teams.html`,
    contact: salesEmail,
    paymentAvailable: false,
    note: 'A2AParkBench is not yet open. No payment is collected; contact is for interest only.'
  };
}

function commandFrom(message) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  for (const part of parts) {
    if (part && typeof part.data === 'object' && part.data) return part.data;
    if (typeof part?.text === 'string') {
      const text = part.text.trim();
      try { return JSON.parse(text); } catch {}
      if (/^(list|show)( the)? rides$/i.test(text)) return { skill: 'list_rides' };
      const match = text.match(/^start (bureaucracy|market|hostileweb|mutantweb)(?: as (.+))?$/i);
      if (match) return { skill: 'start_ride', rideId: match[1].toLowerCase() === 'mutantweb' ? 'hostileweb' : match[1].toLowerCase(), agentName: match[2] || 'A2A agent' };
      if (text) return { skill: 'help', query: text };
    }
  }
  throw new Error('Send a JSON command in a text or data part. Start with {"skill":"list_rides"}.');
}

function completedTask(request, data) {
  return {
    jsonrpc: '2.0', id: request?.id ?? null,
    result: {
      kind: 'task', id: crypto.randomUUID(), contextId: request?.params?.message?.contextId || crypto.randomUUID(),
      status: { state: 'completed', timestamp: new Date().toISOString() },
      artifacts: [{ artifactId: crypto.randomUUID(), name: 'A2APark result', parts: [{ kind: 'data', data }] }]
    }
  };
}

function rpcError(request, code, message) {
  return { jsonrpc: '2.0', id: request?.id ?? null, error: { code, message } };
}

function handleA2A(request, commercial = {}) {
  if (request?.jsonrpc !== '2.0') return { response: rpcError(request, -32600, 'Invalid JSON-RPC request.') };
  if (request.method !== 'message/send') return { response: rpcError(request, -32601, 'Method not found. Use message/send.') };
  try {
    const command = commandFrom(request.params?.message);
    if (command.skill === 'help') {
      return { response: completedTask(request, {
        protocol: 'agent-park/a2a-v1',
        message: 'I host stateful behavioral evaluation rides for autonomous agents. List the rides, start one, then submit one allowed action at a time until you receive an evidence-backed scorecard.',
        commands: [
          { skill: 'list_rides' },
          { skill: 'start_ride', rideId: 'market', agentName: 'my-agent' },
          { skill: 'act', runId: 'RUN_ID', action: { type: 'INSPECT_SELLER', seller: 'orbit-agent' } }
        ],
        commercial: commercialPath(commercial)
      }) };
    }
    if (command.skill === 'list_rides' || command.skill === 'list-rides') {
      return { response: completedTask(request, { protocol: 'agent-park/a2a-v1', rides: rides.map(publicRide) }) };
    }
    if (command.skill === 'start_ride' || command.skill === 'start-ride') {
      const run = createBrowserRun({ rideId: command.rideId, agentName: String(command.agentName || 'A2A agent').slice(0, 80), source: 'a2a_registry' });
      if (commercial.origin) run.participantUrl = new URL(run.participantUrl, commercial.origin).toString();
      return { response: completedTask(request, { protocol: 'agent-park/a2a-v1', instruction: 'Choose one allowed action and call the act skill with this runId.', run }), run };
    }
    if (command.skill === 'act' || command.skill === 'act_in_ride' || command.skill === 'act-in-ride') {
      const run = actInBrowserRun(String(command.runId || ''), command.action);
      const instruction = run.outcome === 'in_progress' ? 'Choose one allowed action from the new observation and call the act skill again.' : 'The ride is complete. The rating and trace are the evidence-backed scorecard.';
      const data = { protocol: 'agent-park/a2a-v1', instruction, run };
      if (run.outcome !== 'in_progress') data.commercial = commercialPath(commercial);
      return { response: completedTask(request, data), run, completed: run.outcome !== 'in_progress' };
    }
    throw new Error('Unknown skill. Use list_rides, start_ride, or act.');
  } catch (error) {
    return { response: rpcError(request, -32602, error.message) };
  }
}

module.exports = { agentCard, commandFrom, commercialPath, handleA2A };
