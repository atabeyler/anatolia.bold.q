import { runBinary } from '../execFileAsync.js';

// BCI-native bounded HTTP input-robustness checks. This capability is
// intentionally separate from availability/load testing: it sends a small,
// deterministic set of malformed/boundary query values and records server
// errors as observations for the existing finding pipeline.
export const httpFuzzAdapter = {
  id: 'http-fuzz',
  name: 'BCI HTTP Fuzz',
  license: 'BCI-NATIVE',
  intrusiveness: 'SAFE_ACTIVE',
  capabilities: ['FUZZ'],
  supportedTargetTypes: ['WEB_APP', 'API'],
  supportedAnalysisTypes: ['WEB', 'API', 'FUZZ'],

  async healthCheck() {
    return { status: 'HEALTHY', version: '1' };
  },

  async execute({ target, timeoutMs = 30_000 }) {
    const cases = ['BCI_BOUNDARY_EMPTY', '0', '-1', '2147483648', 'BCI_%25_TEST'];
    const raw = [];
    for (const value of cases) {
      const url = new URL(target);
      url.searchParams.set('bci_probe', value);
      try {
        const { stdout } = await runBinary('curl', [
          '--silent', '--show-error', '--output', '/dev/null', '--write-out', '%{http_code}',
          '--max-time', '5', '--request', 'GET', url.toString(),
        ], { timeoutMs: Math.min(timeoutMs, 7_000), allowedExitCodes: [0] });
        const status = Number(stdout.trim());
        raw.push({ type: 'HTTP_FUZZ_PROBE', parameter: 'bci_probe', case: value, status, anomalous: status >= 500 });
      } catch (err) {
        raw.push({ type: 'HTTP_FUZZ_PROBE', parameter: 'bci_probe', case: value, status: null, anomalous: false, error: String(err.message || err) });
      }
    }
    return { raw };
  },
};
