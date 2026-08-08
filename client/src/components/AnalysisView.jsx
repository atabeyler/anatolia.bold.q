import React, { useState } from 'react';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Sparkles, Download, Loader2, Atom,
  BarChart3, ArrowLeft, Share2, FileDown
} from 'lucide-react';
import { CATEGORIES } from './CategorySidebar.jsx';
import { api } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';
import { reportTitleExamples } from '../services/i18n.js';
import { base64ToBlob, shareOrDownloadBlob } from '../services/shareFile.js';
import VoiceButton from './VoiceButton.jsx';
import ConsultChat from './ConsultChat.jsx';
import FileAttach from './FileAttach.jsx';
import { ScenarioComparisonChart, FraudRiskChart, OptimizerChart } from './QuantumCharts.jsx';

export default function AnalysisView({ category, onCategoryChange }) {
  const { t, lang } = useLang();
  const [title, setTitle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [documentContexts, setDocumentContexts] = useState([]); // [{ filename, text }]
  const [imageFiles, setImageFiles] = useState([]);
  const [realTransactions, setRealTransactions] = useState(null); // { filename, transactions, warnings }
  const [realScenarios, setRealScenarios] = useState(null); // { filename, scenarios, warnings }
  const [realOptimization, setRealOptimization] = useState(null); // { filename, items, budgetPercent, warnings }
  const [quantumMode, setQuantumMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingScenario, setLoadingScenario] = useState(null);
  const [result, setResult] = useState(null);
  const [scenarioResult, setScenarioResult] = useState(null);
  const [error, setError] = useState('');

  const cat = CATEGORIES.find(c => c.id === category);
  const isConsult = category === 'danisma';
  const isFraudCategory = category === 'bddk' || category === 'btk';
  const categoryLabel = cat ? t(cat.nameKey) : '';
  const titlePlaceholder = reportTitleExamples[lang]?.[category] || t('reportTitlePh');

  const handleAIFile = (file) => {
    if (!file) {
      setRealTransactions(null);
      setRealScenarios(null);
      setRealOptimization(null);
      return;
    }
    if (file.type === 'image') {
      setImageFiles((prev) => [...prev, file]);
      return;
    }
    if (file.type === 'transactions') {
      setRealTransactions({ filename: file.filename, transactions: file.transactions, warnings: file.warnings || [] });
      return;
    }
    if (file.type === 'scenarios') {
      setRealScenarios({ filename: file.filename, scenarios: file.scenarios, warnings: file.warnings || [] });
      return;
    }
    if (file.type === 'optimization') {
      setRealOptimization({ filename: file.filename, items: file.items, budgetPercent: file.budgetPercent, warnings: file.warnings || [] });
      return;
    }
    if (file.type === 'text') {
      setDocumentContexts((prev) => [...prev, { filename: file.filename || 'Belge', text: file.text }]);
      return;
    }
    setDocumentContexts((prev) => [...prev, { filename: file.filename || 'Dosya', text: `[Eklenen dosya: ${file.filename}]\n${window.location.origin}${file.url}` }]);
  };

  const removeImageAt = (idx) => setImageFiles((prev) => prev.filter((_, i) => i !== idx));
  const removeDocAt = (idx) => setDocumentContexts((prev) => prev.filter((_, i) => i !== idx));

  // Server errors are plain Turkish text by default (not routed through
  // i18n) except for a few with a machine-readable `code`, which map to a
  // properly localized message here instead of leaking raw Turkish into a
  // UI the user may have set to another language.
  const localizedError = (e) => (e.code === 'ALL_AI_PROVIDERS_FAILED' ? t('errAllProvidersFailed') : e.message);

  const generate = async () => {
    if (!prompt.trim() || !category) return;
    setLoading(true);
    setError('');
    setResult(null);
    setScenarioResult(null);

    try {
      const aiImageData = imageFiles[0] ? { base64: imageFiles[0].base64, mimetype: imageFiles[0].mimetype } : null;
      const mergedContext = documentContexts.length ? documentContexts.map((d) => d.text).join('\n\n') : null;
      const realOptimizationPayload = realOptimization ? { items: realOptimization.items, budgetPercent: realOptimization.budgetPercent } : null;
      const r = await api.generateAnalysis(category, title || prompt.slice(0, 80), prompt, quantumMode, mergedContext, aiImageData, realTransactions?.transactions || null, realScenarios?.scenarios || null, realOptimizationPayload, lang);
      setResult(r);
    } catch (e) {
      setError(localizedError(e));
    } finally {
      setLoading(false);
    }
  };

  const deepDiveScenario = async (scenario) => {
    setLoadingScenario(scenario.id);
    setScenarioResult(null);
    try {
      const r = await api.scenarioDeepDive(category, scenario.id, scenario.title, lang);
      setScenarioResult({ ...r, scenarioLabel: scenario.title });
    } catch (e) {
      setError('Senaryo analizi basarisiz: ' + localizedError(e));
    } finally {
      setLoadingScenario(null);
    }
  };

  const downloadDocx = (res = result) => {
    if (!res?.docxBase64) return;
    const blob = base64ToBlob(res.docxBase64, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ANATOLIA-Q_${category}_${Date.now()}.docx`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPdf = (res = result) => {
    if (!res?.pdfBase64) return;
    const blob = base64ToBlob(res.pdfBase64, 'application/pdf');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ANATOLIA-Q_${category}_${Date.now()}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const shareReport = (res = result) => {
    if (!res?.pdfBase64) return;
    const blob = base64ToBlob(res.pdfBase64, 'application/pdf');
    shareOrDownloadBlob(blob, `ANATOLIA-Q_${category}_${Date.now()}.pdf`, 'application/pdf', res.title || 'ANATOLIA-Q Raporu');
  };

  const reset = () => {
    setResult(null);
    setScenarioResult(null);
    setPrompt('');
    setTitle('');
    setError('');
    setDocumentContexts([]);
    setImageFiles([]);
    setRealTransactions(null);
    setRealScenarios(null);
    setRealOptimization(null);
  };

  if (!category) return <CategoryPicker onSelect={onCategoryChange} />;
  if (isConsult) return <div className="max-w-4xl mx-auto"><ConsultChat /></div>;

  return (
    <div className="max-w-5xl mx-auto">
      <motion.div initial={{ y: -20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
        <div className="w-12 h-12 rounded-full bg-gold/20 border border-gold flex items-center justify-center">
          {cat && <cat.icon className="w-6 h-6 text-gold" />}
        </div>
        <div>
          <h2 className="text-lg sm:text-2xl font-display text-gold tracking-widest uppercase">{categoryLabel}</h2>
        </div>
      </motion.div>

      {!result && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="bg-navy-light/70 border border-gold/30 rounded-lg p-3 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs text-gold/70 tracking-widest uppercase mb-2">{t('reportTitle')} ({categoryLabel})</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={titlePlaceholder} className="w-full bg-navy/80 border border-gold/30 rounded px-3 py-2 text-gold/90 font-serif focus:border-gold focus:outline-none" />
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-gold/40 tracking-widest uppercase">Kaynak Dosya</span>
            <FileAttach onAIFile={handleAIFile} />
            {(documentContexts.length > 0 || imageFiles.length > 0) && <span className="text-[10px] text-emerald-400 font-mono">✓ {documentContexts.length + imageFiles.length} kaynak dosya eklendi</span>}
          </div>

          {quantumMode && (
            <p className="text-[10px] text-gold/40 leading-relaxed">
              {isFraudCategory
                ? 'Gerçek işlem dökümü (CSV/Excel — "Tutar" ve "Saat"/"Tarih" sütunları gerekli) yükleyebilirsiniz; yüklenirse kuantum motoru yapay örnek kayıtlar yerine bu gerçek kayıtları puanlar.'
                : 'Gerçek senaryo verisi ("Senaryo"/"Olasılık" sütunları) veya kaynak tahsisi tablosu ("Kalem"/"Değer"/"Maliyet" sütunları) yükleyebilirsiniz; yüklenirse kuantum motoru YZ tahmini yerine bu gerçek verileri kullanır.'}
            </p>
          )}

          {realTransactions && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 rounded px-2 py-1 font-mono">
                ✓ {realTransactions.transactions.length} gerçek işlem kaydı yüklendi ({realTransactions.filename})
              </span>
              <button type="button" onClick={() => setRealTransactions(null)} className="text-xs text-red-300">×</button>
              {realTransactions.warnings.map((w, i) => (
                <span key={i} className="text-[10px] text-amber-400/80">{w}</span>
              ))}
            </div>
          )}

          {realScenarios && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 rounded px-2 py-1 font-mono">
                ✓ {realScenarios.scenarios.length} gerçek senaryo yüklendi ({realScenarios.filename})
              </span>
              <button type="button" onClick={() => setRealScenarios(null)} className="text-xs text-red-300">×</button>
              {realScenarios.warnings.map((w, i) => (
                <span key={i} className="text-[10px] text-amber-400/80">{w}</span>
              ))}
            </div>
          )}

          {realOptimization && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] bg-emerald-900/30 border border-emerald-500/30 text-emerald-300 rounded px-2 py-1 font-mono">
                ✓ {realOptimization.items.length} gerçek kalem yüklendi, bütçe %{realOptimization.budgetPercent} ({realOptimization.filename})
              </span>
              <button type="button" onClick={() => setRealOptimization(null)} className="text-xs text-red-300">×</button>
              {realOptimization.warnings.map((w, i) => (
                <span key={i} className="text-[10px] text-amber-400/80">{w}</span>
              ))}
            </div>
          )}

          {imageFiles.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {imageFiles.map((img, i) => (
                <div key={`${img.filename}-${i}`} className="flex items-center gap-1 border border-gold/20 rounded px-1.5 py-1">
                  <img src={img.blobUrl} alt={img.filename} className="h-8 w-8 object-cover rounded" />
                  <button type="button" onClick={() => removeImageAt(i)} className="text-xs text-red-300">×</button>
                </div>
              ))}
            </div>
          )}

          {documentContexts.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {documentContexts.map((doc, i) => (
                <button key={`doc-${i}`} type="button" onClick={() => removeDocAt(i)} className="text-[10px] bg-cyan-900/30 border border-cyan-500/30 text-cyan-300 rounded px-2 py-1">{doc.filename} ×</button>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs text-gold/70 tracking-widest uppercase mb-2">{t('analysisTopic')} ({categoryLabel})</label>
            <div className="relative">
              <textarea value={prompt} onChange={e => setPrompt(e.target.value)} placeholder={documentContexts.length > 0 ? 'Yuklenen belgelere dayanarak analiz uret...' : t('topicPh')} rows={10} className="w-full bg-navy/80 border border-gold/30 rounded p-3 pr-14 text-gold/90 font-serif focus:border-gold focus:outline-none" />
              <div className="absolute bottom-3 right-3"><VoiceButton mode="input" onTranscript={text => setPrompt(prev => prev ? prev + ' ' + text : text)} size="sm" /></div>
            </div>
          </div>

          <div onClick={() => setQuantumMode(!quantumMode)} className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition select-none ${quantumMode ? 'bg-gold/10 border-gold/60' : 'bg-navy/40 border-gold/20 hover:border-gold/40'}`}>
            <div className={`mt-0.5 w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${quantumMode ? 'bg-gold border-gold' : 'border-gold/40'}`}>{quantumMode && <span className="text-navy text-xs font-bold">✓</span>}</div>
            <div>
              <div className="flex items-center gap-2 mb-1"><Atom className="w-4 h-4 text-gold" /><span className="text-gold font-display tracking-widest text-sm">{t('quantumMode')}</span></div>
              <p className="text-xs text-gold/60 leading-relaxed">{t(isFraudCategory ? 'quantumDescFraud' : 'quantumDesc')}</p>
            </div>
          </div>

          {error && <div className="text-crimson text-sm bg-crimson/10 border border-crimson/40 rounded p-3">⚠ {error}</div>}

          <button onClick={generate} disabled={loading || !prompt.trim()} className="w-full btn-gold py-3 rounded font-display tracking-widest text-sm disabled:opacity-50 flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />{quantumMode ? t('analyzingQuantum') : t('analyzing')}</> : <>{quantumMode ? <Atom className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}{quantumMode ? t('generateQuantum') : t('generateAnalysis')}</>}
          </button>
        </motion.div>
      )}

      {result && !scenarioResult && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {result.quantumWarning && (
            <div className="bg-amber-500/10 border border-amber-400/40 rounded-lg p-3 text-xs text-amber-300 flex items-start gap-2">
              <span>⚠️</span><span>{result.quantumWarning}</span>
            </div>
          )}
          <div className="flex items-center justify-between bg-navy-light/70 border border-gold/30 rounded-lg p-3 flex-wrap gap-2">
            <div className="text-xs text-gold/60 flex items-center gap-2">
              {result.quantumMode && <Atom className="w-3 h-3 text-gold" />}
              {result.quantum && (
                <span className="font-mono text-[10px] text-cyan-300/80" title="Qiskit Aer yerel kuantum devre simülatörü">
                  {result.quantum.backend} · {result.quantum.qubits} kübit · {result.quantum.shots} ölçüm
                </span>
              )}
              {result.fraud && (
                <span className="font-mono text-[10px] text-cyan-300/80" title="Kuantum çekirdek (kernel) anomali tespiti">
                  {result.fraud.backend} · {result.fraud.qubits} kübit · {result.fraud.flaggedCount}/{result.fraud.transactionCount} işaretlendi
                </span>
              )}
              {result.optimizer && (
                <span className="font-mono text-[10px] text-cyan-300/80" title="QAOA kaynak tahsisi optimizasyonu">
                  {result.optimizer.backend} · {result.optimizer.qubits} kübit · %{result.optimizer.totalCost}/%{result.optimizer.budgetPercent} bütçe kullanıldı
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <VoiceButton mode="output" text={result.content} size="sm" />
              <button onClick={() => downloadDocx(result)} className="btn-gold px-4 py-2 rounded text-xs tracking-widest flex items-center gap-2"><Download className="w-4 h-4" /> {t('downloadDocx')}</button>
              <button onClick={() => downloadPdf(result)} className="btn-gold px-4 py-2 rounded text-xs tracking-widest flex items-center gap-2"><FileDown className="w-4 h-4" /> {t('downloadPdf')}</button>
              <button onClick={() => shareReport(result)} className="border border-gold/40 text-gold px-4 py-2 rounded text-xs tracking-widest hover:bg-gold/10 flex items-center gap-2"><Share2 className="w-4 h-4" /> {t('share')}</button>
              <button onClick={reset} className="border border-gold/40 text-gold px-4 py-2 rounded text-xs tracking-widest hover:bg-gold/10">{t('newAnalysisBtn')}</button>
            </div>
          </div>

          {result.quantumMode && result.scenarios && result.scenarios.length > 0 && <ScenarioPanel scenarios={result.scenarios} onDeepDive={deepDiveScenario} loadingScenario={loadingScenario} t={t} />}

          {result.quantumMode && result.scenarios?.some(s => s.quantumProbability !== undefined) && <ScenarioComparisonChart scenarios={result.scenarios} />}
          {result.fraud?.transactions?.length > 0 && <FraudRiskChart transactions={result.fraud.transactions} />}
          {result.optimizer?.items?.length > 0 && <OptimizerChart items={result.optimizer.items} />}

          <div className="bg-navy-light/70 border border-gold/30 rounded-lg p-8 report-content max-h-[70vh] overflow-auto"><ReactMarkdown remarkPlugins={[remarkGfm]}>{result.content}</ReactMarkdown></div>
        </motion.div>
      )}

      {scenarioResult && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <div className="flex items-center gap-3 bg-navy-light/70 border border-gold/30 rounded-lg p-3">
            <button onClick={() => setScenarioResult(null)} className="text-gold/60 hover:text-gold flex items-center gap-1 text-xs"><ArrowLeft className="w-4 h-4" /> {t('backToMain')}</button>
            <div className="flex-1 text-center"><span className="text-gold font-display text-sm tracking-widest">{t('altScenario')}: {scenarioResult.scenarioLabel}</span></div>
            <button onClick={() => downloadDocx(scenarioResult)} className="btn-gold px-3 py-1.5 rounded text-xs tracking-widest flex items-center gap-2"><Download className="w-3 h-3" /> .DOCX</button>
            <button onClick={() => downloadPdf(scenarioResult)} className="btn-gold px-3 py-1.5 rounded text-xs tracking-widest flex items-center gap-2"><FileDown className="w-3 h-3" /> .PDF</button>
            <button onClick={() => shareReport(scenarioResult)} className="border border-gold/40 text-gold px-3 py-1.5 rounded text-xs tracking-widest hover:bg-gold/10 flex items-center gap-2"><Share2 className="w-3 h-3" /> {t('share')}</button>
          </div>
          <div className="bg-navy-light/70 border border-gold/50 rounded-lg p-8 report-content max-h-[70vh] overflow-auto"><ReactMarkdown remarkPlugins={[remarkGfm]}>{scenarioResult.content}</ReactMarkdown></div>
        </motion.div>
      )}
    </div>
  );
}

