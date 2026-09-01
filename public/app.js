const state = { rides: [], selected: null, latestRun: null, config: null };
const $ = selector => document.querySelector(selector);

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
    $('#browser-field').hidden = false;
    recordEvent('challenge_started', { rideId: state.selected });
    $('#rides-start').scrollIntoView({ block: 'start' });
  }
}

async function loadConfig() {
  const response = await fetch('/api/config'); state.config = await response.json();
  if (!state.config.externalAdaptersEnabled) $('#external-option').hidden = true;
}

document.querySelectorAll('input[name="agent"]').forEach(input => input.addEventListener('change', () => {
  $('#adapter-field').hidden = input.value !== 'external'; $('#browser-field').hidden = input.value !== 'browser';
}));

$('#run').addEventListener('click', async () => {
  const button = $('#run'); const selectedAgent = document.querySelector('input[name="agent"]:checked').value;
  if (selectedAgent === 'browser') {
    button.disabled = true; button.innerHTML = 'Opening the agent entrance… <span>↻</span>'; $('#error').textContent = '';
    try {
      const response = await fetch('/api/browser-runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, agentName:$('#browser-agent-name').value || 'Codex browser agent' }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Could not create browser run');
      location.href = result.participantUrl;
    } catch (error) { $('#error').textContent = error.message; button.disabled = false; button.innerHTML = 'Run the agent <span>→</span>'; }
    return;
  }
  const agent = selectedAgent === 'external' ? { type: 'external', url: $('#adapter-url').value } : { type: 'builtin', id: selectedAgent };
  button.disabled = true; button.innerHTML = 'Agent is on the ride… <span>↻</span>'; $('#error').textContent = '';
  try {
    const response = await fetch('/api/runs', { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ rideId:state.selected, agent }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Run failed'); renderResult(result);
  } catch (error) { $('#error').textContent = error.message; }
  finally { button.disabled = false; button.innerHTML = 'Run the agent <span>→</span>'; }
});

function renderResult(result) {
  state.latestRun = result;
  $('#result').hidden = false; $('#score').textContent = result.rating.score; $('#score-ring').style.borderColor = result.rating.score >= 80 ? 'var(--green)' : result.rating.score >= 60 ? 'var(--yellow)' : 'var(--red)';
  $('#verdict').textContent = `${result.outcome.toUpperCase()} · GRADE ${result.rating.grade}`;
  $('#result-title').textContent = result.ride.title; $('#result-meta').textContent = `${result.agent.id || 'external adapter'} · ${result.runId}`;
  const scoredRules = result.rating.rules.map(rule => ({...rule, displayPoints:`${rule.points}/${rule.max}`}));
  const adjustments = (result.rating.adjustments || []).map(rule => ({...rule, displayPoints:rule.points ? `${rule.points}` : '0'}));
  $('#rules').innerHTML = [...scoredRules, ...adjustments].map(rule => `<article class="rule ${rule.status}"><div class="rule-top"><strong>${rule.label}</strong><strong>${rule.displayPoints}</strong></div><p>${rule.detail} ${rule.evidence.length ? `Evidence: step ${rule.evidence.join(', ')}` : ''}</p></article>`).join('');
  $('#trace-count').textContent = `(${result.trace.length} steps)`;
  $('#trace').innerHTML = result.trace.map(entry => `<article class="trace-step"><div class="step-no">${String(entry.step).padStart(2,'0')}</div><div class="action">${escapeHtml(JSON.stringify(entry.action))}</div><div class="events">${entry.events.map(event => `<p class="event ${event.type}"><strong>${event.type.toUpperCase()}</strong> ${escapeHtml(event.message)}</p>`).join('')}</div></article>`).join('');
  $('#final-state').textContent = JSON.stringify(result.finalState, null, 2); $('#result').scrollIntoView({ behavior:'smooth', block:'start' });
}

$('#share-result').addEventListener('click', async () => {
  if (!state.latestRun) return;
  const button = $('#share-result'); button.disabled = true; button.textContent = 'Creating scorecard…';
  try {
    const response = await fetch('/api/shares', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({runId:state.latestRun.runId}) });
    const share = await response.json(); if (!response.ok) throw new Error(share.error || 'Could not create scorecard.');
    location.href = share.path;
  } catch (error) { $('#error').textContent = error.message; button.disabled = false; button.innerHTML = 'Create verified scorecard <span>↗</span>'; }
});

function recordEvent(name, metadata = {}) { fetch('/api/events', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name, metadata}) }).catch(() => {}); }

function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
Promise.all([loadRides(), loadConfig()]).catch(error => { $('#error').textContent = error.message; });
