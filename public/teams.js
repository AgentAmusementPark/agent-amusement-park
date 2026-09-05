const cta = document.querySelector('#commercial-cta');
fetch('/api/config').then(response => response.json()).then(config => {
  const publicWebsiteAvailable = config.benchPublicWebsiteAvailable ?? config.benchAvailable;
  if (publicWebsiteAvailable && config.benchOrigin) {
    cta.href = `${config.benchOrigin}/`;
  }
}).catch(() => {});
