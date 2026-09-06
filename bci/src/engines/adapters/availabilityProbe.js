import { runBinary } from '../execFileAsync.js';
import { CURL_DISCARD_PATH, assertHttpTarget, curlHealthCheck, parseHttpStatus } from './nativeHttp.js';

// DOS capability adapter for availability/resilience analysis. It performs
// a tiny fixed sample of sequential requests; it does not generate load or
// attempt to exhaust target resources.
export const availabilityProbeAdapter = {
  id: 'availability-probe',
  name: 'BCI Availability Resilience',
  license: 'BCI-NATIVE',
  intrusiveness: 'RESTRICTED',
  capabilities: ['DOS'],
  supportedTargetTypes: ['DOMAIN', 'SUBDOMAIN', 'URL', 'API'],
  supportedAnalysisTypes: ['DOS'],
  async healthCheck() { return curlHealthCheck(); },
  async execute({ target, timeoutMs = 30_000 }) {
    const validatedTarget = assertHttpTarget(target);
    const raw = [];
    for (let sample = 1; sample <= 3; sample += 1) {
      try {
        const { stdout } = await runBinary('curl', [
          '--silent', '--show-error', '--output', CURL_DISCARD_PATH,
          '--write-out', '%{http_code} %{time_total}', '--max-time', '5', validatedTarget,
        ], { timeoutMs: Math.min(timeoutMs, 7_000), allowedExitCodes: [0] });
        const [statusText, secondsText] = stdout.trim().split(/\s+/);
        const status = parseHttpStatus(statusText); const latencyMs = Number(secondsText) * 1000;
        if (!Number.isFinite(latencyMs) || latencyMs < 0) throw new Error(`unexpected latency output: ${secondsText}`);
        raw.push({ type: 'AVAILABILITY_SAMPLE', sample, status, latencyMs, anomalous: status >= 500 || latencyMs >= 4000 });
      } catch (err) {
        raw.push({ type: 'AVAILABILITY_SAMPLE', sample, status: null, latencyMs: null, anomalous: true, error: String(err.message || err) });
      }
    }
    return { raw };
  },
};
