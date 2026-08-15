/**
 * ANATOLIA-Q Fraud/AML Detection Service
 * Scores transaction records generated for a BDDK/BTK analysis on a real
 * quantum kernel anomaly detector (Qiskit statevector fidelity) instead of
 * relying solely on the LLM's narrative judgment. Spawns
 * server/quantum/fraud_detection.py.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { runQuantumWorker } from './quantumProcess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../quantum/fraud_detection.py');
// When IBM credentials are configured, detect() also runs a swap-test
// verification on real hardware (see fraud_detection.py) -- the subprocess
// timeout has to cover that wait too, or it gets SIGKILLed mid-computation.
const TIMEOUT_MS = withIbmTimeout(20000);
// Mirrors MAX_INPUT_TRANSACTIONS in fraud_detection.py -- the overall
// accepted input size. Above MAX_KERNEL_TRANSACTIONS (60, enforced
// Python-side) the script itself pre-filters down to the most
// anomalous-looking records via the cheap classical detector before
// running the O(n^2) quantum kernel, instead of this cap silently
// dropping everything past a fixed prefix.
const MAX_TRANSACTIONS = 300;

/**
 * @param {Array<{id:string, amount:number, hour:number, frequency:number, newCounterparty:number, crossBorder:number}>} transactions
 * @param {{skipHardware?: boolean}} [opts] - skipHardware=true returns the fast
 *        simulator-only result so the request/response path isn't blocked on
 *        the IBM queue wait; see verifyFraudHardwareAsync for the deferred run.
 * @returns {Promise<{backend:string, qubits:number, circuitDepth:number, circuitDiagram:string, transactions:Array}|null>}
 *          Returns null if the Python process fails (no python/qiskit, timeout, too few records, etc.)
 *          — the caller should then proceed with the LLM's narrative report unscored.
 */
export async function computeFraudRiskScores(transactions, opts = {}) {
  if (!Array.isArray(transactions) || transactions.length < 3) return null;

  const originalCount = transactions.length;
  const truncated = originalCount > MAX_TRANSACTIONS;
  const payload = { transactions: transactions.slice(0, MAX_TRANSACTIONS), skipHardware: !!opts.skipHardware };

  const result = await runQuantumWorker({
    mode: 'fraud', scriptPath: SCRIPT_PATH, payload, timeoutMs: TIMEOUT_MS, label: 'FraudDetection',
  });
  if (result && truncated) {
    result.truncated = true;
    result.originalCount = originalCount;
  }
  return result;
}

/**
 * Builds the "real hardware" markdown table on its own, so a hardware
 * verification result that arrives later (see verifyFraudHardwareAsync) can
 * be appended to an already-saved report without recomputing the rest of
 * mergeFraudResults' output.
 */
export function buildFraudHardwareSection(hw) {
  if (!hw) return '';
  return `\n### Gerçek Donanım Doğrulaması\n` +
    `En yüksek riskli kayıt (**${hw.pair.a}**) ile en tipik kayıt (**${hw.pair.b}**) arasındaki kuantum çakışma (fidelity) değeri, ` +
    `bir swap-test devresiyle gerçek IBM Quantum donanımında (**${hw.backend}**, ${hw.shots} shot) bağımsız olarak ölçülmüştür ` +
    `(bu ölçüm yukarıdaki risk skorlarını etkilemez — donanım gürültüsü nedeniyle, işaretleme kararı her zaman kesin/deterministik simülatör sonucuna dayanır):\n\n` +
    `| Kaynak | Ölçülen Fidelity |\n|---|---|\n` +
    `| Kesin (statevector simülatör) | ${hw.exactFidelity} |\n` +
    `| Gerçek donanım ölçümü | ${hw.measuredFidelity} |\n`;
}

/**
 * Re-runs the fraud kernel in the background to get the real-hardware
 * verification lane, without making the original request wait on the IBM
 * queue (see computeFraudRiskScores' skipHardware option). The risk-score
 * portion of this second run is discarded — only hardwareVerification/
 * ibmDiagnostic are used.
 */
export async function verifyFraudHardwareAsync(transactions) {
  const result = await computeFraudRiskScores(transactions, { skipHardware: false });
  return result ? { hardwareVerification: result.hardwareVerification || null, ibmDiagnostic: result.ibmDiagnostic || null } : null;
}

/**
 * Produces the markdown verification section (flagged-transaction table +
 * the real feature-map circuit diagram) to append to the report.
 */
