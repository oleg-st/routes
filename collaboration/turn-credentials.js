const STORAGE_KEY = 'route-together:turn-credentials:v1';

export function createOptionalTurnCredentials(options) {
  const prepare = createTurnCredentials(options);
  return async (config = {}, signal, onFallback = () => {}) => {
    signal?.throwIfAborted();
    try {return await prepare(config, signal);} catch (error) {
      signal?.throwIfAborted();
      // Relay setup must not prevent direct WebRTC, except when explicitly required.
      if (config.rtcConfig?.iceTransportPolicy === 'relay' || error?.name === 'AbortError') throw error;
      onFallback();
      return config;
    }
  };
}

function validCredentials(data, now) {
  return data && Number.isFinite(data.expiresAt) && data.expiresAt >= now + 60000 && data.expiresAt <= now + 6 * 60 * 60 * 1000
    && Array.isArray(data.iceServers) && data.iceServers.length > 0 && data.iceServers.length <= 8
    && data.iceServers.every(server => server && Array.isArray(server.urls) && server.urls.length > 0 && server.urls.length <= 8
      && server.urls.every(url => typeof url === 'string' && /^turns?:turn\.cloudflare\.com:(3478|443|80|5349)\?transport=(udp|tcp)$/.test(url))
      && typeof server.username === 'string' && server.username.length > 0 && server.username.length <= 2048
      && typeof server.credential === 'string' && server.credential.length > 0 && server.credential.length <= 2048);
}

export function createTurnCredentials({settings, verify, fetchImpl = fetch, now = Date.now, storage = () => globalThis.sessionStorage}) {
  let cached;
  return async function credentials(config = {}, signal) {
    const manual = [...(config.turnConfig || []), ...(config.rtcConfig?.iceServers || [])].some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(url => /^turns?:/.test(url)));
    if (manual || !settings.endpoint && !settings.siteKey) return config;
    const endpoint = new URL(settings.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !settings.siteKey) throw new Error('Automatic relay is not configured correctly.');
    signal?.throwIfAborted();
    let session;
    try {session = storage();} catch {}
    if (!cached || cached.expiresAt - now() < 60000) {
      try {
        const saved = JSON.parse(session?.getItem(STORAGE_KEY) || 'null');
        if (saved?.endpoint === endpoint.href && saved.siteKey === settings.siteKey && validCredentials(saved.data, now())) cached = saved.data;
        else session?.removeItem(STORAGE_KEY);
      } catch {try {session?.removeItem(STORAGE_KEY);} catch {}}
    }
    if (!cached || cached.expiresAt - now() < 60000) {
      const token = await verify(settings.siteKey, signal);
      signal?.throwIfAborted();
      const response = await fetchImpl(endpoint.href, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({token}),
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(25000)]) : AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(response.status === 429 ? 'Too many relay requests. Wait a minute and reconnect.' : response.status === 403 ? 'Relay verification failed. Reconnect to try again.' : 'Automatic relay is unavailable. Reconnect or enter your own TURN settings.');
      const data = await response.json();
      if (!validCredentials(data, now())) throw new Error('Invalid relay configuration.');
      signal?.throwIfAborted();cached = data;
      // Keep only temporary relay credentials across reloads, never the single-use verification token.
      try {session?.setItem(STORAGE_KEY, JSON.stringify({endpoint: endpoint.href, siteKey: settings.siteKey, data}));} catch {}
    }
    // Explicit ICE lists override Trystero's turnConfig; append relay entries to those too.
    return {...config, turnConfig: cached.iceServers, ...(config.rtcConfig?.iceServers ? {rtcConfig: {...config.rtcConfig, iceServers: [...config.rtcConfig.iceServers, ...cached.iceServers]}} : {}), turnExpiresAt: cached.expiresAt};
  };
}
