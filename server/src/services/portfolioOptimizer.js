/**
 * ANATOLIA-Q Quantum Resource-Allocation Optimizer Service
 * Solves a real budget-constrained selection problem (which candidate
 * projects/items to fund within a budget) with QAOA instead of relying on
 * the LLM's own judgment. Spawns server/quantum/portfolio_optimizer.py.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { runQuantumWorker } from './quantumProcess.js';

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

  return runQuantumWorker({
    mode: 'portfolio',
    scriptPath: SCRIPT_PATH,
    payload: { items, budgetPercent },
    timeoutMs: TIMEOUT_MS,
    label: 'PortfolioOptimizer',
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

  const sourceNote = optimizerResult.dataSource === 'uploaded'
    ? ' Kalem/değer/maliyet tablosu kullanıcı tarafından yüklenen bir dosyadan (CSV/XLSX) çıkarılan GERÇEK verilerdir.'
    : ' Gerçek veri sağlanmadığından bu tablo YZ tarafından üretilmiştir.';

  const note = `\n## KUANTUM KAYNAK TAHSİSİ OPTİMİZASYONU (QAOA)\n` +
    `Aşağıdaki seçim, ${optimizerResult.qubits}-kübitlik bir QAOA (Quantum Approximate Optimization Algorithm) devresiyle ` +
    `gerçek bir kısıtlı optimizasyon problemi olarak çözülmüştür — bütçe kısıtı (%${optimizerResult.budgetPercent}) kayan (slack) kübitlerle ` +
    `devreye tam olarak kodlanmış, klasik bir COBYLA optimizasyon döngüsü devrenin parametrelerini ayarlamıştır. ` +
    `Sonuç, bütçeyi aşmayan (fizibıl) ölçümler arasından en yüksek değerli olanıdır.${hardwareNote}${sourceNote}\n\n` +
    `**Toplam değer: ${optimizerResult.totalValue} · Toplam maliyet: %${optimizerResult.totalCost} / %${optimizerResult.budgetPercent} bütçe**\n\n` +
    `| Kalem | Değer | Maliyet | Durum |\n|---|---|---|---|\n${rows}\n\n` +
    `### QAOA Devresi\n\`\`\`\n${optimizerResult.circuitDiagram}\n\`\`\`\n` +
    buildClassicalBenchmarkSection(optimizerResult);

  return note;
}

/**
 * Compares the QAOA result against a classical brute-force optimum computed
 * on the same problem (see classical_optimal() in portfolio_optimizer.py),
 * so the report doesn't just assert QAOA found a good answer — it shows the
 * true optimum and the exact gap.
 */
export function buildClassicalBenchmarkSection(optimizerResult) {
  const benchmark = optimizerResult?.classicalBenchmark;
  if (!benchmark) return '';
  const status = benchmark.matchesOptimal
    ? '✅ QAOA sonucu klasik optimuma eşit (optimality gap: %0).'
    : `⚠️ QAOA sonucu klasik optimumdan %${benchmark.optimalityGapPercent} daha düşük değerli.`;
  return `\n### Klasik Optimum Karşılaştırması (Brute-Force Benchmark)\n` +
    `Aynı problem, tüm alt kümeler (2^n) taranarak klasik (kuantum içermeyen) bir kaba kuvvet algoritmasıyla da çözülmüş ve QAOA sonucuyla karşılaştırılmıştır:\n\n` +
    `| Yöntem | Toplam Değer | Toplam Maliyet |\n|---|---|---|\n` +
    `| QAOA (kuantum) | ${optimizerResult.totalValue} | ${optimizerResult.totalCost} |\n` +
    `| Klasik optimum (brute-force) | ${benchmark.totalValue} | ${benchmark.totalCost} |\n\n` +
    `${status}\n`;
}
