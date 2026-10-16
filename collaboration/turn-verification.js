let loading;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!loading) loading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const failed = () => {clearTimeout(timer);script.remove();reject(new Error('Verification could not load. Check your connection and try again.'));};
    const timer = setTimeout(failed, 15000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async = true;
    script.onerror = failed;
    script.onload = () => {if (!window.turnstile) return failed();clearTimeout(timer);resolve(window.turnstile);};
    document.head.append(script);
  }).catch(error => {loading = null;throw error;});
  return loading;
}

export function verifyTurnstile(siteKey, signal) {
  if (!['https:', 'http:'].includes(location.protocol)) return Promise.reject(new Error('Automatic relay needs the hosted planner. Local files can use manual TURN settings.'));
  return new Promise((resolve, reject) => {
    const dialog = document.createElement('dialog');let api, widget, done = false;
    dialog.className = 'turn-verification';dialog.setAttribute('aria-label', 'Connection verification');
    dialog.innerHTML = '<h2>Prepare secure connection</h2><p>Complete the verification to enable the connection relay.</p><div data-turnstile></div><button type="button">Cancel</button>';
    const finish = (error, token) => {
      if (done) return;done = true;clearTimeout(timer);signal?.removeEventListener('abort', cancel);
      if (widget !== undefined) api?.remove(widget);
      dialog.close();dialog.remove();if (error) reject(error);else resolve(token);
    };
    const cancel = () => finish(new Error('Connection verification was cancelled. Reconnect to try again.'));
    const timer = setTimeout(() => finish(new Error('Connection verification timed out. Reconnect to try again.')), 120000);
    signal?.addEventListener('abort', cancel, {once: true});
    dialog.addEventListener('cancel', event => {event.preventDefault();cancel();});dialog.querySelector('button').onclick = cancel;
    if (signal?.aborted) {cancel();return;}
    document.body.append(dialog);dialog.showModal();
    loadTurnstile().then(value => {
      if (done) return;api = value;
      widget = api.render(dialog.querySelector('[data-turnstile]'), {
        sitekey: siteKey, action: 'route-together-turn', theme: 'dark', size: 'flexible', retry: 'never', 'refresh-expired': 'never',
        callback: token => finish(null, token),
        'error-callback': () => {finish(new Error('Connection verification failed. Reconnect to try again.'));return true;},
        'expired-callback': () => finish(new Error('Connection verification expired. Reconnect to try again.')),
        'timeout-callback': () => finish(new Error('Connection verification timed out. Reconnect to try again.')),
      });
      if (done && widget !== undefined) api.remove(widget);
    }).catch(error => finish(error));
  });
}
