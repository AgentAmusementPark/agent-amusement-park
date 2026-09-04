const cta = document.querySelector('#commercial-cta'); const note = document.querySelector('#cta-note');
fetch('/api/config').then(response => response.json()).then(config => {
  if (config.benchAvailable && config.benchOrigin) {
    cta.href = config.benchOrigin; cta.removeAttribute('aria-disabled'); cta.innerHTML = 'Open A2AParkBench <span>→</span>'; note.textContent = 'The separately hosted Bench origin is configured.';
  } else if (config.salesEmail) {
    const subject = encodeURIComponent('A2AParkBench launch interest');
    const body = encodeURIComponent('I would like to hear when A2AParkBench is available.');
    cta.href = `mailto:${config.salesEmail}?subject=${subject}&body=${body}`; cta.removeAttribute('aria-disabled'); cta.innerHTML = 'Register interest <span>→</span>'; note.textContent = `No account or payment. Contact ${config.salesEmail}.`;
  }
}).catch(() => {});
