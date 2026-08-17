import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Download, FileText, Eye, Loader2, Search, FileDown, Share2, ShieldCheck } from 'lucide-react';
import { api, getToken } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';
import { shareOrDownloadBlob } from '../services/shareFile.js';
import { isNativeApp, nativeAnalyses } from '../services/nativeBridge.js';

// Both native apps' local SQLite copies use camelCase fields (see
// desktop/db/analysesRepo.js / client/src/mobile/db/analysesRepo.js);
// HistoryView (and the rest of the app) expect the same snake_case shape
// the server's /api/history returns.
function localRecordToHistoryJson(row) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    ai_provider: row.aiProvider,
    created_at: row.createdAt,
    preview: (row.content || '').slice(0, 200),
  };
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function AuditPanel({ record, loading }) {
  if (loading) {
    return <div className="text-xs text-gold/50 py-3">Audit information is loading…</div>;
  }
  if (!record) {
    return <div className="text-xs text-gold/40 py-3">No audit record is available for this analysis.</div>;
  }

  const quantum = record.evidence?.quantum || record.evidence?.fraud || record.evidence?.optimizer;
  const rows = [
    ['AI provider', record.ai_provider || '—'],
    ['Model', record.model_name || '—'],
    ['Prompt version', record.prompt_version || '—'],
    ['Data source', record.provenance?.source || record.provenance?.type || '—'],
    ['Data quality', record.data_quality?.level ? `${record.data_quality.level} (${record.data_quality.score ?? '—'}/100)` : '—'],
    ['Classification', record.data_classification || '—'],
    ['Analysis duration', record.duration_ms ? `${record.duration_ms} ms` : '—'],
    ['Quantum backend', quantum?.backend || 'Not used'],
    ['Quantum shots', quantum?.shots || '—'],
    ['Created', record.created_at ? new Date(record.created_at).toLocaleString() : '—'],
  ];

  return (
    <div className="mt-4 border border-gold/20 rounded-lg bg-black/15 p-4">
      <div className="flex items-center gap-2 mb-3 text-gold">
        <ShieldCheck className="w-4 h-4" />
        <span className="text-xs tracking-[0.18em] uppercase">Analysis Audit</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 border-b border-gold/10 py-1.5 text-xs">
            <span className="text-gold/45">{label}</span>
            <span className="text-gold/85 text-right break-all">{String(value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs leading-relaxed text-gold/40">
        This panel records how the analysis was produced. It is an audit trail, not a user-facing comparison between AI, classical and quantum engines.
      </div>
    </div>
  );
}

export default function HistoryView({ showTitle = true }) {
  const { t } = useLang();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [auditRecord, setAuditRecord] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  useEffect(() => {
    // Native apps read their own local SQLite copy first (kept current by
    // the sync engine's push/pull) so the report list is available with no
    // network at all — see desktop/sync/engine.js / client/src/mobile/sync/engine.js.
    const listing = isNativeApp
      ? nativeAnalyses.list().then((rows) => (rows || []).map(localRecordToHistoryJson))
      : api.historyList();
    listing
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(items.map((i) => i.category).filter(Boolean)))],
    [items]
  );

  // Category ids (e.g. "savunma", "bddk") are stored/filtered on as-is, but
  // displayed via the per-language cat_* keys already in translations.<lang>
  // (falls back to the raw id if a category has no translated label).
  const categoryLabel = (c) => {
    if (c === 'all') return t('historyAllCategories');
    const key = `cat_${c.replace(/-/g, '_')}`;
    const label = t(key);
    return label === key ? c : label;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title?.toLowerCase().includes(q) ||
        item.preview?.toLowerCase().includes(q) ||
        item.category?.toLowerCase().includes(q)
      );
    });
  }, [items, query, category]);

  const loadAudit = async (id) => {
    setAuditLoading(true);
    setAuditRecord(null);
    try {
      const token = getToken();
      const response = await fetch(`/api/v1/platform/decisions/${id}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!response.ok) return;
      const data = await response.json();
      setAuditRecord(data.record || null);
    } catch {
      setAuditRecord(null);
    } finally {
      setAuditLoading(false);
    }
  };

  const view = async (id) => {
    try {
      const a = isNativeApp
        ? localRecordToHistoryJson(await nativeAnalyses.get(id))
        : await api.historyGet(id);
      setSelected(a);
      if (!isNativeApp) loadAudit(id); // audit trail is a cloud-only decision-intelligence feature
    } catch (e) {
      alert(`${t('errorPrefix')}: ${e.message}`);
    }
  };

  const closeSelected = () => {
    setSelected(null);
    setAuditRecord(null);
    setAuditLoading(false);
  };

  const download = async (id) => {
    try {
      const { blob, filename } = await api.historyDownloadBlob(id);
      triggerDownload(blob, filename || `ANATOLIA-Q_${id}.docx`);
    } catch (e) {
      alert(`${t('errorPrefix')}: ${e.message}`);
    }
  };

  const downloadPdf = async (id) => {
    try {
      const { blob, filename } = await api.historyDownloadPdfBlob(id);
      triggerDownload(blob, filename || `ANATOLIA-Q_${id}.pdf`);
    } catch (e) {
      alert(`${t('errorPrefix')}: ${e.message}`);
    }
  };

  const share = async (id, title) => {
    try {
      const { blob, filename } = await api.historyDownloadPdfBlob(id);
      await shareOrDownloadBlob(blob, filename || `ANATOLIA-Q_${id}.pdf`, 'application/pdf', title || 'ANATOLIA-Q Raporu');
    } catch (e) {
      alert(`${t('errorPrefix')}: ${e.message}`);
    }
  };

  return (
    <div className="max-w-6xl mx-auto">
      {showTitle && (
        <h2 className="text-2xl font-display text-gold tracking-widest mb-6">{t('pastAnalyses')}</h2>
      )}

      {!loading && items.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-gold/40 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('historySearchPh')} className="w-full bg-navy-light/70 border border-gold/20 rounded pl-8 pr-3 py-2 text-sm text-gold placeholder:text-gold/30 focus:border-gold/50 outline-none" />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="bg-navy-light/70 border border-gold/20 rounded px-3 py-2 text-sm text-gold outline-none focus:border-gold/50">
            {categories.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 text-gold animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-gold/40"><FileText className="w-12 h-12 mx-auto mb-3" />{t('noHistory')}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gold/40"><Search className="w-12 h-12 mx-auto mb-3" />{t('historyNoResults')}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filtered.map((item) => (
            <motion.div key={item.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-navy-light/70 border border-gold/20 hover:border-gold/50 rounded-lg p-4 transition">
              <div className="flex items-start justify-between mb-2">
                <div className="flex-1">
                  <div className="text-xs tracking-[0.3em] uppercase text-gold/50 mb-1">{categoryLabel(item.category)} · {new Date(item.created_at).toLocaleString(t('locale'))}</div>
                  <h3 className="text-gold font-display tracking-wide leading-tight">{item.title}</h3>
                  <p className="text-xs text-gold/60 mt-2 line-clamp-2">{item.preview?.replace(/[#*]/g, '')}...</p>
                  <div className="text-xs text-gold/40 mt-2">{item.ai_provider}</div>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => view(item.id)} className="flex-1 border border-gold/40 text-gold px-3 py-1.5 rounded text-xs tracking-widest hover:bg-gold/10 flex items-center justify-center gap-2"><Eye className="w-3 h-3" /> {t('view')}</button>
                <button onClick={() => download(item.id)} className="flex-1 btn-gold px-3 py-1.5 rounded text-xs tracking-widest flex items-center justify-center gap-2"><Download className="w-3 h-3" /> {t('download')}</button>
                <button onClick={() => downloadPdf(item.id)} title={t('historyDownloadPdfTitle')} className="border border-gold/40 text-gold px-2.5 py-1.5 rounded text-xs tracking-widest hover:bg-gold/10 flex items-center justify-center"><FileDown className="w-3 h-3" /></button>
                <button onClick={() => share(item.id, item.title)} title={t('share')} className="border border-gold/40 text-gold px-2.5 py-1.5 rounded text-xs tracking-widest hover:bg-gold/10 flex items-center justify-center"><Share2 className="w-3 h-3" /></button>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {selected && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 bg-black/80 backdrop-blur p-4 flex items-center justify-center" onClick={closeSelected}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} onClick={(e) => e.stopPropagation()} className="bg-navy-light gold-glow-strong rounded-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-gold/30 flex items-center justify-between">
              <div><div className="text-xs uppercase tracking-widest text-gold/50">{categoryLabel(selected.category)}</div><h3 className="text-gold font-display tracking-wide">{selected.title}</h3></div>
              <button onClick={closeSelected} className="text-gold/60 hover:text-gold text-2xl" aria-label={t('close') || 'Kapat'}>✕</button>
            </div>
            <div className="flex-1 overflow-auto p-6 report-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{selected.content}</ReactMarkdown>
              <AuditPanel record={auditRecord} loading={auditLoading} />
            </div>
            <div className="p-3 border-t border-gold/30 flex justify-end gap-2">
              <button onClick={() => share(selected.id, selected.title)} className="border border-gold/40 text-gold px-4 py-2 rounded text-xs tracking-widest flex items-center gap-2 hover:bg-gold/10"><Share2 className="w-4 h-4" /> {t('share')}</button>
              <button onClick={() => downloadPdf(selected.id)} className="border border-gold/40 text-gold px-4 py-2 rounded text-xs tracking-widest flex items-center gap-2 hover:bg-gold/10"><FileDown className="w-4 h-4" /> {t('historyDownloadPdfTitle')}</button>
              <button onClick={() => download(selected.id)} className="btn-gold px-4 py-2 rounded text-xs tracking-widest flex items-center gap-2"><Download className="w-4 h-4" /> {t('downloadDocxBtn')}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
