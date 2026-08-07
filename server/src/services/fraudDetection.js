/**
 * ANATOLIA-Q Fraud/AML Detection Service
 * Scores transaction records generated for a BDDK/BTK analysis on a real
 * quantum kernel anomaly detector (Qiskit statevector fidelity) instead of
 * relying solely on the LLM's narrative judgment. Spawns
 * server/quantum/fraud_detection.py.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../lib/logger.js';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { resolveQuantumCommand } from './quantumProcess.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../quantum/fraud_detection.py');
// When IBM credentials are configured, detect() also runs a swap-test
// verification on real hardware (see fraud_detection.py) -- the subprocess
// timeout has to cover that wait too, or it gets SIGKILLed mid-computation.
const TIMEOUT_MS = withIbmTimeout(20000);
// Mirrors MAX_TRANSACTIONS in fraud_detection.py — the exact pairwise
// kernel is O(n^2), so an unbounded transaction table could run past
// TIMEOUT_MS on every request.
const MAX_TRANSACTIONS = 60;

/**
 * @param {Array<{id:string, amount:number, hour:number, frequency:number, newCounterparty:number, crossBorder:number}>} transactions
 * @param {{skipHardware?: boolean}} [opts] - skipHardware=true returns the fast
 *        simulator-only result so the request/response path isn't blocked on
 *        the IBM queue wait; see verifyFraudHardwareAsync for the deferred run.
 * @returns {Promise<{backend:string, qubits:number, circuitDepth:number, circuitDiagram:string, transactions:Array}|null>}
 *          Returns null if the Python process fails (no python/qiskit, timeout, too few records, etc.)
 *          — the caller should then proceed with the LLM's narrative report unscored.
 */
export function computeFraudRiskScores(transactions, opts = {}) {
  if (!Array.isArray(transactions) || transactions.length < 3) return Promise.resolve(null);

  const originalCount = transactions.length;
  const truncated = originalCount > MAX_TRANSACTIONS;
  const payload = JSON.stringify({ transactions: transactions.slice(0, MAX_TRANSACTIONS), skipHardware: !!opts.skipHardware });

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let proc;
    try {
      const { bin, args } = resolveQuantumCommand('fraud', SCRIPT_PATH);
      proc = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) {
      logger.warn({ err }, '[FraudDetection] Failed to start Python process');
      return finish(null);
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      logger.warn('[FraudDetection] Timed out — proceeding without risk scores');
      proc.kill('SIGKILL');
      finish(null);
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => { out += d; });
    proc.stderr.on('data', (d) => { err += d; });
    proc.on('error', (e) => {
      clearTimeout(timer);
      logger.warn({ err: e }, '[FraudDetection] Process error');
      finish(null);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (settled) return;
      if (code !== 0) {
        logger.warn({ code, stderr: err.trim().slice(0, 300) }, '[FraudDetection] Kernel process failed');
        return finish(null);
      }
      try {
        const parsed = JSON.parse(out);
        if (parsed.error) {
          logger.warn({ kernelError: parsed.error }, '[FraudDetection] Kernel error');
          return finish(null);
        }
        if (truncated) {
          parsed.truncated = true;
          parsed.originalCount = originalCount;
        }
        finish(parsed);
      } catch (e) {
        logger.warn({ err: e }, '[FraudDetection] Failed to parse output');
        finish(null);
      }
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
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
    ? ` **Not:** Yüklenen/üretilen ${fraudResult.originalCount} kayıttan yalnızca ilk ${fraudResult.transactionCount} tanesi (kernel'in O(n²) karmaşıklığı nedeniyle) taranmıştır.`
    : '';

  const hardwareSection = buildFraudHardwareSection(fraudResult.hardwareVerification);

  const note = `\n## KUANTUM ANOMALİ TESPİTİ DOĞRULAMASI\n` +
    `${fraudResult.transactionCount} işlem kaydı, ${fraudResult.qubits}-kübitlik bir öznitelik-haritalama (feature-map) devresine kodlanıp ` +
    `her işlem çifti arasındaki kuantum çakışma (fidelity) değeri hesaplanarak bir kuantum çekirdek (kernel) matrisi oluşturulmuştur.${truncationNote} ` +
    `Bir işlemin risk skoru, bu kuantum uzayında diğer tüm işlemlere olan ortalama benzerliğinin tersidir — ortalamadan istatistiksel olarak sapan işlemler işaretlenmiştir. ` +
    `${sourceNote}\n` +
    `Backend: ${fraudResult.backend} (yerel kuantum devre simülatörü, devre derinliği ${fraudResult.circuitDepth} — gerçek banka/operatör sistemlerine canlı bağlantı yoktur, bu bölüm sadece sağlanan/üretilen kayıtları puanlar).\n\n` +
    `**${flagged.length} / ${fraudResult.transactionCount} kayıt işaretlendi.**\n\n` +
    `| İşlem ID | Tutar (TL) | Saat | Sıklık | Yeni Taraf | Sınır Ötesi | Risk Skoru | Durum |\n|---|---|---|---|---|---|---|---|\n${rows}\n\n` +
    `### Öznitelik-Haritalama Devresi (en yüksek riskli kayıt)\n\`\`\`\n${fraudResult.circuitDiagram}\n\`\`\`\n${hardwareSection}`;

  return note;
}
