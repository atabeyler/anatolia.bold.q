/**
 * Pluggable transaction data-source layer for BDDK/BTK fraud analysis.
 *
 * The fraud-detection pipeline (fraudDetection.js -> quantum/fraud_detection.py)
 * only cares about receiving an array of
 *   { id, amount, hour, frequency, newCounterparty, crossBorder }
 * records — it has no opinion on where they came from. Today the only
 * implemented source is a user-uploaded CSV/XLSX file (parseTransactionFile
 * below). A future live source — a core-banking API, a BDDK RAAS export
 * feed, a BTK CDR (call-detail-record) export — only needs to produce the
 * same shape (return { transactions, warnings }) to plug into the exact
 * same downstream pipeline unchanged.
 */
import { normalizeHeader, findColumn, toBool01, toNumber, extractHour, readSheetRows } from './tableParsing.js';

// Mirrors MAX_TRANSACTIONS in fraudDetection.js -- upload cap has to be at
// least as large or a bigger file just gets truncated a step earlier than
// the fraud-detection layer's own cap.
const MAX_ROWS = 3000;

const COLUMN_ALIASES = {
  amount: ['tutar', 'amount', 'miktar', 'tutar (tl)', 'işlem tutarı', 'islem tutari'],
  hour: ['saat', 'hour', 'saat (0-23)'],
  timestamp: ['tarih', 'date', 'zaman', 'timestamp', 'islem tarihi', 'işlem tarihi'],
  frequency: ['sıklık', 'siklik', 'frequency', 'adet', 'işlem sayısı', 'islem sayisi'],
  newCounterparty: ['yeni taraf', 'yeni taraf (0/1)', 'new counterparty', 'yeni_taraf'],
  crossBorder: ['sınır ötesi', 'sinir otesi', 'sınır ötesi (0/1)', 'cross border', 'yurtdışı', 'yurtdisi'],
  id: ['işlem id', 'islem id', 'id', 'txn', 'transaction id'],
};

function findTxCol(headers, field) {
  return findColumn(headers, COLUMN_ALIASES[field]);
}

/**
 * @param {Buffer} buffer
 * @param {string} filename
 * @returns {{ transactions: Array, warnings: string[] } | null}
 *          null when the file isn't a recognizable transaction table at all.
 */
export function parseTransactionFile(buffer, filename) {
  const name = (filename || '').toLowerCase();
  if (!/\.(csv|xlsx|xls)$/.test(name)) return null;

  let rows;
  try {
    rows = readSheetRows(buffer);
  } catch {
    return null;
  }
  if (!rows.length) return null;

  const headers = rows[0].map(normalizeHeader);
  const allDataRows = rows.slice(1).filter((r) => r.some((c) => String(c).trim() !== ''));
  const dataRows = allDataRows.slice(0, MAX_ROWS);
  if (!dataRows.length) return null;

  const idCol = findTxCol(headers, 'id');
  const amountCol = findTxCol(headers, 'amount');
  const hourCol = findTxCol(headers, 'hour');
  const timestampCol = findTxCol(headers, 'timestamp');
  const freqCol = findTxCol(headers, 'frequency');
  const newCounterpartyCol = findTxCol(headers, 'newCounterparty');
  const crossBorderCol = findTxCol(headers, 'crossBorder');

  // Require at least the amount column plus one of hour/timestamp to
  // consider this a genuine transaction table rather than an unrelated CSV.
  if (amountCol === -1 || (hourCol === -1 && timestampCol === -1)) return null;

  const warnings = [];
  if (freqCol === -1) warnings.push('Sıklık sütunu bulunamadı — varsayılan 1 kullanıldı.');
  if (newCounterpartyCol === -1) warnings.push('Yeni Taraf sütunu bulunamadı — varsayılan 0 kullanıldı.');
  if (crossBorderCol === -1) warnings.push('Sınır Ötesi sütunu bulunamadı — varsayılan 0 kullanıldı.');
  if (allDataRows.length > MAX_ROWS) warnings.push(`Dosyada ${allDataRows.length} kayıt var, ilk ${MAX_ROWS} kayıt işlendi.`);

  const transactions = dataRows.map((row, i) => ({
    id: idCol !== -1 && row[idCol] ? String(row[idCol]) : `TXN-${i + 1}`,
    amount: toNumber(row[amountCol]),
    hour: hourCol !== -1 ? toNumber(row[hourCol]) : extractHour(row[timestampCol]),
    frequency: freqCol !== -1 ? toNumber(row[freqCol]) : 1,
    newCounterparty: newCounterpartyCol !== -1 ? toBool01(row[newCounterpartyCol]) : 0,
    crossBorder: crossBorderCol !== -1 ? toBool01(row[crossBorderCol]) : 0,
  }));

  return { transactions, warnings };
}
