import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBinary } from '../execFileAsync.js';
import { config } from '../../config.js';
const BIN = config.engineBins.nuclei;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_TEMPLATES_DIR = path.join(__dirname, '..', 'templates', 'nuclei');
export const nucleiAdapter = {
  id: 'nuclei', name: 'Nuclei', license: 'MIT', intrusiveness: 'SAFE_ACTIVE', capabilities: ['SAFE_ACTIVE'],
  supportedTargetTypes: ['WEB_APP', 'API', 'HOST'], supportedAnalysisTypes: ['WEB', 'API'],
  async healthCheck() { try { const { stdout, stderr } = await runBinary(BIN, ['-version'], { timeoutMs: 15_000 }); const version = (stdout + stderr).match(/Nuclei Engine Version:\s*(\S+)/)?.[1] || 'unknown'; return { status: 'HEALTHY', version }; } catch (err) { return { status: 'OFFLINE', detail: String(err.message || err) }; } },
  async execute({ target, timeoutMs = 120_000, rateLimit = 10, templatesDir = BUNDLED_TEMPLATES_DIR, templateId }) {
    const args = ['-target', target, '-templates', templatesDir, '-jsonl', '-silent', '-etags', 'dos,fuzz,intrusive', '-rate-limit', String(rateLimit), '-no-interactsh', '-disable-update-check'];
    if (templateId) args.push('-template-id', templateId);
    const { stdout } = await runBinary(BIN, args, { timeoutMs, allowedExitCodes: [0] });
    return { raw: stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
  },
};
