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
import * as XLSX from 'xlsx';

const MAX_ROWS = 500;

const COLUMN_ALIASES = {
  amount: ['tutar', 'amount', 'miktar', 'tutar (tl)', 'işlem tutarı', 'islem tutari'],
  hour: ['saat', 'hour', 'saat (0-23)'],
  timestamp: ['tarih', 'date', 'zaman', 'timestamp', 'islem tarihi', 'işlem tarihi'],
  frequency: ['sıklık', 'siklik', 'frequency', 'adet', 'işlem sayısı', 'islem sayisi'],
  newCounterparty: ['yeni taraf', 'yeni taraf (0/1)', 'new counterparty', 'yeni_taraf'],
  crossBorder: ['sınır ötesi', 'sinir otesi', 'sınır ötesi (0/1)', 'cross border', 'yurtdışı', 'yurtdisi'],
  id: ['işlem id', 'islem id', 'id', 'txn', 'transaction id'],
};

function normalizeHeader(h) {
  return String(h ?? '').trim().toLowerCase();
}

function findColumn(headers, field) {
  const aliases = COLUMN_ALIASES[field];
  return headers.findIndex((h) => aliases.includes(normalizeHeader(h)));
}

function toBool01(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (['1', 'evet', 'yes', 'true', 'var'].includes(s)) return 1;
  if (['0', 'hayır', 'hayir', 'no', 'false', 'yok', ''].includes(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? 1 : 0;
}

function toNumber(v) {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function extractHour(timestampValue) {
  if (typeof timestampValue === 'number') {
    // XLSX serial date/time
    const parsed = XLSX.SSF.parse_date_code(timestampValue);
    if (parsed?.H !== undefined) return parsed.H;
  }
  const d = new Date(timestampValue);
  return Number.isNaN(d.getTime()) ? 0 : d.getHours();
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
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  } catch {
    return null;
  }
  if (!rows.length) return null;

  const headers = rows[0].map(normalizeHeader);
  const dataRows = rows.slice(1, 1 + MAX_ROWS).filter((r) => r.some((c) => String(c).trim() !== ''));
  if (!dataRows.length) return null;

  const idCol = findColumn(headers, 'id');
  const amountCol = findColumn(headers, 'amount');
  const hourCol = findColumn(headers, 'hour');
  const timestampCol = findColumn(headers, 'timestamp');
  const freqCol = findColumn(headers, 'frequency');
  const newCounterpartyCol = findColumn(headers, 'newCounterparty');
  const crossBorderCol = findColumn(headers, 'crossBorder');

  // Require at least the amount column plus one of hour/timestamp to
  // consider this a genuine transaction table rather than an unrelated CSV.
  if (amountCol === -1 || (hourCol === -1 && timestampCol === -1)) return null;

  const warnings = [];
  if (freqCol === -1) warnings.push('Sıklık sütunu bulunamadı — varsayılan 1 kullanıldı.');
  if (newCounterpartyCol === -1) warnings.push('Yeni Taraf sütunu bulunamadı — varsayılan 0 kullanıldı.');
  if (crossBorderCol === -1) warnings.push('Sınır Ötesi sütunu bulunamadı — varsayılan 0 kullanıldı.');

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
