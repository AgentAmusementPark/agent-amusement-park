const fs = require('node:fs');
const path = require('node:path');

const ENVIRONMENTS = new Set(['production', 'development', 'test']);
const EVENT_FIELDS = ['event_id', 'run_id', 'completed_at', 'ride_id', 'ride_version', 'completion_status', 'result_status', 'environment'];
const PRODUCTION_MOUNT = '/var/data/a2apark';

class CompletionLedgerError extends Error {
  constructor(cause) {
    super('Completion ledger is unavailable; ride completion was not acknowledged.');
    this.name = 'CompletionLedgerError';
    this.code = 'COMPLETION_LEDGER_UNAVAILABLE';
    this.cause = cause;
  }
}

function validateEvent(event, expectedEnvironment) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw new Error('Completion record is not an object.');
  if (Object.keys(event).sort().join(',') !== [...EVENT_FIELDS].sort().join(',')) throw new Error('Completion record fields are invalid.');
  for (const field of EVENT_FIELDS) if (typeof event[field] !== 'string' || !event[field]) throw new Error(`Completion record ${field} is invalid.`);
  if (event.event_id !== `completion:${event.run_id}`) throw new Error('Completion event ID does not match its run ID.');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.completed_at)) throw new Error('Completion timestamp is not UTC ISO-8601.');
  if (event.completion_status !== 'completed' || !['passed', 'failed'].includes(event.result_status)) throw new Error('Completion status is invalid.');
  if (!ENVIRONMENTS.has(event.environment) || event.environment !== expectedEnvironment) throw new Error('Completion environment does not match this ledger.');
  return event;
}

function completionEvent(run, environment, now = () => new Date()) {
  if (!run?.runId || !run?.ride?.id || !run?.ride?.version) throw new Error('Completed run is missing its stable ID or executed ride version.');
  if (!['passed', 'failed'].includes(run.outcome)) throw new Error('Only completed runs can enter the completion ledger.');
  return validateEvent({
    event_id: `completion:${run.runId}`,
    run_id: run.runId,
    completed_at: now().toISOString(),
    ride_id: run.ride.id,
    ride_version: run.ride.version,
    completion_status: 'completed',
    result_status: run.outcome,
    environment
  }, environment);
}

function writeFully(fd, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const written = fs.writeSync(fd, buffer, offset, buffer.length - offset);
    if (!written) throw new Error('Completion ledger write made no progress.');
    offset += written;
  }
}

function fsyncFile(file, flags, content) {
  const fd = fs.openSync(file, flags, 0o600);
  try {
    if (content) writeFully(fd, Buffer.from(content, 'utf8'));
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
}

function mountIsPresent(mountPath) {
  if (process.platform !== 'linux') return false;
  const lines = fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
  return lines.some(line => {
    const fields = line.split(' ');
    return fields.length > 5 && fields[4].replace(/\\040/g, ' ') === mountPath;
  });
}

class CompletionLedger {
  constructor({ ledgerPath = '', environment = '', requirePersistentMount = environment === 'production', now } = {}) {
    this.ledgerPath = String(ledgerPath || '');
    this.pendingPath = this.ledgerPath ? `${this.ledgerPath}.pending` : '';
    this.environment = String(environment || '');
    this.requirePersistentMount = requirePersistentMount;
    this.now = now || (() => new Date());
    this.eventIds = new Set();
    this.eventsById = new Map();
    this.initialized = false;
    this.unhealthy = null;
    this.tail = Promise.resolve();
  }

  assertReady() {
    if (this.unhealthy) throw this.unhealthy;
    try {
      if (!this.initialized) this.initialize();
    } catch (cause) {
      this.unhealthy = cause instanceof CompletionLedgerError ? cause : new CompletionLedgerError(cause);
      throw this.unhealthy;
    }
  }

  initialize() {
    if (!ENVIRONMENTS.has(this.environment)) throw new Error('COMPLETION_ENVIRONMENT must be production, development, or test.');
    if (!this.ledgerPath || !path.isAbsolute(this.ledgerPath)) throw new Error('COMPLETION_LEDGER_PATH must be an absolute path.');
    const resolved = path.resolve(this.ledgerPath);
    const productionRoot = path.resolve(PRODUCTION_MOUNT);
    const insideProductionMount = resolved.startsWith(`${productionRoot}${path.sep}`);
    if (this.environment === 'production' && !insideProductionMount) throw new Error(`Production ledger must be beneath ${PRODUCTION_MOUNT}.`);
    if (this.environment !== 'production' && insideProductionMount) throw new Error('Development and test ledgers must not use the production mount.');
    if (this.requirePersistentMount && !mountIsPresent(PRODUCTION_MOUNT)) throw new Error(`Persistent mount ${PRODUCTION_MOUNT} is not attached.`);

    const directory = path.dirname(resolved);
    fs.mkdirSync(directory, { recursive: true });
    fs.accessSync(directory, fs.constants.R_OK | fs.constants.W_OK);
    if (!fs.existsSync(resolved)) fsyncFile(resolved, 'wx', '');

    let pending = null;
    if (fs.existsSync(this.pendingPath)) {
      const pendingText = fs.readFileSync(this.pendingPath, 'utf8');
      pending = validateEvent(JSON.parse(pendingText), this.environment);
    }

    let ledger = fs.readFileSync(resolved);
    if (ledger.length && ledger[ledger.length - 1] !== 0x0a) {
      if (!pending) throw new Error('Completion ledger has an incomplete trailing record without recovery state.');
      const lastNewline = ledger.lastIndexOf(0x0a);
      fs.truncateSync(resolved, lastNewline + 1);
      fsyncFile(resolved, 'r+', '');
      ledger = ledger.subarray(0, lastNewline + 1);
    }

    const text = ledger.toString('utf8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const event = validateEvent(JSON.parse(line), this.environment);
      const existing = this.eventsById.get(event.event_id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(event)) throw new Error('Completion ledger contains a conflicting event ID.');
      this.eventIds.add(event.event_id); this.eventsById.set(event.event_id, event);
    }

    if (pending) {
      const existing = this.eventsById.get(pending.event_id);
      if (existing && JSON.stringify(existing) !== JSON.stringify(pending)) throw new Error('Pending completion conflicts with the ledger.');
      if (!existing) this.append(pending);
      else fs.unlinkSync(this.pendingPath);
    }
    this.initialized = true;
  }

  append(event) {
    const line = `${JSON.stringify(event)}\n`;
    fsyncFile(this.pendingPath, 'w', line);
    fsyncFile(this.ledgerPath, 'a', line);
    this.eventIds.add(event.event_id); this.eventsById.set(event.event_id, event);
    fs.unlinkSync(this.pendingPath);
  }

  record(run) {
    const operation = this.tail.then(() => {
      this.assertReady();
      const event = completionEvent(run, this.environment, this.now);
      if (this.eventIds.has(event.event_id)) return { event: this.eventsById.get(event.event_id), deduplicated: true };
      try {
        this.append(event);
        return { event, deduplicated: false };
      } catch (cause) {
        this.unhealthy = new CompletionLedgerError(cause);
        throw this.unhealthy;
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}

module.exports = { CompletionLedger, CompletionLedgerError, completionEvent, validateEvent, PRODUCTION_MOUNT };
