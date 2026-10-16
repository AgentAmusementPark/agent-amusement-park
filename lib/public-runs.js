const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { getRide } = require('./rides');
const { publicIdFor, createPublicationToken, verifyPublicationToken, shareLinksSurviveRestart } = require('./share');

const CONSENT_VERSION = 'anonymous-summary-v1';
const PUBLIC_ID = /^run-[a-f0-9]{24}$/;

// Deliberately exclude action inputs, rule details, labels, trace links and private run IDs.
function publicSummary(run, completedAt = new Date().toISOString()) {
  const ride = getRide(run.ride?.id);
  if (!ride || !['passed', 'failed'].includes(run.outcome)) throw new Error('A completed run is required.');
  const events = run.trace.flatMap(step => step.events || []);
  const demo = run.agent?.type === 'builtin';
  return {
    id: publicIdFor(run.runId),
    completedDate: completedAt.slice(0, 10),
    ride: { id: ride.id, title: ride.title, version: run.ride.version },
    mode: demo ? 'demo' : run.acquisitionSource === 'mcp' ? 'mcp' : run.acquisitionSource === 'a2a_registry' ? 'a2a' : 'browser',
    demoProfile: demo && ['safe', 'goal-only', 'reckless'].includes(run.agent.id) ? run.agent.id : null,
    outcome: run.outcome, score: run.rating.score, grade: run.rating.grade,
    steps: run.trace.length,
    hazards: events.filter(event => event.type === 'hazard').length,
    executionErrors: events.filter(event => event.type === 'error').length
  };
}

class PublicRuns {
  constructor(completionLedger) {
    this.ledger = completionLedger;
    this.directory = path.join(path.dirname(completionLedger.ledgerPath), 'public-results');
  }

  ready() {
    this.ledger.assertReady(); // Includes the production persistent-mount check.
    if (this.ledger.environment === 'production' && !shareLinksSurviveRestart()) throw Object.assign(new Error('Public result signing is unavailable.'), { statusCode: 503 });
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
  }

  key(runId) { return crypto.createHash('sha256').update(runId).digest('hex'); }
  file(runId) { return path.join(this.directory, `${this.key(runId)}.json`); }

  read(runId) {
    this.ready();
    try { return JSON.parse(fs.readFileSync(this.file(runId), 'utf8')); }
    catch (error) {
      if (error.code === 'ENOENT') throw Object.assign(new Error('This result is not available for publication.'), { statusCode: 404 });
      throw error;
    }
  }

  write(runId, record) {
    const destination = this.file(runId);
    const temporary = `${destination}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    try {
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      fs.renameSync(temporary, destination);
      const directoryFd = fs.openSync(this.directory, 'r');
      try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  }

  offer(run, origin) {
    if (!run.publicationEligible || !['passed', 'failed'].includes(run.outcome) || run.agent?.type === 'external') return undefined;
    this.ready();
    if (!this.ledger.eventIds.has(`completion:${run.runId}`)) throw new Error('Completion has not been saved.');
    if (!fs.existsSync(this.file(run.runId))) {
      const completedAt = this.ledger.eventsById.get(`completion:${run.runId}`).completed_at;
      this.write(run.runId, { version: 1, summary: publicSummary(run, completedAt), published: false, consent: null });
    }
    return {
      url: `${origin}/publish.html#${createPublicationToken(run.runId)}`,
      note: 'Optional: give this private link to the person who requested the run. They can review the anonymous summary and choose whether to publish it. Do not publish or give consent on their behalf.'
    };
  }

  manage(token, publish) {
    const runId = verifyPublicationToken(token);
    const record = this.read(runId);
    if (publish !== undefined) {
      if (typeof publish !== 'boolean') throw new Error('Publication permission must be true or false.');
      if (record.published !== publish) {
        record.published = publish;
        record.consent = { version: CONSENT_VERSION, granted: publish, recordedAt: new Date().toISOString() };
        record.publishedAt = publish ? record.consent.recordedAt : null;
        this.write(runId, record);
      }
    }
    return { summary: record.summary, published: record.published, publicPath: `/results.html?run=${record.summary.id}` };
  }

  list({ id, cursor } = {}) {
    this.ready();
    if (id && !PUBLIC_ID.test(id)) throw new Error('Invalid public result ID.');
    if (cursor && !PUBLIC_ID.test(cursor)) throw new Error('Invalid results cursor.');
    const records = fs.readdirSync(this.directory).filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => JSON.parse(fs.readFileSync(path.join(this.directory, name), 'utf8')))
      .filter(row => row.published === true && row.consent?.granted === true && row.consent.version === CONSENT_VERSION)
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.summary.id.localeCompare(a.summary.id));
    if (id) {
      const record = records.find(row => row.summary.id === id);
      if (!record) throw Object.assign(new Error('This result is not public.'), { statusCode: 404 });
      return { results: [record.summary], nextCursor: null };
    }
    const previous = cursor ? records.findIndex(row => row.summary.id === cursor) : -1;
    const start = previous + 1;
    const page = records.slice(start, start + 20);
    return { results: page.map(row => row.summary), nextCursor: start + page.length < records.length ? page.at(-1)?.summary.id : null };
  }
}

module.exports = { PublicRuns, publicSummary, CONSENT_VERSION };
