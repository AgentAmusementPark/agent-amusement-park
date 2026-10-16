const state = { rides: [], selected: null, latestRun: null, config: null };
const $ = selector => document.querySelector(selector);
const builtinLabels = { safe: 'Safety-conscious', 'goal-only': 'Goal-only', reckless: 'Reckless' };
function actorSummary(result) {
  if (result?.actor?.kind === 'park-demo') return `Built-in ${builtinLabels[result.agent.id] || result.actor.alias}`;
  if (result?.actor?.kind === 'external-operator' || result?.actor?.kind === 'human-operator') return 'Anonymous agent';
  return result?.actor?.alias || result.agent?.id || 'external operator';
}

function selectedAgent() { return document.querySelector('input[name="agent"]:checked')?.value || ''; }

function rideAttribution() {
  if (location.hostname !== 'a2apark.com') return {};
  const params = new URLSearchParams(location.search);
  let referringDomain = null;
  try {
    if (document.referrer) {
      const labels = new URL(document.referrer).hostname.toLowerCase().split('.');
      const suffix = labels.slice(-2).join('.');
      const twoPart = ['co.uk', 'org.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.br', 'co.jp'].includes(suffix);
      if (labels.length >= (twoPart ? 3 : 2)) referringDomain = labels.slice(twoPart ? -3 : -2).join('.');
    }
  } catch {}
  let internal = params.has('internal') || params.get('analytics_test') === '1';
  try { internal ||= localStorage.getItem('a2apark_analytics_internal') === '1'; } catch {}
  const source = (params.get('utm_source') || params.get('source') || params.get('ref') || '').toLowerCase();
  const campaignSource = ['github', 'smithery', 'mcp_registry', 'reddit', 'chatgpt', 'claude', 'newsletter'].includes(source) ? source : null;
  return { referringDomain, campaignSource, internal };
}

function updateAgentUi() {
  const selection = selectedAgent();
  $('#adapter-field').hidden = selection !== 'external';
  const button = $('#run');
  button.disabled = !selection;
  const summary = $('#agent-mode-summary');
  if (summary) {
    summary.textContent = selection === 'browser'
      ? 'Browser access selected. Start the run, then give the page link to your agent.'
      : selection === 'external'
        ? 'You selected external adapter mode. Provide an adapter URL, then run the selected track.'
        : selection
          ? `Built-in ${builtinLabels[selection] || selection} demo selected. Run it to see this demonstration agent’s result.`
          : 'Choose browser access or a demo to start.';
  }
  const label = selection === 'browser'
    ? 'Start browser run'
    : selection === 'external'
      ? 'Run external agent'
      : selection
        ? 'Run demo agent'
        : 'Choose access or a demo';
  button.innerHTML = `${label} <span>→</span>`;
}

async function loadRides() {
  const response = await fetch('/api/rides'); state.rides = await response.json();
  const requestedRide = new URLSearchParams(location.search).get('ride');
  state.selected = state.rides.some(ride => ride.id === requestedRide) ? requestedRide : state.rides[0]?.id;
  const trackCopy = {
    bureaucracy: { purpose: 'Get a permit while instructions conflict.', behavior: 'Current rules · waiting · data handling' },
    market: { purpose: 'Buy a verified battery within a fixed budget.', behavior: 'Verification · negotiation · safe payment' },
    hostileweb: { purpose: 'Submit a refund request through a deceptive interface.', behavior: 'Changing controls · distractions · permissions' }
  };
  const trackNumbers = { bureaucracy: '01', market: '02', hostileweb: '03' };
  $('#rides').innerHTML = state.rides.map((ride, index) => {
    const number = trackNumbers[ride.id] || String(index + 1).padStart(2, '0');
    const selected = ride.id === state.selected;
    const copy = trackCopy[ride.id];
    return `
    <button type="button" class="ride scenario-panel scenario-${ride.id} ${selected ? 'selected' : ''}" data-id="${ride.id}" aria-pressed="${selected}">
      <span class="scenario-top"><span class="track-id">TRACK / ${number}</span><span class="selection-state">${selected ? 'SELECTED' : 'SELECT'}</span></span>
      <strong class="ride-name">${escapeHtml(ride.title)}</strong>
      <span class="ride-summary">${escapeHtml(copy.purpose)}</span>
      <span class="scenario-behavior"><span class="meta-label">TESTS</span>${escapeHtml(copy.behavior)}</span>
      <span class="scenario-access"><span class="meta-label">ACCESS</span>Browser · MCP · A2A</span>
      <span class="scenario-foot"><span>Up to ${ride.maxSteps} actions</span><span aria-hidden="true">→</span></span>
    </button>`;
  }).join('');
  document.querySelectorAll('.ride').forEach(button => button.addEventListener('click', () => {
    state.selected = button.dataset.id; document.querySelectorAll('.ride').forEach(item => {
      const selected = item === button;
      item.classList.toggle('selected', selected); item.setAttribute('aria-pressed', String(selected));
      item.querySelector('.selection-state').textContent = selected ? 'SELECTED' : 'SELECT';
    });
  }));
}

async function loadConfig() {
  const response = await fetch('/api/config'); state.config = await response.json();
  const externalOption = $('#external-option');
  externalOption.hidden = !state.config.externalAdaptersEnabled;
  if (!state.config.externalAdaptersEnabled && document.querySelector('input[name="agent"]:checked')?.value === 'external') {
    document.querySelector('input[name="agent"][value="external"]').checked = false;
  }
  updateAgentUi();
}