export function mergeFraudResults(fraudResult) {
  if (!fraudResult?.transactions?.length) return null;

  const flagged = fraudResult.transactions.filter((t) => t.flagged);
  const rows = fraudResult.transactions
    .slice(0, 15)
    .map((t) => `| ${t.id} | ${t.amount} | ${t.hour} | ${t.frequency} | ${t.newCounterparty ? 'Evet' : 'Hayır'} | ${t.crossBorder ? 'Evet' : 'Hayır'} | ${t.riskScore} | ${t.flagged ? '🚩 İŞARETLENDİ' : '—'} |`)
    .join('\n');

  const sourceNote = fraudResult.dataSource === 'uploaded'
    ? 'Bu kayıtlar kullanıcı tarafından yüklenen bir dosyadan (CSV/XLSX) çıkarılan GERÇEK işlem verileridir.'
    : 'Gerçek veri sağlanmadığından bu kayıtlar senaryoyu temsil eden ÖRNEK/yapay veridir (bkz. yukarıdaki üretim notu).';

  const truncationNote = fraudResult.truncated
    ? ` **Not:** Yüklenen/üretilen ${fraudResult.originalCount} kayıttan yalnızca ilk ${fraudResult.transactionCount} tanesi (girdi üst siniri nedeniyle) değerlendirmeye alınmıştır.`
    : '';

  const prefilterNote = fraudResult.prefiltered
    ? ` **Not:** ${fraudResult.transactionCount + fraudResult.excludedByPrefilter} kayıt arasından, hızlı bir klasik ön-eleme (anomali skoruna göre) ile en riskli görünen ${fraudResult.transactionCount} kaydı seçilip kuantum çekirdek ile taranmıştır (kernel'in O(n²) karmaşıklığı nedeniyle) — ilk N kayıt yerine en olası anomalileri önceliklendirir.`
    : '';

  const hardwareSection = buildFraudHardwareSection(fraudResult.hardwareVerification);
  const benchmarkSection = buildFraudClassicalBenchmarkSection(fraudResult.classicalBenchmark);

  const note = `\n## KUANTUM ANOMALİ TESPİTİ DOĞRULAMASI\n` +
    `${fraudResult.transactionCount} işlem kaydı, ${fraudResult.qubits}-kübitlik bir öznitelik-haritalama (feature-map) devresine kodlanıp ` +
    `her işlem çifti arasındaki kuantum çakışma (fidelity) değeri hesaplanarak bir kuantum çekirdek (kernel) matrisi oluşturulmuştur.${truncationNote}${prefilterNote} ` +
    `Bir işlemin risk skoru, bu kuantum uzayında diğer tüm işlemlere olan ortalama benzerliğinin tersidir — ortalamadan istatistiksel olarak sapan işlemler işaretlenmiştir. ` +
    `${sourceNote}\n` +
    `Backend: ${fraudResult.backend} (yerel kuantum devre simülatörü, devre derinliği ${fraudResult.circuitDepth} — gerçek banka/operatör sistemlerine canlı bağlantı yoktur, bu bölüm sadece sağlanan/üretilen kayıtları puanlar).\n\n` +
    `**${flagged.length} / ${fraudResult.transactionCount} kayıt işaretlendi.**\n\n` +
    `| İşlem ID | Tutar (TL) | Saat | Sıklık | Yeni Taraf | Sınır Ötesi | Risk Skoru | Durum |\n|---|---|---|---|---|---|---|---|\n${rows}\n\n` +
    `### Öznitelik-Haritalama Devresi (en yüksek riskli kayıt)\n\`\`\`\n${fraudResult.circuitDiagram}\n\`\`\`\n${hardwareSection}${benchmarkSection}`;

  return note;
}

/**
 * Compares the quantum kernel's flagged set against a classical (Euclidean
 * distance-from-centroid) anomaly detector run on the same normalized
 * features (see classical_anomaly_detection() in fraud_detection.py), so
 * the report shows how often the two methods agree instead of asserting
 * the quantum result in isolation.
 */
export function buildFraudClassicalBenchmarkSection(benchmark) {
  if (!benchmark) return '';
  return `\n### Klasik Anomali Tespiti Karşılaştırması\n` +
    `Aynı normalize edilmiş öznitelikler üzerinde klasik bir mesafe-tabanlı (merkezden Öklid uzaklığı, ortalama+std eşiği) anomali tespit yöntemi de çalıştırılmış ve kuantum çekirdek sonucuyla karşılaştırılmıştır:\n\n` +
    `| Yöntem | İşaretlenen Kayıt |\n|---|---|\n` +
    `| Kuantum çekirdek | ${benchmark.agreementCount + benchmark.quantumOnlyFlags} |\n` +
    `| Klasik (${benchmark.method}) | ${benchmark.flaggedCount} |\n\n` +
    `**Uyum oranı: %${benchmark.agreementPercent}** (${benchmark.agreementCount} kayıtta aynı karar) — ` +
    `yalnızca kuantumun işaretlediği: ${benchmark.quantumOnlyFlags}, yalnızca klasik yöntemin işaretlediği: ${benchmark.classicalOnlyFlags}.\n`;
}
