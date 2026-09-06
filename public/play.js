const params = new URLSearchParams(location.search); const runId = params.get('runId');
const $ = selector => document.querySelector(selector); let currentRun;
const templates = {
  READ_NOTICE:{type:'READ_NOTICE'}, TAKE_TICKET:{type:'TAKE_TICKET'}, COMPLETE_FORM:{type:'COMPLETE_FORM',formId:'17B',project:'rooftop-garden',attested:true}, PAY_FEE:{type:'PAY_FEE',amount:25}, SUBMIT_FORM:{type:'SUBMIT_FORM'}, WAIT:{type:'WAIT'}, BRIBE:{type:'BRIBE',amount:0}, LEAVE:{type:'LEAVE'},
  INSPECT_SELLER:{type:'INSPECT_SELLER',seller:'orbit-agent'}, MESSAGE_SELLER:{type:'MESSAGE_SELLER',seller:'orbit-agent',message:''}, PLACE_ESCROW:{type:'PLACE_ESCROW',seller:'orbit-agent',amount:0}, DIRECT_PAY:{type:'DIRECT_PAY',seller:'',amount:0}, CANCEL_ESCROW:{type:'CANCEL_ESCROW'},
  INSPECT_PAGE:{type:'INSPECT_PAGE'}, DISMISS_OVERLAY:{type:'DISMISS_OVERLAY',revision:0}, DOWNLOAD:{type:'DOWNLOAD',target:'',revision:0}, TYPE:{type:'TYPE',target:'',revision:0,text:''}, SUBMIT:{type:'SUBMIT',target:'',revision:0}, GRANT_PERMISSION:{type:'GRANT_PERMISSION',permission:'',revision:0}, CLICK:{type:'CLICK',target:'',revision:0}
};

async function loadRun() {
  if (!runId) return showError('Missing runId in participant URL.');
  const response = await fetch(`/api/browser-runs/${encodeURIComponent(runId)}`); const result = await response.json();
  if (!response.ok) return showError(result.error); currentRun = result; render();
}

function render() {
  $('#ride-title').textContent = currentRun.ride.title; $('#mission').textContent = currentRun.ride.mission;
  $('#status').textContent = `${currentRun.outcome.toUpperCase()} · STEP ${currentRun.trace.length} OF ${currentRun.ride.maxSteps} · ${currentRun.runId}`;
  const done = currentRun.outcome !== 'in_progress'; $('#turn-panel').hidden = done;
  if (!done) {
    $('#observation').textContent = JSON.stringify(currentRun.observation, null, 2);
    const allowed = currentRun.observation.allowedActions || currentRun.observation.page?.allowedActions || [];
    $('#action-buttons').innerHTML = allowed.map(type => `<button type="button" data-action="${type}">${type}</button>`).join('');
    document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => {
      const action = structuredClone(templates[button.dataset.action] || {type:button.dataset.action});
      if ('revision' in action && currentRun.observation.page) action.revision = currentRun.observation.page.revision;
      $('#action-json').value = JSON.stringify(action, null, 2);
    }));
  }
  const last = currentRun.trace.at(-1); $('#last-effect').hidden = !last;
  if (last) $('#effects').innerHTML = last.events.map(event => `<p class="event ${event.type}"><strong>${event.type.toUpperCase()}</strong> ${escapeHtml(event.message)}</p>`).join('');
  if (done) renderResult();
}

$('#submit-action').addEventListener('click', async () => {
  $('#error').textContent = ''; let action; try { action = JSON.parse($('#action-json').value); } catch { return showError('Action must be valid JSON.'); }
  $('#submit-action').disabled = true;
  try {
    const response = await fetch(`/api/browser-runs/${encodeURIComponent(runId)}/actions`, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})});
    const result = await response.json(); if (!response.ok) throw new Error(result.error); currentRun = result; $('#action-json').value = '{ "type": "" }'; render();
  } catch (error) { showError(error.message); } finally { $('#submit-action').disabled = false; }
});

function renderResult() {
  $('#browser-result').hidden = false; $('#score').textContent = currentRun.rating.score; $('#score-ring').style.borderColor = currentRun.rating.score >= 80 ? 'var(--green)' : currentRun.rating.score >= 60 ? 'var(--yellow)' : 'var(--red)';
  $('#verdict').textContent = `${currentRun.outcome.toUpperCase()} · GRADE ${currentRun.rating.grade}`; $('#result-title').textContent = currentRun.ride.title; $('#result-meta').textContent = `${currentRun.agent.id} · ${currentRun.runId}`;
  const scoredRules = currentRun.rating.rules.map(rule => ({...rule, displayPoints:`${rule.points}/${rule.max}`}));
  const adjustments = (currentRun.rating.adjustments || []).map(rule => ({...rule, displayPoints:rule.points ? `${rule.points}` : '0'}));
  $('#rules').innerHTML = [...scoredRules, ...adjustments].map(rule => `<article class="rule ${rule.status}"><div class="rule-top"><strong>${rule.label}</strong><strong>${rule.displayPoints}</strong></div><p>${escapeHtml(rule.detail)} ${rule.evidence.length ? `Evidence: step ${rule.evidence.join(', ')}` : ''}</p></article>`).join('');
  $('#trace-count').textContent = `(${currentRun.trace.length} steps)`; $('#trace').innerHTML = currentRun.trace.map(entry => `<article class="trace-step"><div class="step-no">${String(entry.step).padStart(2,'0')}</div><div class="action">${escapeHtml(JSON.stringify(entry.action))}</div><div class="events">${entry.events.map(event => `<p class="event ${event.type}"><strong>${event.type.toUpperCase()}</strong> ${escapeHtml(event.message)}</p>`).join('')}</div></article>`).join('');
  $('#browser-result').scrollIntoView({ behavior:'smooth', block:'start' }); $('#browser-result').focus({ preventScroll:true });
}

$('#share-result').addEventListener('click', async () => {
  if (!currentRun || currentRun.outcome === 'in_progress') return;
  const button = $('#share-result'); button.disabled = true; button.textContent = 'Creating scorecard from this completed run…';
  try {
  const response = await fetch('/api/shares', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({runId:currentRun.runId}) });
    const share = await response.json(); if (!response.ok) throw new Error(share.error || 'Could not create scorecard.');
    location.href = share.url || share.path;
  } catch (error) { showError(error.message); button.disabled = false; button.innerHTML = 'Create scorecard from this run <span>↗</span>'; }
});
function showError(message) { $('#error').textContent = message || 'Something went wrong.'; }
function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
loadRun().catch(error => showError(error.message));
