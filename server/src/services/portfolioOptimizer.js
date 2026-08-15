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
// 45s covers one QAOA circuit's classical optimization loop (dozens of
// circuit evaluations); withIbmTimeout() adds the IBM hardware wait budget
// on top when configured.
const SINGLE_CIRCUIT_TIMEOUT_MS = 45000;
// Mirrors MAX_ITEMS/MAX_TOTAL_ITEMS in portfolio_optimizer.py -- above
// MAX_ITEMS the script runs the hybrid decomposition (one QAOA circuit per
// partition, sequentially), so the timeout budget scales with how many
// partitions that could take.
const MAX_ITEMS_PER_PARTITION = 8;
const MAX_TOTAL_ITEMS = 24;

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

  const partitionCount = Math.max(1, Math.ceil(Math.min(items.length, MAX_TOTAL_ITEMS) / MAX_ITEMS_PER_PARTITION));
  const timeoutMs = withIbmTimeout(SINGLE_CIRCUIT_TIMEOUT_MS * partitionCount);

  return runQuantumWorker({
    mode: 'portfolio',
    scriptPath: SCRIPT_PATH,
    payload: { items, budgetPercent },
    timeoutMs,
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

  const hybridNote = optimizerResult.hybrid
    ? ` **Hibrit çözüm:** ${optimizerResult.items.length} kalem, tek bir QAOA devresinin taşıyabileceği kalem sayısının (8) üzerinde olduğu için değer/maliyet oranına göre sıralanıp ${optimizerResult.partitionCount} gruba (her biri kendi QAOA devresiyle) bölünerek çözülmüştür. Bu, gruplar arası olası ödünleşimleri gözden kaçırabilecek bir yaklaşık çözümdür — aşağıdaki klasik karşılaştırma bu farkı gösterir.`
    : '';

  const note = `\n## KUANTUM KAYNAK TAHSİSİ OPTİMİZASYONU (QAOA)\n` +
    `Aşağıdaki seçim, ${optimizerResult.qubits}-kübitlik bir QAOA (Quantum Approximate Optimization Algorithm) devresiyle ` +
    `gerçek bir kısıtlı optimizasyon problemi olarak çözülmüştür — bütçe kısıtı (%${optimizerResult.budgetPercent}) kayan (slack) kübitlerle ` +
    `devreye tam olarak kodlanmış, klasik bir COBYLA optimizasyon döngüsü devrenin parametrelerini ayarlamıştır. ` +
    `Sonuç, bütçeyi aşmayan (fizibıl) ölçümler arasından en yüksek değerli olanıdır.${hardwareNote}${sourceNote}${hybridNote}\n\n` +
    `**Toplam değer: ${optimizerResult.totalValue} · Toplam maliyet: %${optimizerResult.totalCost} / %${optimizerResult.budgetPercent} bütçe**\n\n` +
    `| Kalem | Değer | Maliyet | Durum |\n|---|---|---|---|\n${rows}\n\n` +
    `### QAOA Devresi\n\`\`\`\n${optimizerResult.circuitDiagram}\n\`\`\`\n` +
    buildClassicalBenchmarkSection(optimizerResult);

  return note;
}

/**
 * Compares the QAOA result against a classical exact optimum computed on
 * the same problem via dynamic programming (see classical_optimal() in
 * portfolio_optimizer.py), so the report doesn't just assert QAOA found a
 * good answer — it shows the true optimum and the exact gap. Doubles as
 * the ground truth the hybrid decomposition path (optimizerResult.hybrid)
 * is scored against too, since it runs on the full item set either way.
 */
export function buildClassicalBenchmarkSection(optimizerResult) {
  const benchmark = optimizerResult?.classicalBenchmark;
  if (!benchmark) return '';
  const status = benchmark.matchesOptimal
    ? '✅ Sonuç klasik optimuma eşit (optimality gap: %0).'
    : `⚠️ Sonuç klasik optimumdan %${benchmark.optimalityGapPercent} daha düşük değerli.`;
  const methodLabel = optimizerResult.hybrid ? 'QAOA (hibrit)' : 'QAOA (kuantum)';
  return `\n### Klasik Optimum Karşılaştırması (Dinamik Programlama Benchmark)\n` +
    `Aynı problem, klasik (kuantum içermeyen) bir dinamik programlama (0/1 sırt çantası) algoritmasıyla da tam olarak çözülmüş ve sonuçla karşılaştırılmıştır:\n\n` +
    `| Yöntem | Toplam Değer | Toplam Maliyet |\n|---|---|---|\n` +
    `| ${methodLabel} | ${optimizerResult.totalValue} | ${optimizerResult.totalCost} |\n` +
    `| Klasik optimum (dinamik programlama) | ${benchmark.totalValue} | ${benchmark.totalCost} |\n\n` +
    `${status}\n`;
}
