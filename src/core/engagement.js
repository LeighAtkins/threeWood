// No collector Worker or database: these are GETs for three static Pages files.
// Count the paths in Cloudflare zone analytics. No IDs, scores or seed are sent.
const EVENTS = new Set(['round-started', 'hole-completed', 'round-completed']);

export function createPlayReporter({ send, optedOut = () => false, limit = 120 }) {
  const seen = new WeakMap();
  let sent = 0;
  return (event, round, hole = 0) => {
    if (!EVENTS.has(event) || !round || typeof round !== 'object' || optedOut() || sent >= limit) return false;
    const key = `${event}:${hole}`;
    let keys = seen.get(round);
    if (!keys) { keys = new Set(); seen.set(round, keys); }
    if (keys.has(key)) return false;
    keys.add(key);
    sent++;
    try { Promise.resolve(send(`/play-events/${event}.txt`)).catch(() => {}); } catch { /* never interrupts play */ }
    return true;
  };
}

export const reportPlay = createPlayReporter({
  optedOut: () => typeof navigator === 'undefined' || navigator.onLine === false || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true,
  send: (url) => fetch(url, { method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }),
});
