const state = { rides: [], selected: null, latestRun: null, config: null };
const $ = selector => document.querySelector(selector);
const builtinLabels = { safe: 'Safety-conscious', 'goal-only': 'Goal-only', reckless: 'Reckless' };

function selectedAgent() { return document.querySelector('input[name="agent"]:checked')?.value || ''; }

function updateAgentUi() {
  const selection = selectedAgent();
  $('#adapter-field').hidden = selection !== 'external';
  $('#browser-field').hidden = selection !== 'browser';
  const button = $('#run');
  button.disabled = !selection;
  const label = selection === 'browser' ? 'Start browser-agent ride' : selection === 'external' ? 'Run external agent' : selection ? 'Run demo agent' : 'Choose an agent mode';
  button.innerHTML = `${label} <span>→</span>`;
}

async function loadRides() {
  const response = await fetch('/api/rides'); state.rides = await response.json();
  const requestedRide = new URLSearchParams(location.search).get('ride');
  state.selected = state.rides.some(ride => ride.id === requestedRide) ? requestedRide : state.rides[0]?.id;
  $('#rides').innerHTML = state.rides.map((ride, index) => `
    <button class="ride ${ride.id === state.selected ? 'selected' : ''}" data-id="${ride.id}">
      <div class="stripe"></div><div class="ride-body"><p class="kind">${ride.kind}</p><h3>${ride.title}</h3><p>${ride.summary}</p><p class="mission"><strong>Mission</strong> ${ride.mission}</p></div>
    </button>`).join('');
  document.querySelectorAll('.ride').forEach(button => button.addEventListener('click', () => {
    state.selected = button.dataset.id; document.querySelectorAll('.ride').forEach(item => item.classList.toggle('selected', item === button));
  }));
  if (requestedRide && new URLSearchParams(location.search).get('challenge') === '1') {
    document.querySelector('input[name="agent"][value="browser"]').checked = true;
    updateAgentUi();
    $('#rides-start').scrollIntoView({ block: 'start' });
  }
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
    button.disabled = true; button.innerHTML = 'Opening the agent entrance… <span>↻</span>'; $('#error').textContent = '';
    try {
      const response = await fetch('/api/browser-runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, agentName:$('#browser-agent-name').value || 'Codex browser agent' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not create browser run');
      location.href = result.participantUrl;
    } catch (error) { $('#error').textContent = error.message; updateAgentUi(); }
    return;
  }
  const agent = selection === 'external' ? { type: 'external', url: $('#adapter-url').value } : { type: 'builtin', id: selection };
  button.disabled = true; button.innerHTML = 'Agent is on the ride… <span>↻</span>'; $('#error').textContent = '';
  try {
    const response = await fetch('/api/runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, agent }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Run failed'); renderResult(result);
  } catch (error) { $('#error').textContent = error.message; }
  finally { updateAgentUi(); }
});

function renderResult(result) {
  state.latestRun = result;
  const isDemo = result.agent.type === 'builtin';
  $('#result-heading').textContent = isDemo ? 'Completed demo run' : 'Completed run result';
  $('#result-context').textContent = isDemo ? `This score belongs to A2APark’s built-in ${builtinLabels[result.agent.id] || result.agent.id} demonstration agent. It is not a score for your own agent.` : 'This score belongs to the external agent run that just completed.';
  $('#result').hidden = false; $('#score').textContent = result.rating.score; $('#score-ring').style.borderColor = result.rating.score >= 80 ? 'var(--green)' : result.rating.score >= 60 ? 'var(--yellow)' : 'var(--red)';
  $('#verdict').textContent = `${result.outcome.toUpperCase()} · GRADE ${result.rating.grade}`;
  $('#result-title').textContent = result.ride.title; $('#result-meta').textContent = `${result.agent.id || 'external adapter'} · ${result.runId}`;
  const scoredRules = result.rating.rules.map(rule => ({...rule, displayPoints:`${rule.points}/${rule.max}`}));
  const adjustments = (result.rating.adjustments || []).map(rule => ({...rule, displayPoints:rule.points ? `${rule.points}` : '0'}));
  $('#rules').innerHTML = [...scoredRules, ...adjustments].map(rule => `<article class="rule ${rule.status}"><div class="rule-top"><strong>${rule.label}</strong><strong>${rule.displayPoints}</strong></div><p>${rule.detail} ${rule.evidence.length ? `Evidence: step ${rule.evidence.join(', ')}` : ''}</p></article>`).join('');
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
  } catch (error) { $('#error').textContent = error.message; button.disabled = false; button.innerHTML = 'Create scorecard from this run <span>↗</span>'; }
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
