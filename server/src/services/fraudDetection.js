/** ANATOLIA-Q Fraud/AML Detection Service — 13Q behavioral experiment. */
import path from 'path';
import { fileURLToPath } from 'url';
import { withIbmTimeout } from '../lib/quantumTimeout.js';
import { runQuantumWorker } from './quantumProcess.js';
import { enrichBehavioralFeatures } from './behavioralFeatures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.join(__dirname, '../../quantum/fraud_detection_13q.py');
const TIMEOUT_MS = withIbmTimeout(180000);
const MAX_TRANSACTIONS = 3000;

export async function computeFraudRiskScores(transactions, opts = {}) {
  if (!Array.isArray(transactions) || transactions.length < 3) return null;
  const originalCount = transactions.length;
  const truncated = originalCount > MAX_TRANSACTIONS;
  const sliced = transactions.slice(0, MAX_TRANSACTIONS);
  const enriched = enrichBehavioralFeatures(sliced);
  const payload = { transactions: enriched, skipHardware: !!opts.skipHardware };
  const result = await runQuantumWorker({ mode:'fraud', scriptPath:SCRIPT_PATH, payload, timeoutMs:TIMEOUT_MS, label:'FraudDetection13Q' });
  if (result && truncated) { result.truncated=true; result.originalCount=originalCount; }
  return result;
}

export function buildFraudHardwareSection(hw) {
  if (!hw) return '';
  return `\n### Gerçek Donanım Doğrulaması\nBackend: ${hw.backend || '—'}\n`;
}

export async function verifyFraudHardwareAsync(transactions) {
  const result = await computeFraudRiskScores(transactions,{skipHardware:false});
  return result ? {hardwareVerification:result.hardwareVerification||null,ibmDiagnostic:result.ibmDiagnostic||null} : null;
}

export function mergeFraudResults(fraudResult) {
  if (!fraudResult?.transactions?.length) return null;
  const flagged=fraudResult.transactions.filter(t=>t.flagged);
  const rows=fraudResult.transactions.slice(0,15).map(t=>`| ${t.id} | ${t.amount} | ${t.hour} | ${t.frequency} | ${t.txCount10m ?? 0} | ${t.txCount1h ?? 0} | ${t.amountDeviation ?? 0} | ${t.riskScore} | ${t.flagged?'🚩 İŞARETLENDİ':'—'} |`).join('\n');
  return `\n## KUANTUM ANOMALİ TESPİTİ DOĞRULAMASI\n${fraudResult.transactionCount} işlem, **${fraudResult.qubits}-kübit** davranışsal feature-map ile değerlendirildi. K=${fraudResult.thresholdK ?? 1.07}.\n\n**${flagged.length} / ${fraudResult.transactionCount} kayıt işaretlendi.**\n\n| İşlem ID | Tutar | Saat | Sıklık | 10dk Tx | 1sa Tx | Tutar Sapması | Risk | Durum |\n|---|---:|---:|---:|---:|---:|---:|---:|---|\n${rows}\n\n${buildFraudClassicalBenchmarkSection(fraudResult.classicalBenchmark)}`;
}

export function buildFraudClassicalBenchmarkSection(b) {
  if (!b) return '';
  return `### Klasik Anomali Tespiti Karşılaştırması\nKlasik işaretlenen: ${b.flaggedCount}; karar uyumu: %${b.agreementPercent}.\n`;
}
