export function createTurnCredentials({settings, verify, fetchImpl = fetch, now = Date.now}) {
  let cached;
  return async function credentials(config = {}, signal) {
    const manual = [...(config.turnConfig || []), ...(config.rtcConfig?.iceServers || [])].some(s => (Array.isArray(s.urls) ? s.urls : [s.urls]).some(url => /^turns?:/.test(url)));
    if (manual || !settings.endpoint && !settings.siteKey) return config;
    const endpoint = new URL(settings.endpoint);
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || !settings.siteKey) throw new Error('Automatic relay is not configured correctly.');
    signal?.throwIfAborted();
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
      if (!Number.isFinite(data.expiresAt) || data.expiresAt < now() + 60000 || data.expiresAt > now() + 6 * 60 * 60 * 1000 || !Array.isArray(data.iceServers) || !data.iceServers.length || data.iceServers.length > 8) throw new Error('Invalid relay configuration.');
      for (const server of data.iceServers) {
        if (!Array.isArray(server.urls) || !server.urls.length || server.urls.length > 8 || !server.urls.every(url => typeof url === 'string' && /^turns?:turn\.cloudflare\.com:(3478|443|80|5349)\?transport=(udp|tcp)$/.test(url)) || typeof server.username !== 'string' || !server.username.length || server.username.length > 2048 || typeof server.credential !== 'string' || !server.credential.length || server.credential.length > 2048) throw new Error('Invalid relay configuration.');
      }
      signal?.throwIfAborted();cached = data;
    }
    // Explicit ICE lists override Trystero's turnConfig; append relay entries to those too.
    return {...config, turnConfig: cached.iceServers, ...(config.rtcConfig?.iceServers ? {rtcConfig: {...config.rtcConfig, iceServers: [...config.rtcConfig.iceServers, ...cached.iceServers]}} : {}), turnExpiresAt: cached.expiresAt};
  };
}
