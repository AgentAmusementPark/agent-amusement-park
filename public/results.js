const resultList = document.querySelector('#public-results');
const resultStatus = document.querySelector('#results-status');
const moreButton = document.querySelector('#load-more');
const retryButton = document.querySelector('#retry-results');
const selectedResult = new URLSearchParams(location.search).get('run');
let nextCursor = null;
document.querySelector('#all-results').hidden = !selectedResult;
async function loadResults() {
  moreButton.disabled = true; retryButton.hidden = true;
  const query = new URLSearchParams();
  if (selectedResult) query.set('id', selectedResult);
  if (nextCursor) query.set('cursor', nextCursor);
  try {
    const response = await fetch(`/api/public-runs?${query}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Could not load results.');
    for (const result of body.results) {
      if ([...resultList.children].some(row => row.dataset.id === result.id)) continue;
      const row = window.renderPublicSummary(result, { link: !selectedResult });
      row.dataset.id = result.id; resultList.append(row);
    }
    nextCursor = body.nextCursor; moreButton.hidden = !nextCursor;
    resultStatus.textContent = resultList.children.length ? (selectedResult ? 'Shared with permission.' : 'Most recently shared first.') : 'No results have been shared yet. Complete a run and choose whether to post yours.';
  } catch (error) {
    resultStatus.textContent = error.message; retryButton.hidden = false;
  } finally { moreButton.disabled = false; }
}
moreButton.addEventListener('click', loadResults); retryButton.addEventListener('click', loadResults);
loadResults();
