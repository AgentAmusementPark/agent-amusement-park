const $ = selector => document.querySelector(selector);
const token = location.hash.slice(1);
let scorecard;
const builtinLabels = { safe: 'Safety-conscious', 'goal-only': 'Goal-only', reckless: 'Reckless' };

async function loadScorecard() {
  if (!token) throw new Error('The scorecard link is missing its signed result.');
  const response = await fetch('/api/shares/verify', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({token}) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Verification failed.');
  scorecard = body; render();
}

function render() {
  const run = scorecard.run; $('#scorecard').hidden = false;
  $('#scorecard-context').textContent = run.agent.type === 'builtin'
    ? `Built-in A2APark demonstration agent: ${builtinLabels[run.agent.id] || run.agent.id}. This demo score is not a score for your own agent.`
    : `Agent recorded for this completed run: ${run.agent.id}. This scorecard reflects a finished run and does not re-run the ride.`;
  $('#page-title').textContent = `${run.agent.id} scored ${run.rating.score}/100`;
  $('#verification').className = 'verification verified'; $('#verification').textContent = 'Verified by this A2APark deployment';
  $('#score').textContent = run.rating.score; $('#score-ring').style.borderColor = run.rating.score >= 80 ? 'var(--green)' : run.rating.score >= 60 ? 'var(--yellow)' : 'var(--red)';
  $('#verdict').textContent = `${run.outcome.toUpperCase()} · GRADE ${run.rating.grade}`; $('#ride-title').textContent = run.ride.title;
  $('#result-meta').textContent = `${run.agent.id} · ${new Date(run.createdAt).toLocaleDateString()} · ${run.id}`;
  $('#evidence-summary').innerHTML = `<span><strong>${run.evidence.steps}</strong> actions</span><span><strong>${run.evidence.hazards}</strong> hazards</span><span><strong>${run.evidence.executionErrors}</strong> execution errors</span>`;
  const scoredRules = run.rating.rules.map(rule => ({...rule, displayPoints:`${rule.points}/${rule.max}`}));
  const adjustments = (run.rating.adjustments || []).map(rule => ({...rule, displayPoints:rule.points ? `${rule.points}` : '0'}));
  $('#rules').innerHTML = [...scoredRules, ...adjustments].map(rule => `<article class="rule ${rule.status}"><div class="rule-top"><strong>${escapeHtml(rule.label)}</strong><strong>${rule.displayPoints}</strong></div><p>${escapeHtml(rule.detail)} ${rule.evidence.length ? `Evidence: step ${rule.evidence.join(', ')}` : ''}</p></article>`).join('');
  $('#trace-digest').textContent = run.evidence.traceSha256; $('#challenge-link').href = `/?ride=${encodeURIComponent(run.ride.id)}&challenge=1`;
}

$('#copy-link').addEventListener('click', async () => {
  await navigator.clipboard.writeText(location.href); $('#copy-link').textContent = 'Copied'; setTimeout(() => { $('#copy-link').innerHTML = 'Copy scorecard link <span>↗</span>'; }, 1800);
});
$('#download-json').addEventListener('click', () => {
  const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(scorecard, null, 2)], {type:'application/json'}));
  link.download = `agent-park-scorecard-${scorecard.run.id}.json`; link.click(); URL.revokeObjectURL(link.href);
});
function escapeHtml(text) { const node = document.createElement('span'); node.textContent = text; return node.innerHTML; }
loadScorecard().catch(error => { $('#page-title').textContent = 'Unverified scorecard'; $('#verification').hidden = true; $('#invalid').hidden = false; $('#invalid-message').textContent = error.message; });
