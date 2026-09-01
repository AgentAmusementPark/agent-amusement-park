const cta = document.querySelector('#commercial-cta'); const note = document.querySelector('#cta-note');
recordEvent('team_page_viewed');
fetch('/api/config').then(response => response.json()).then(config => {
  if (config.checkoutUrl) {
    cta.href = config.checkoutUrl; cta.removeAttribute('aria-disabled'); cta.innerHTML = `Start Private Park at ${config.teamPrice} <span>→</span>`; note.textContent = 'Secure checkout. Cancel anytime.';
    cta.addEventListener('click', () => recordEvent('checkout_clicked'));
  } else if (config.salesEmail) {
    const subject = encodeURIComponent('Private Park founding access');
    const body = encodeURIComponent('I am interested in Private Park for my agent team.');
    cta.href = `mailto:${config.salesEmail}?subject=${subject}&body=${body}`; cta.removeAttribute('aria-disabled'); cta.innerHTML = 'Request founding access <span>→</span>'; note.textContent = 'No sales call required. Ask questions or request an invoice by email.';
    cta.addEventListener('click', () => recordEvent('contact_clicked'));
  }
}).catch(() => {});
function recordEvent(name, metadata = {}) { fetch('/api/events', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({name, metadata}) }).catch(() => {}); }
