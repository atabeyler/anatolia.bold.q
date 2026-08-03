/**
 * ANATOLIA-Q Quantum Service
 * Recomputes scenario probabilities generated in quantum mode on a real
 * quantum circuit (Qiskit Aer simulator) instead of relying solely on the
 * LLM's textual estimate. Spawns the server/quantum/scenario_quantum.py process.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { resolveQuantumCommand } from './quantumProcess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../quantum/scenario_quantum.py');
const TIMEOUT_MS = withIbmTimeout(20000);

function parsePercentToWeight(raw) {
  if (!raw) return null;
  // Turkish decimals use "," (e.g. "%42,5") — accept either separator.
  const m = String(raw).match(/(\d+(?:[.,]\d+)?)/);
  return m ? Number(m[1].replace(',', '.')) / 100 : null;
}

/**
 * @param {Array<{id:string, probability?:string}>} scenarios - output of parseScenarios()
 * @returns {Promise<{backend:string, qubits:number, shots:number, scenarios:Array}|null>}
 *          Returns null if the Qiskit process fails (no python/qiskit, timeout, etc.)
 *          — the caller should then proceed with the LLM's original estimates.
 */
export function computeQuantumProbabilities(scenarios, shots = 4096) {
  if (!Array.isArray(scenarios) || scenarios.length === 0) return Promise.resolve(null);

  const payload = JSON.stringify({
    shots,
    scenarios: scenarios.map((s) => ({ id: s.id, weight: parsePercentToWeight(s.probability) })),
  });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let proc;
    try {
      const { bin, args } = resolveQuantumCommand('scenario', SCRIPT_PATH);
      proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      logger.warn({ err }, '[Quantum] Failed to start Python process');
      return finish(null);
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      logger.warn('[Quantum] Timed out — proceeding with LLM estimates');
      proc.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => {
      clearTimeout(timer);
      logger.warn({ err: e }, '[Quantum] Process error');
      finish(null);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        logger.warn({ code, stderr: err.trim().slice(0, 300) }, '[Quantum] Qiskit process failed');
        return finish(null);
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.error) {
          logger.warn({ circuitError: parsed.error }, '[Quantum] Circuit error');
          return finish(null);
        }
        finish(parsed);
      } catch (e) {
        logger.warn({ err: e }, '[Quantum] Failed to parse output');
        finish(null);
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/**
 * Merges quantum results into the scenarios list and produces the
 * markdown verification section (table + confidence interval + the real
 * circuit diagram) to append to the report.
 */
export function mergeQuantumResults(scenarios, quantumResult) {
  if (!quantumResult?.scenarios?.length) return { scenarios, note: null };

  const merged = scenarios.map((s) => {
    const q = quantumResult.scenarios.find((x) => x.id === s.id);
    return q
      ? {
          ...s,
          llmEstimate: q.llmEstimate,
          quantumProbability: q.quantumProbability,
          quantumStdDev: q.quantumStdDev,
          quantumRangeLow: q.quantumRangeLow,
          quantumRangeHigh: q.quantumRangeHigh,
        }
      : s;
  });

  const estimateLabel = quantumResult.dataSource === 'uploaded' ? 'Yüklenen Değer' : 'YZ Tahmini';
  const rows = merged
    .filter((s) => s.quantumProbability !== undefined)
    .map((s) => `| ${s.title} | %${s.llmEstimate} | %${s.quantumProbability} | %${s.quantumRangeLow} – %${s.quantumRangeHigh} |`)
    .join('\n');

  const layerCount = quantumResult.mixerLayers?.length || 0;

  const sourceNote = quantumResult.dataSource === 'uploaded'
    ? 'Bu senaryolar kullanıcı tarafından yüklenen bir dosyadan (CSV/XLSX) çıkarılan GERÇEK senaryo verileridir.'
    : 'Gerçek veri sağlanmadığından bu senaryolar YZ tarafından üretilen tahminlerdir.';

  const hw = quantumResult.hardwareVerification;
  const hardwareSection = hw?.scenarios?.length
    ? `\n### Gerçek Donanım Doğrulaması\n` +
      `Aynı devre ayrıca gerçek IBM Quantum donanımında (**${hw.backend}**, ${hw.shots} shot) bir kez daha çalıştırılmıştır ` +
      `(bu değer, yukarıdaki güven aralığına dahil edilmemiştir — donanım gürültüsü örnekleme gürültüsüyle aynı değildir):\n\n` +
      `| Senaryo | Gerçek Donanım Sonucu |\n|---|---|\n` +
      hw.scenarios.map((s) => {
        const label = merged.find((m) => m.id === s.id)?.title || s.id;
        return `| ${label} | %${s.quantumProbability} |`;
      }).join('\n') + '\n'
    : '';

  const note = `\n## KUANTUM DEVRE DOĞRULAMASI\n` +
    `Aşağıdaki olasılıklar, YZ'nin ilk tahminleri kuantum genliği olarak ${quantumResult.qubits}-kübitlik bir devreye yüklenip, ` +
    `her kübit çiftini birbirine bağlayan ${layerCount} katmanlı bir karışım (mixer) katmanından geçirildikten sonra hesaplanmıştır. ` +
    `Tek bir ölçüm turu yerine devre ${quantumResult.batches} kez bağımsız olarak çalıştırılmış (toplam ${quantumResult.shots} ölçüm/shot), ` +
    `sonuçtaki güven aralığı bu bağımsız turlar arasındaki gerçek örnekleme sapmasından hesaplanmıştır. ${sourceNote}\n` +
    `Backend: ${quantumResult.backend} (yerel kuantum devre simülatörü, devre derinliği ${quantumResult.circuitDepth} — gerçek kuantum donanımı değildir).\n\n` +
    `| Senaryo | ${estimateLabel} | Kuantum Sonucu (ortalama) | Güven Aralığı |\n|---|---|---|---|\n${rows}\n\n` +
    `### Çalıştırılan Devre\n\`\`\`\n${quantumResult.circuitDiagram}\n\`\`\`\n${hardwareSection}`;

  return { scenarios: merged, note };
}
