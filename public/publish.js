const $ = selector => document.querySelector(selector);
let token = location.hash.slice(1);
let requestVersion = 0;
let busy = false;
const consent = $('#publication-consent');
const button = $('#publish-button');
consent.addEventListener('change', () => { button.disabled = busy || !consent.checked; });

async function request(publish) {
  const version = ++requestVersion;
  busy = true; button.disabled = true; $('#remove-public-result').disabled = true;
  $('#publication-error').textContent = ''; $('#retry-publication').hidden = true;
  try {
    if (!token) throw new Error('Open the private publication link from your completed run.');
    const response = await fetch(publish === undefined ? '/api/publications/status' : '/api/publications/consent', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, ...(publish === undefined ? {} : { publish }) })
    });
    const data = await response.json();
    if (version !== requestVersion) return;
    if (!response.ok) throw new Error(data.error || 'Could not save your choice.');
    $('#result-preview').replaceChildren(window.renderPublicSummary(data.summary, { link: false }));
    $('#publication-review').hidden = false;
    $('#publish-form').hidden = data.published;
    $('#published-controls').hidden = !data.published;
    $('#view-public-result').href = data.publicPath;
    consent.checked = false;
    $('#publication-status').textContent = data.published ? 'Published. You can remove it below at any time.' : 'This result is not on the public results page.';
  } catch (error) {
    if (version !== requestVersion) return;
    $('#publication-error').textContent = error.message;
    $('#publication-status').textContent = 'Your publication choice could not be confirmed. Try again to check it.';
    $('#retry-publication').hidden = !token;
  } finally {
    if (version === requestVersion) {
      busy = false; button.disabled = !consent.checked; $('#remove-public-result').disabled = false;
    }
  }
}
$('#publish-form').addEventListener('submit', event => {
  event.preventDefault(); if (!busy && consent.checked) request(true);
});
$('#remove-public-result').addEventListener('click', () => { if (!busy) request(false); });
$('#retry-publication').addEventListener('click', () => request());
window.addEventListener('hashchange', () => {
  token = location.hash.slice(1); consent.checked = false; $('#publication-review').hidden = true; request();
});
request();
