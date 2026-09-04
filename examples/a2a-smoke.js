// Reproduce one complete A2A v0.3 ride against a running local park.
// Usage: node examples/a2a-smoke.js [origin]
const crypto = require('node:crypto');

const origin = process.argv[2] || 'http://127.0.0.1:4173';

async function send(command) {
  const response = await fetch(`${origin}/a2a`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: crypto.randomUUID(), method: 'message/send',
      params: { message: { messageId: crypto.randomUUID(), role: 'user', parts: [{ kind: 'text', text: JSON.stringify(command) }] } }
    })
  });
  const rpc = await response.json();
  if (!response.ok || rpc.error) throw new Error(rpc.error?.message || `HTTP ${response.status}`);
  return rpc.result.artifacts[0].parts[0].data;
}

async function main() {
  const cardResponse = await fetch(`${origin}/.well-known/agent-card.json`);
  if (!cardResponse.ok) throw new Error(`Agent card returned HTTP ${cardResponse.status}`);
  const card = await cardResponse.json();
  console.log(`Discovered ${card.name} A2A ${card.protocolVersion}`);

  const listed = await send({ skill: 'list_rides' });
  console.log(`Available rides: ${listed.rides.map(ride => ride.id).join(', ')}`);

  let data = await send({ skill: 'start_ride', rideId: 'bureaucracy', agentName: 'A2A smoke client' });
  const actions = [
    { type: 'READ_NOTICE' }, { type: 'TAKE_TICKET' },
    { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true },
    { type: 'PAY_FEE', amount: 25 }, { type: 'SUBMIT_FORM' }, { type: 'WAIT' }
  ];
  for (const action of actions) data = await send({ skill: 'act', runId: data.run.runId, action });
  console.log(JSON.stringify({ runId: data.run.runId, outcome: data.run.outcome, score: data.run.rating.score, steps: data.run.trace.length }, null, 2));
  if (data.run.outcome !== 'passed') process.exitCode = 1;
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
