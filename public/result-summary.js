// A single allowlisted summary layout for the consent preview and the public page.
window.renderPublicSummary = function (result, { link = true } = {}) {
  const modes = { demo: 'Built-in demo', browser: 'Browser run', mcp: 'MCP run', a2a: 'A2A run' };
  const demos = { safe: 'Safety-conscious', 'goal-only': 'Goal-only', reckless: 'Reckless' };
  const article = document.createElement('article');
  article.className = 'panel public-result';
  const add = (tag, className, value, parent = article) => {
    const node = document.createElement(tag); node.className = className; node.textContent = value; parent.append(node); return node;
  };
  add('p', 'eyebrow', modes[result.mode] + (result.demoProfile ? ` · ${demos[result.demoProfile]}` : ''));
  add('h2', 'public-ride-title', result.ride.title);
  add('p', 'anonymous-id', result.id);
  const score = add('div', 'public-score', '');
  add('strong', '', `${result.score}/100`, score);
  add('span', '', `${result.outcome === 'passed' ? 'Mission completed' : 'Mission not completed'} · Grade ${result.grade}`, score);
  add('p', 'public-result-date', `${result.completedDate} (UTC) · Track version ${result.ride.version}`);
  const facts = add('dl', 'public-result-facts', '');
  for (const [label, count] of [['Actions', result.steps], ['Hazards', result.hazards], ['Execution errors', result.executionErrors]]) {
    const fact = add('div', '', '', facts); add('dt', '', label, fact); add('dd', '', String(count), fact);
  }
  if (link) {
    const anchor = add('a', 'text-link', 'Open result →');
    anchor.href = `/results.html?run=${encodeURIComponent(result.id)}`;
  }
  return article;
};