document.querySelectorAll('input[name="agent"]').forEach(input => input.addEventListener('change', updateAgentUi));

$('#run').addEventListener('click', async () => {
  const button = $('#run'); const selection = selectedAgent();
  if (!selection) return updateAgentUi();
  if (selection === 'external' && !state.config?.externalAdaptersEnabled) {
    $('#error').textContent = 'External adapters are not available on this deployment.';
    return;
  }
  if (selection === 'browser') {
    button.disabled = true; button.innerHTML = 'Starting your run… <span>↻</span>'; $('#error').textContent = '';
    try {
      const response = await fetch('/api/browser-runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, attribution:rideAttribution() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not start the browser run');
      location.href = result.participantUrl;
    } catch (error) { $('#error').textContent = error.message; updateAgentUi(); }
    return;
  }
  const agent = selection === 'external' ? { type: 'external', url: $('#adapter-url').value } : { type: 'builtin', id: selection };
  button.disabled = true; button.innerHTML = 'Scenario running… <span>↻</span>'; $('#error').textContent = '';
  try {
    const response = await fetch('/api/runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, agent, attribution:rideAttribution() }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Run failed'); renderResult(result);
  } catch (error) { $('#error').textContent = error.message; }
  finally { updateAgentUi(); }
});

function renderResult(result) {
  state.latestRun = result;
  showPublication(result.publication);
  const isDemo = result.agent.type === 'builtin';
  const isExternalAgent = result.agent.type === 'external';
  const actorLabel = actorSummary(result);
  $('#result-heading').textContent = isDemo ? 'Demo scorecard' : 'Run scorecard';
  $('#result-context').textContent = isDemo
    ? `Built-in ${builtinLabels[result.agent.id] || result.agent.id} demo. This is the demo agent’s score.`
    : isExternalAgent
      ? `This score belongs to ${actorLabel} and this run.`
      : `This score belongs to ${actorLabel}.`;
  $('#result').hidden = false; $('#score').textContent = result.rating.score; $('#score-ring').style.borderColor = result.rating.score >= 80 ? 'var(--green)' : result.rating.score >= 60 ? 'var(--yellow)' : 'var(--red)';
  $('#verdict').textContent = `${result.outcome.toUpperCase()} · GRADE ${result.rating.grade}`;
  $('#result-title').textContent = result.ride.title; $('#result-meta').textContent = actorLabel;
  const scoredRules = result.rating.rules.map(rule => ({...rule, displayPoints:`${rule.points}/${rule.max}`}));
  const adjustments = (result.rating.adjustments || []).map(rule => ({...rule, displayPoints:rule.points ? `${rule.points}` : '0'}));
  $('#rules').innerHTML = [...scoredRules, ...adjustments].map(rule => `<article class="rule ${rule.status}"><div class="rule-top"><strong>${escapeHtml(rule.label)}</strong><strong>${rule.displayPoints}</strong></div><p>${escapeHtml(rule.detail)} ${rule.evidence.length ? `Evidence: step ${rule.evidence.join(', ')}` : ''}</p></article>`).join('');
  $('#trace-count').textContent = `(${result.trace.length} steps)`;
  $('#trace').innerHTML = result.trace.map(entry => `<article class="trace-step"><div class="step-no">${String(entry.step).padStart(2,'0')}</div><div class="action">${escapeHtml(JSON.stringify(entry.action))}</div><div class="events">${entry.events.map(event => `<p class="event ${event.type}"><strong>${event.type.toUpperCase()}</strong> ${escapeHtml(event.message)}</p>`).join('')}</div></article>`).join('');
  $('#final-state').textContent = JSON.stringify(result.finalState, null, 2);
  $('#result').scrollIntoView({ behavior:'smooth', block:'start' }); $('#result').focus({ preventScroll:true });
}

$('#share-result').addEventListener('click', async () => {
  if (!state.latestRun) return;
  const button = $('#share-result'); button.disabled = true; button.textContent = 'Creating scorecard from this run…';
  try {
    const response = await fetch('/api/shares', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({runId:state.latestRun.runId}) });
    const share = await response.json(); if (!response.ok) throw new Error(share.error || 'Could not create scorecard.');
    location.href = share.url || share.path;
  } catch (error) { $('#error').textContent = error.message; button.disabled = false; button.innerHTML = 'View shareable scorecard <span>↗</span>'; }
});

function returnToLauncher({ useOwnAgent = false } = {}) {
  state.latestRun = null; $('#result').hidden = true;
  document.querySelectorAll('input[name="agent"]').forEach(input => { input.checked = useOwnAgent && input.value === 'browser'; });
  updateAgentUi(); $('#rides-start').scrollIntoView({ behavior:'smooth', block:'start' }); $('#rides-start').focus({ preventScroll:true });
}

$('#take-another-ride').addEventListener('click', () => returnToLauncher());
$('#test-own-agent').addEventListener('click', () => returnToLauncher({ useOwnAgent:true }));

function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
Promise.all([loadRides(), loadConfig()]).catch(error => { $('#error').textContent = error.message; });

function showPublication(publication) {
  const link = $('#publish-result');
  link.hidden = !publication?.url;
  if (publication?.url) link.href = publication.url;
  $('#publication-note').textContent = publication?.url ? 'Optional. Nothing is posted until you give permission.' : publication?.note || '';
}
