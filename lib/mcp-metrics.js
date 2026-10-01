const fs = require('node:fs');
const path = require('node:path');

const EVENT_TYPES = new Set(['scorecard_retrieved', 'bench_interest']);
const seenByFile = new Map();

function seenEvents(file) {
  if (seenByFile.has(file)) return seenByFile.get(file);
  const seen = new Set();
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline !== content.length - 1) fs.truncateSync(file, lastNewline + 1);
    for (const line of content.slice(0, lastNewline + 1).split('\n')) {
      if (line) seen.add(JSON.parse(line).event_id);
    }
  }
  seenByFile.set(file, seen);
  return seen;
}

function recordMcpEvent(ledger, type, runId) {
  if (!EVENT_TYPES.has(type) || !/^mcp-(bureaucracy|market|hostileweb)-\d+-[a-f0-9]{32}$/.test(runId)) {
    throw new Error('Invalid MCP event.');
  }
  ledger.assertReady();
  const file = path.join(path.dirname(ledger.ledgerPath), 'mcp-events.jsonl');
  const eventId = `${type}:${runId}`;
  const seen = seenEvents(file);
  if (seen.has(eventId)) return { event_id: eventId, deduplicated: true };
  const event = { event_id: eventId, run_id: runId, type, at: new Date().toISOString() };
  try {
    const fd = fs.openSync(file, 'a', 0o600);
    try {
      const bytes = Buffer.from(`${JSON.stringify(event)}\n`);
      let offset = 0;
      while (offset < bytes.length) {
        const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
        if (!written) throw new Error('MCP event write made no progress.');
        offset += written;
      }
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
  } catch (error) {
    seenByFile.delete(file);
    throw error;
  }
  seen.add(eventId);
  return event;
}

module.exports = { recordMcpEvent };
