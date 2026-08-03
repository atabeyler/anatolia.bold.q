/**
 * ANATOLIA-Q Quantum Resource-Allocation Optimizer Service
 * Solves a real budget-constrained selection problem (which candidate
 * projects/items to fund within a budget) with QAOA instead of relying on
 * the LLM's own judgment. Spawns server/quantum/portfolio_optimizer.py.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { resolveQuantumCommand } from './quantumProcess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../quantum/portfolio_optimizer.py');
// 45s covers QAOA's classical optimization loop (dozens of circuit evaluations);
// withIbmTimeout() adds the IBM hardware wait budget on top when configured.
const TIMEOUT_MS = withIbmTimeout(45000);

/**
 * @param {Array<{id:string, value:number, cost:number}>} items
 * @param {number} budgetPercent
 * @returns {Promise<{backend:string, qubits:number, circuitDepth:number, circuitDiagram:string,
 *          selected:string[], totalValue:number, totalCost:number, items:Array}|null>}
 *          Returns null if the Python process fails — the caller should then
 *          proceed with the LLM's narrative recommendation unscored.
 */
export function computeOptimalAllocation(items, budgetPercent) {
  if (!Array.isArray(items) || items.length < 2) return Promise.resolve(null);

  const payload = JSON.stringify({ items, budgetPercent });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let proc;
    try {
      const { bin, args } = resolveQuantumCommand('portfolio', SCRIPT_PATH);
      proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      logger.warn({ err }, '[PortfolioOptimizer] Failed to start Python process');
      return finish(null);
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      logger.warn('[PortfolioOptimizer] Timed out — proceeding without optimizer result');
      proc.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => {
      clearTimeout(timer);
      logger.warn({ err: e }, '[PortfolioOptimizer] Process error');
      finish(null);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        logger.warn({ code, stderr: err.trim().slice(0, 300) }, '[PortfolioOptimizer] QAOA process failed');
        return finish(null);
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.error) {
          logger.warn({ qaoaError: parsed.error }, '[PortfolioOptimizer] QAOA error');
          return finish(null);
        }
        finish(parsed);
      } catch (e) {
        logger.warn({ err: e }, '[PortfolioOptimizer] Failed to parse output');
        finish(null);
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

/**
 * Produces the markdown verification section (selected/rejected item table +
 * the real QAOA circuit diagram) to append to the report.
 */
export function mergeOptimizerResults(optimizerResult) {
  if (!optimizerResult?.items?.length) return null;

  const rows = optimizerResult.items
    .map((it) => `| ${it.id} | ${it.value} | ${it.cost} | ${it.selected ? '✅ Seçildi' : '—'} |`)
    .join('\n');

  const hardwareNote = optimizerResult.backend !== 'qiskit-aer-simulator'
    ? ` Son ölçüm gerçek kuantum donanımında (**${optimizerResult.backend}**) yapılmıştır.`
    : optimizerResult.ibmHardwareAttempted
      ? ' Gerçek donanıma gönderim denendi ancak kuyruk/zaman aşımı nedeniyle yerel simülatöre düşüldü.'
      : '';

  const note = `\n## KUANTUM KAYNAK TAHSİSİ OPTİMİZASYONU (QAOA)\n` +
    `Aşağıdaki seçim, ${optimizerResult.qubits}-kübitlik bir QAOA (Quantum Approximate Optimization Algorithm) devresiyle ` +
    `gerçek bir kısıtlı optimizasyon problemi olarak çözülmüştür — bütçe kısıtı (%${optimizerResult.budgetPercent}) kayan (slack) kübitlerle ` +
    `devreye tam olarak kodlanmış, klasik bir COBYLA optimizasyon döngüsü devrenin parametrelerini ayarlamıştır. ` +
    `Sonuç, bütçeyi aşmayan (fizibıl) ölçümler arasından en yüksek değerli olanıdır.${hardwareNote}\n\n` +
    `**Toplam değer: ${optimizerResult.totalValue} · Toplam maliyet: %${optimizerResult.totalCost} / %${optimizerResult.budgetPercent} bütçe**\n\n` +
    `| Kalem | Değer | Maliyet | Durum |\n|---|---|---|---|\n${rows}\n\n` +
    `### QAOA Devresi\n\`\`\`\n${optimizerResult.circuitDiagram}\n\`\`\`\n`;

  return note;
}
