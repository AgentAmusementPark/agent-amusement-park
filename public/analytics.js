(function () {
  const config = window.PORTFOLIO_ANALYTICS || {};
  const product = String(config.product || 'unknown');
  const canonicalHosts = Array.isArray(config.canonicalHosts) ? config.canonicalHosts : [];
  const params = new URLSearchParams(location.search);
  const botPattern = /bot|crawler|spider|headless|phantom|selenium|slurp|bingpreview|facebookexternalhit|archive\.org|uptime/i;
  const isProbableBot = botPattern.test(navigator.userAgent) || navigator.webdriver === true;
  const isCanonicalHost = location.hostname === 'a2apark.com' && canonicalHosts.includes(location.hostname);
  const isMarkedTest = params.get('analytics_test') === '1';
  const internalKey = 'a2apark_analytics_internal';
  try {
    if (params.get('internal') === '1') localStorage.setItem(internalKey, '1');
    if (params.get('internal') === '0') localStorage.removeItem(internalKey);
  } catch {}
  let isInternal = params.has('internal');
  try { isInternal ||= localStorage.getItem(internalKey) === '1'; } catch {}

  function referringDomain() {
    try { return document.referrer ? new URL(document.referrer).hostname.toLowerCase() : null; }
    catch { return null; }
  }

  function source() {
    const campaignSource = params.get('utm_source') || params.get('source') || params.get('ref');
    if (campaignSource) return campaignSource.toLowerCase().slice(0, 120);
    const host = referringDomain();
    if (!host) return 'direct';
    if (host.includes('chatgpt.com')) return 'chatgpt';
    if (host.includes('google.')) return 'google';
    if (host.includes('bing.')) return 'bing';
    if (host.includes('reddit.')) return 'reddit';
    if (host.includes('github.com')) return 'github';
    return host;
  }

  function uuidv7() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let timestamp = Date.now();
    for (let i = 5; i >= 0; i--) { bytes[i] = timestamp & 255; timestamp = Math.floor(timestamp / 256); }
    bytes[6] = (bytes[6] & 15) | 0x70;
    bytes[8] = (bytes[8] & 63) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function session() {
    const key = 'a2apark_session_v7';
    const now = Date.now();
    let state;
    try { state = JSON.parse(sessionStorage.getItem(key) || 'null'); } catch {}
    if (!state || !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(state.id || '') || now - state.last > 30 * 60_000 || now - state.created > 24 * 60 * 60_000 || state.created > now) {
      state = { id: uuidv7(), created: now, last: now };
    } else state.last = now;
    try { sessionStorage.setItem(key, JSON.stringify(state)); } catch {}
    return state.id;
  }

  function ephemeralId(kind) {
    const key = `a2apark_${kind}`;
    let id;
    try { id = sessionStorage.getItem(key); } catch {}
    if (!id) {
      id = crypto.randomUUID();
      try { sessionStorage.setItem(key, id); } catch {}
    }
    return id;
  }

  function track(event, extra) {
    if (config.provider !== 'posthog' || !config.posthogKey || isProbableBot || !isCanonicalHost || isMarkedTest || isInternal) return;
    const properties = Object.assign({
      distinct_id: ephemeralId('visitor'),
      $session_id: session(),
      $window_id: ephemeralId('window'),
      $current_url: `${location.origin}${location.pathname}`,
      $host: location.hostname,
      $pathname: location.pathname,
      $referring_domain: referringDomain(),
      $process_person_profile: false,
      product,
      source: source(),
      probable_bot: false,
      device_class: matchMedia('(max-width: 760px)').matches ? 'small_screen' : 'large_screen'
    }, extra || {});
    const body = JSON.stringify({ api_key: config.posthogKey, event, properties });
    const endpoint = `${config.posthogHost || 'https://eu.i.posthog.com'}/i/v0/e/`;
    if (config.debug) console.info('[Portfolio analytics]', event, properties);
    if (navigator.sendBeacon) navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }));
    else fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  }

  window.portfolioAnalytics = { track, probableBot: isProbableBot, source: source() };
  track('$pageview');

  const pageStartedAt = Date.now();
  let pageLeaveSent = false;
  function trackPageLeave() {
    if (pageLeaveSent) return;
    pageLeaveSent = true;
    track('$pageleave', { duration_seconds: Math.max(0, (Date.now() - pageStartedAt) / 1000) });
  }
  addEventListener('pagehide', trackPageLeave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') trackPageLeave();
  });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (!link) return;
    try {
      const target = new URL(link.href, location.href);
      if (target.origin !== location.origin) {
        track('outbound_click', { target_url: `${target.origin}${target.pathname}`, label: link.textContent.trim().slice(0, 120) });
      }
    } catch {}
  });
})();