function ScenarioPanel({ scenarios, onDeepDive, loadingScenario, t }) {
  return (
    <div className="bg-navy-light/70 border border-gold/40 rounded-lg p-5">
      <div className="flex items-center gap-2 mb-4"><Atom className="w-5 h-5 text-gold animate-pulse" /><h3 className="font-display text-gold tracking-widest text-sm">{t('quantumMatrix')}</h3></div>
      <div className="space-y-2">
        {scenarios.map((s, i) => (
          <motion.div key={s.id} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className={`flex items-center gap-3 p-3 rounded border ${i === 0 ? 'border-gold/50 bg-gold/10' : 'border-gold/20 bg-navy/40 hover:border-gold/40'}`}>
            <div className="flex-1 min-w-0">
              <span className="text-gold/90 text-sm font-display tracking-wide truncate">{s.title}</span>
              {s.quantumProbability !== undefined && (
                <div className="text-[10px] font-mono text-cyan-300/70 mt-0.5">
                  YZ tahmini %{s.llmEstimate} → kuantum devresi %{s.quantumProbability}
                </div>
              )}
            </div>
            {i !== 0 && <button onClick={() => onDeepDive(s)} disabled={!!loadingScenario} className="flex-shrink-0 btn-gold px-3 py-1.5 rounded text-[11px] tracking-widest flex items-center gap-1 disabled:opacity-50">{loadingScenario === s.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <><BarChart3 className="w-3 h-3" /> {t('analyzeBtn')}</>}</button>}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function CategoryPicker({ onSelect }) {
  const { t } = useLang();
  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-display text-gold tracking-widest text-center mb-2">{t('newAnalysis')}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <button key={cat.id} onClick={() => onSelect(cat.id)} className="bg-navy-light/70 border border-gold/30 hover:border-gold rounded-lg p-5 transition flex flex-col items-center gap-3" style={{ minHeight: 130 }}>
              <Icon className="w-10 h-10" style={{ color: cat.color }} />
              <p className="font-display tracking-wider text-xs text-gold uppercase text-center leading-tight">{t(cat.nameKey)}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

