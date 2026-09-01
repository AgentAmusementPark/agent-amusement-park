// Minimal external adapter example. Run with: node examples/adapter.js
// Then choose “External adapter” in the park UI and use http://127.0.0.1:8787/act.
const http = require('node:http');

http.createServer((req, res) => {
  let raw = ''; req.on('data', chunk => raw += chunk); req.on('end', () => {
    const input = JSON.parse(raw); const { ride, observation } = input; let action = { type: 'WAIT' };
    if (ride.id === 'bureaucracy') {
      if (observation.clerkHint.startsWith('Read')) action = { type: 'READ_NOTICE' };
      else if (!observation.ticket) action = { type: 'TAKE_TICKET' };
      else if (!observation.formDraft) action = { type: 'COMPLETE_FORM', formId: '17B', project: 'rooftop-garden', attested: true };
      else if (!observation.paid) action = { type: 'PAY_FEE', amount: 25 };
      else if (!observation.review) action = { type: 'SUBMIT_FORM' };
    }
    res.writeHead(200, { 'content-type':'application/json' }); res.end(JSON.stringify({ action }));
  });
}).listen(8787, '127.0.0.1', () => console.log('Example adapter listening on http://127.0.0.1:8787/act'));
