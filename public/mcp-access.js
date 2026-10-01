const copyButton = document.querySelector('#copy-endpoint');
copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.querySelector('#endpoint').textContent);
    document.querySelector('#copy-status').textContent = 'Endpoint copied.';
  } catch {
    document.querySelector('#copy-status').textContent = 'Select the endpoint above to copy it.';
  }
});
