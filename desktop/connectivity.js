import { EventEmitter } from 'node:events';

// Tri-state connectivity: 'cloud' (reachable, idle), 'sync' (a push/pull is
// actively running), 'local' (unreachable — desktop keeps working against
// SQLite only). This module only ever reports state via events; it never
// touches the window or the session, so losing connectivity can't tear down
// the UI or kick the user out (spec point 6).
export function createConnectivityMonitor({ apiBaseUrl, fetchImpl = fetch, intervalMs = 30000 }) {
  const emitter = new EventEmitter();
  let state = 'local';
  let timer = null;

  function setState(next) {
    if (next === state) return;
    state = next;
    emitter.emit('change', state);
  }

  async function checkOnce() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetchImpl(`${apiBaseUrl}/api/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setState(res.ok ? 'cloud' : 'local');
      return res.ok;
    } catch {
      setState('local');
      return false;
    }
  }

  // The sync engine calls this while a push/pull is actively in flight, so
  // the UI can show "SYNC" instead of just "Q CLOUD" during that window;
  // the next periodic checkOnce() (or an explicit one after the sync pass)
  // settles it back to 'cloud' or 'local'.
  function markSyncing() {
    setState('sync');
  }

  function start() {
    checkOnce();
    timer = setInterval(checkOnce, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    checkOnce,
    markSyncing,
    getState: () => state,
    onChange: (fn) => emitter.on('change', fn),
    offChange: (fn) => emitter.off('change', fn),
  };
}
