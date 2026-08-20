import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  X, Rocket, Check, ChevronRight, FileText, Image as ImageIcon, Atom, Sparkles,
  Loader2, ShieldCheck, Lock, Radio, Database, Layers,
} from 'lucide-react';
import { CATEGORIES } from './CategorySidebar.jsx';
import FileAttach from './FileAttach.jsx';
import VoiceButton from './VoiceButton.jsx';

const STEPS = [
  { id: 1, label: 'Analiz Bilgileri' },
  { id: 2, label: 'Veri Kaynakları' },
  { id: 3, label: 'Analiz Motorları' },
  { id: 4, label: 'Zaman & Parametreler' },
  { id: 5, label: 'Doğrulama & Başlat' },
];

const PRIORITIES = [
  { id: 'dusuk', label: 'Düşük', cls: 'border-white/15 text-white/50' },
  { id: 'normal', label: 'Normal', cls: 'border-cyan-400/40 text-cyan-200' },
  { id: 'yuksek', label: 'Yüksek', cls: 'border-amber-400/40 text-amber-300' },
  { id: 'kritik', label: 'Kritik', cls: 'border-red-400/50 text-red-300' },
];

const DEPTHS = [
  { id: 'hizli', label: 'Hızlı', detail: 'Web araştırması atlanır, daha kısa rapor — en hızlı sonuç.' },
  { id: 'standart', label: 'Standart', detail: 'Web araştırması dahil, mevcut varsayılan davranış.' },
  { id: 'derin', label: 'Derin', detail: 'Web araştırması garanti çalışır, daha kapsamlı kaynak taraması.' },
];

// UI wizard for starting a new analysis, replacing the previous single flat
// form -- restructures the SAME existing fields/handlers (title, prompt,
// category, quantum mode, file/document sources) plus two new backend-backed
// fields (priority, depth -- see routes/analysis.js) into 5 steps, matching
// the command-center HUD visual language established by CategoryPicker/
// LoginPageDecor rather than inventing a new one.
export default function AnalysisWizard({
  t,
  open, onClose,
  category, setCategory, categoryLabel, isFraudCategory,
  title, setTitle, titlePlaceholder,
  prompt, setPrompt,
  priority, setPriority,
  depth, setDepth,
  quantumMode, setQuantumMode,
  documentContexts, imageFiles, realTransactions, realScenarios, realOptimization,
  removeImageAt, removeDocAt, setRealTransactions, setRealScenarios, setRealOptimization,
  handleAIFile,
  error, loading, hasPrompt, generate,
}) {
  const [step, setStep] = useState(1);
  if (!open) return null;

  const cat = CATEGORIES.find((c) => c.id === category);
  const sources = [
    ...documentContexts.map((d, i) => ({ key: `doc-${i}`, name: d.filename, icon: FileText, onRemove: () => removeDocAt(i) })),
    ...imageFiles.map((img, i) => ({ key: `img-${i}`, name: img.filename, icon: ImageIcon, onRemove: () => removeImageAt(i) })),
    ...(realTransactions ? [{ key: 'tx', name: `${realTransactions.filename} · ${realTransactions.transactions.length} işlem`, icon: FileText, onRemove: () => setRealTransactions(null) }] : []),
    ...(realScenarios ? [{ key: 'sc', name: `${realScenarios.filename} · ${realScenarios.scenarios.length} senaryo`, icon: FileText, onRemove: () => setRealScenarios(null) }] : []),
    ...(realOptimization ? [{ key: 'opt', name: `${realOptimization.filename} · ${realOptimization.items.length} kalem`, icon: FileText, onRemove: () => setRealOptimization(null) }] : []),
  ];

  const engines = [
    { label: 'AI Reasoning', detail: 'Otomatik sağlayıcı seçimi (Claude / Gemini / GPT-4o)', on: true, Icon: Sparkles, color: '#8de0ff' },
    { label: 'Kuantum Devresi', detail: isFraudCategory ? 'Fraud çekirdeği (kuantum kernel)' : 'Senaryo motoru (Qiskit Aer)', on: quantumMode, Icon: Atom, color: '#6fb4ff' },
    { label: 'Optimizasyon Motoru (QAOA)', detail: 'Bütçe tahsis tablosu yüklenir/tespit edilirse otomatik çalışır', on: !isFraudCategory, Icon: Layers, color: '#ffd36a' },
    { label: 'IBM Donanım Doğrulaması', detail: 'Yapılandırılmışsa arka planda talep üzerine', on: quantumMode, Icon: ShieldCheck, color: '#56e6b3' },
  ];

  const handleStart = () => { generate(); onClose(); };

  return (
    <div className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4" role="dialog" aria-modal="true" aria-label="Yeni Analiz Başlat">
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16 }}
        className="w-full max-w-6xl max-h-[92vh] rounded-xl border border-cyan-400/25 bg-[#020f1e] shadow-2xl shadow-cyan-500/10 flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-cyan-400/15 bg-[#031326]/60">
          <div className="w-9 h-9 rounded-lg bg-cyan-400/10 border border-cyan-400/30 flex items-center justify-center flex-shrink-0">
            <Rocket className="w-4.5 h-4.5 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display tracking-widest text-cyan-100 text-sm uppercase truncate">Yeni Analiz Başlat</h2>
            <p className="text-[9px] text-white/35 tracking-wider">ANATOLIA-Q Analiz Konfigürasyon Merkezi{categoryLabel ? ` · ${categoryLabel}` : ''}</p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:flex items-center gap-1.5 text-[9px] tracking-widest text-emerald-400/80">
              <motion.span className="w-1.5 h-1.5 rounded-full bg-emerald-400" animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.3, repeat: Infinity }} />
              SECURE SESSION
            </span>
            <button type="button" onClick={onClose} aria-label="Kapat" className="text-white/50 hover:text-white p-1"><X className="w-4.5 h-4.5" /></button>
          </div>
        </div>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)_240px] overflow-hidden">
          {/* Left stepper */}
          <nav className="border-b lg:border-b-0 lg:border-r border-cyan-400/10 p-3 flex lg:flex-col gap-1.5 overflow-x-auto lg:overflow-visible">
            {STEPS.map((s) => (
              <button key={s.id} type="button" onClick={() => setStep(s.id)}
                className={`flex-shrink-0 flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${step === s.id ? 'bg-cyan-400/10 border border-cyan-300/40' : 'border border-transparent hover:bg-white/5'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono flex-shrink-0 ${step === s.id ? 'bg-cyan-300 text-[#031326]' : step > s.id ? 'bg-emerald-400/80 text-[#031326]' : 'border border-white/20 text-white/40'}`}>
                  {step > s.id ? <Check className="w-3 h-3" /> : String(s.id).padStart(2, '0')}
                </span>
                <span className={`text-[10px] tracking-wide whitespace-nowrap lg:whitespace-normal ${step === s.id ? 'text-cyan-100' : 'text-white/45'}`}>{s.label}</span>
              </button>
            ))}
          </nav>

          {/* Center: step content */}
          <div className="min-w-0 overflow-y-auto p-4 sm:p-5">
            <motion.div key={step} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.15 }}>
                {step === 1 && (
                  <div className="space-y-4">
                    <SectionLabel>Analiz Bilgileri</SectionLabel>
                    <div>
                      <FieldLabel>{t('reportTitle')}</FieldLabel>
                      <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={titlePlaceholder}
                        className="w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[12px] text-cyan-100 focus:border-cyan-300 focus:outline-none" />
                    </div>
                    <div>
                      <FieldLabel>{t('analysisTopic')}</FieldLabel>
                      <div className="relative">
                        <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={6} placeholder={t('topicPh')}
                          className="w-full bg-black/25 border border-cyan-400/20 rounded p-2.5 pr-10 text-[12px] text-cyan-100 focus:border-cyan-300 focus:outline-none" />
                        <div className="absolute bottom-2 right-2"><VoiceButton mode="input" onTranscript={(text) => setPrompt((prev) => (prev ? prev + ' ' + text : text))} size="sm" /></div>
                      </div>
                    </div>
                    <div className="grid sm:grid-cols-2 gap-4">
                      <div>
                        <FieldLabel>Kategori</FieldLabel>
                        <select value={category} onChange={(e) => setCategory(e.target.value)}
                          className="w-full bg-black/25 border border-cyan-400/20 rounded px-2.5 py-2 text-[12px] text-cyan-100 focus:border-cyan-300 focus:outline-none">
                          {CATEGORIES.filter((c) => c.id !== 'danisma').map((c) => <option key={c.id} value={c.id}>{c.desc.tr.split(',')[0]}</option>)}
                        </select>
                      </div>
                      <div>
                        <FieldLabel>Öncelik Seviyesi</FieldLabel>
                        <div className="flex gap-1.5">
                          {PRIORITIES.map((p) => (
                            <button key={p.id} type="button" onClick={() => setPriority(p.id)}
                              className={`flex-1 py-2 rounded border text-[10px] tracking-wide transition ${priority === p.id ? `${p.cls} bg-white/5` : 'border-white/10 text-white/30 hover:border-white/25'}`}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {error && <div className="text-red-300 text-[10px] bg-red-500/10 border border-red-500/30 rounded p-2">⚠ {error}</div>}
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-4">
                    <SectionLabel>Veri Kaynakları</SectionLabel>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[9px] text-cyan-300/40 tracking-widest uppercase">Kaynak Dosya Ekle</span>
                      <FileAttach onAIFile={handleAIFile} />
                    </div>
                    {quantumMode && (
                      <p className="text-[10px] text-white/40 leading-relaxed border border-cyan-400/10 rounded p-2.5 bg-black/15">
                        {isFraudCategory
                          ? 'Gerçek işlem dökümü (CSV/Excel — "Tutar" ve "Saat"/"Tarih" sütunları gerekli) yükleyebilirsiniz; yüklenirse kuantum motoru yapay örnek kayıtlar yerine bu gerçek kayıtları puanlar.'
                          : 'Gerçek senaryo verisi ("Senaryo"/"Olasılık" sütunları) veya kaynak tahsisi tablosu ("Kalem"/"Değer"/"Maliyet" sütunları) yükleyebilirsiniz; yüklenirse kuantum motoru YZ tahmini yerine bu gerçek verileri kullanır.'}
                      </p>
                    )}
                    <div className="rounded-lg border border-cyan-400/10 bg-black/15">
                      <div className="px-3 py-2 border-b border-cyan-400/10 text-[10px] text-cyan-200/70 tracking-widest uppercase">Eklenen Kaynaklar ({sources.length})</div>
                      <div className="p-3 space-y-1.5">
                        {sources.length === 0 && <div className="text-[10px] text-white/25">Henüz kaynak eklenmedi</div>}
                        {sources.map((s) => (
                          <div key={s.key} className="flex items-center gap-2 text-[10px] text-white/60">
                            <s.icon className="w-3 h-3 text-cyan-400/50 flex-shrink-0" />
                            <span className="truncate flex-1">{s.name}</span>
                            <button type="button" onClick={s.onRemove} className="text-red-300/70 hover:text-red-300">×</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {step === 3 && (
                  <div className="space-y-4">
                    <SectionLabel>Analiz Motorları</SectionLabel>
                    <div onClick={() => setQuantumMode(!quantumMode)}
                      className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition select-none ${quantumMode ? 'bg-cyan-400/10 border-cyan-300/50' : 'bg-black/20 border-cyan-400/15 hover:border-cyan-400/35'}`}>
                      <div className={`mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition ${quantumMode ? 'bg-cyan-300 border-cyan-300' : 'border-cyan-400/40'}`}>
                        {quantumMode && <Check className="w-2.5 h-2.5 text-[#031326]" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5 mb-0.5"><Atom className="w-3.5 h-3.5 text-cyan-300" /><span className="text-cyan-100 font-display tracking-widest text-[11px]">{t('quantumMode')}</span></div>
                        <p className="text-[9px] text-white/40 leading-relaxed">{t(isFraudCategory ? 'quantumDescFraud' : 'quantumDesc')}</p>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      {engines.map((e) => (
                        <div key={e.label} className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${e.on ? 'border-white/10 bg-white/[0.02]' : 'border-white/5'}`}>
                          <EngineIconBadge Icon={e.Icon} color={e.color} on={e.on} />
                          <div className="min-w-0">
                            <div className={`text-[11px] tracking-wide ${e.on ? 'text-white/85' : 'text-white/30'}`}>{e.label}</div>
                            <div className="text-[9px] text-white/30">{e.detail}</div>
                          </div>
                          <span className={`ml-auto text-[8px] tracking-widest flex-shrink-0 ${e.on ? 'text-emerald-300/70' : 'text-white/25'}`}>{e.on ? 'ETKİN' : 'PASİF'}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {step === 4 && (
                  <div className="space-y-4">
                    <SectionLabel>Zaman & Parametreler</SectionLabel>
                    <div>
                      <FieldLabel>Analiz Derinliği</FieldLabel>
                      <div className="grid grid-cols-3 gap-2">
                        {DEPTHS.map((d) => (
                          <button key={d.id} type="button" onClick={() => setDepth(d.id)}
                            className={`text-left p-2.5 rounded-lg border transition ${depth === d.id ? 'border-cyan-300/60 bg-cyan-400/10' : 'border-white/10 hover:border-white/25'}`}>
                            <div className={`text-[10px] tracking-widest font-display ${depth === d.id ? 'text-cyan-100' : 'text-white/50'}`}>{d.label}</div>
                          </button>
                        ))}
                      </div>
                      <p className="text-[9px] text-white/35 mt-2 leading-relaxed">{DEPTHS.find((d) => d.id === depth)?.detail}</p>
                    </div>
                    <ResourceMeter quantumMode={quantumMode} depth={depth} />
                  </div>
                )}

                {step === 5 && (
                  <div className="space-y-4">
                    <SectionLabel>Doğrulama & Başlat</SectionLabel>
                    <div className="rounded-lg border border-cyan-400/10 bg-black/15 divide-y divide-white/5">
                      <SummaryRow label="Başlık" value={title || '(otomatik)'} />
                      <SummaryRow label="Kategori" value={cat ? cat.desc.tr.split(',')[0] : category} />
                      <SummaryRow label="Öncelik" value={PRIORITIES.find((p) => p.id === priority)?.label} />
                      <SummaryRow label="Derinlik" value={DEPTHS.find((d) => d.id === depth)?.label} />
                      <SummaryRow label="Kuantum Modu" value={quantumMode ? 'Etkin' : 'Pasif'} />
                      <SummaryRow label="Kaynak Sayısı" value={String(sources.length)} />
                    </div>
                    {!hasPrompt && <div className="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-400/30 rounded p-2">⚠ Analizi başlatmadan önce "Analiz Bilgileri" adımında bir açıklama girin.</div>}
                    {error && <div className="text-red-300 text-[10px] bg-red-500/10 border border-red-500/30 rounded p-2">⚠ {error}</div>}
                  </div>
                )}
            </motion.div>
          </div>

          {/* Right: always-visible status column */}
          <aside className="hidden lg:flex flex-col border-l border-cyan-400/10 p-3 gap-3 overflow-y-auto bg-gradient-to-b from-cyan-400/[0.03] to-transparent">
            <RadarDecor />
            <InfoPanel title="Seçili Motorlar">
              {engines.map((e) => (
                <div key={e.label} className="flex items-center gap-2.5 text-[10px]">
                  <EngineIconBadge Icon={e.Icon} color={e.color} on={e.on} size="sm" />
                  <span className={e.on ? 'text-white/70' : 'text-white/25'}>{e.label}</span>
                  {e.on && <Check className="w-3 h-3 text-emerald-400/70 ml-auto flex-shrink-0" />}
                </div>
              ))}
            </InfoPanel>
            <InfoPanel title="Sistem Durumu">
              {[['AI Engine', true], ['Quantum Engine', true], ['Data Engine', true], ['Security Layer', true]].map(([l]) => (
                <div key={l} className="flex items-center text-[10px]">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
                  <span className="text-white/55">{l}</span>
                  <span className="ml-auto text-emerald-400/80 text-[9px] tracking-wider">ONLINE</span>
                </div>
              ))}
            </InfoPanel>
          </aside>
        </div>

        {/* Footer */}
        <div className="border-t border-cyan-400/15 bg-[#031326]/60 px-4 py-3 flex flex-col sm:flex-row items-center gap-2.5">
          <button type="button" onClick={onClose} className="order-2 sm:order-1 border border-red-400/30 text-red-300 px-4 py-2 rounded text-[10px] tracking-widest hover:bg-red-500/10 flex items-center gap-1.5">
            <X className="w-3.5 h-3.5" /> İPTAL
          </button>
          <div className="order-3 sm:order-2 flex flex-wrap items-center gap-x-4 gap-y-1 sm:mx-auto">
            <SecurityChip Icon={Lock} label="Güvenli Oturum" />
            <SecurityChip Icon={ShieldCheck} label="Veri Şifreleme · TLS" />
            <SecurityChip Icon={Database} label="Rapor Kaydı · Veritabanı" />
            <SecurityChip Icon={Radio} label="Bağlantı Stabil" />
          </div>
          {step < 5 ? (
            <button type="button" onClick={() => setStep((s) => Math.min(5, s + 1))} className="order-1 sm:order-3 w-full sm:w-auto btn-gold px-5 py-2.5 rounded font-display tracking-widest text-[11px] flex items-center justify-center gap-2">
              SONRAKİ <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={handleStart} disabled={loading || !hasPrompt} className="order-1 sm:order-3 w-full sm:w-auto btn-gold px-5 py-2.5 rounded font-display tracking-widest text-[11px] disabled:opacity-50 flex items-center justify-center gap-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" />{quantumMode ? t('analyzingQuantum') : t('analyzing')}</>
                : <>{quantumMode ? <Atom className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}{quantumMode ? t('generateQuantum') : t('generateAnalysis')}</>}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function SectionLabel({ children }) {
  return <h3 className="text-[11px] tracking-[0.2em] text-cyan-200 font-display uppercase mb-1">{children}</h3>;
}
function FieldLabel({ children }) {
  return <label className="block text-[9px] text-cyan-300/50 tracking-widest uppercase mb-1.5">{children}</label>;
}
function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 text-[10px]">
      <span className="text-white/40 tracking-wide">{label}</span>
      <span className="text-cyan-100">{value}</span>
    </div>
  );
}
function SecurityChip({ Icon, label }) {
  return (
    <span className="flex items-center gap-1 text-[8px] tracking-wider text-white/35">
      <Icon className="w-2.5 h-2.5 text-emerald-400/60" /> {label}
    </span>
  );
}
function InfoPanel({ title, children }) {
  return (
    <div className="rounded-lg border border-cyan-400/15 bg-[#031326]/90 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      <div className="text-[9px] tracking-widest text-cyan-300/50 uppercase mb-2">{title}</div>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function EngineIconBadge({ Icon, color, on, size = 'md' }) {
  const dims = size === 'sm' ? 'w-5 h-5' : 'w-8 h-8';
  const iconDims = size === 'sm' ? 'w-2.5 h-2.5' : 'w-4 h-4';
  return (
    <span
      className={`flex-shrink-0 ${dims} rounded-full flex items-center justify-center border`}
      style={on
        ? { borderColor: `${color}66`, background: `${color}1a`, boxShadow: `0 0 10px ${color}40` }
        : { borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)' }}
    >
      <Icon className={iconDims} style={{ color: on ? color : 'rgba(255,255,255,0.25)' }} />
    </span>
  );
}

// Quantum mode roughly doubles the number of engines involved (AI + quantum
// worker vs. AI alone), and 'derin' always runs the (skippable) web-research
// pass -- so this reflects the two real levers the user just set (depth,
// quantumMode), phrased qualitatively rather than as fabricated precise
// timings this component has no way to actually measure.
function ResourceMeter({ quantumMode, depth }) {
  const level = depth === 'hizli' && !quantumMode ? 1 : depth === 'derin' && quantumMode ? 3 : 2;
  const labels = ['Düşük', 'Orta', 'Yüksek'];
  return (
    <div>
      <FieldLabel>Beklenen Kaynak Kullanımı</FieldLabel>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden flex gap-0.5">
          {[1, 2, 3].map((i) => <div key={i} className={`flex-1 rounded-full ${i <= level ? (level === 3 ? 'bg-amber-400' : 'bg-cyan-400') : 'bg-transparent'}`} />)}
        </div>
        <span className="text-[9px] text-white/40 tracking-wide flex-shrink-0">{labels[level - 1]}</span>
      </div>
      <p className="text-[9px] text-white/25 mt-1">Web araştırması ve kuantum devre çalıştırma adımlarının sayısına göre yaklaşık düzey.</p>
    </div>
  );
}

// Radar-globe hologram for the wizard's status column: concentric range
// rings + radial spokes + tilted "meridian" ellipses (globe latitude lines,
// same technique as LoginPageDecor's OrbitalLogo) converging on a pulsing
// center light, with an independently rotating scan sweep on top -- three
// separate motion layers (rings+spokes, sweep, pulse) so the animation
// reads clearly even though a static screenshot can only show one frame.
const RADAR_SPOKE_ANGLES = Array.from({ length: 12 }, (_, i) => i * 30);

function RadarDecor() {
  return (
    <div className="relative w-full aspect-square max-h-40 mx-auto flex items-center justify-center py-2">
      <div className="absolute inset-0 rounded-full opacity-80" style={{ background: 'radial-gradient(circle, rgba(0,180,255,0.22) 0%, transparent 68%)' }} />

      <motion.svg viewBox="0 0 144 144" className="absolute inset-2 w-[calc(100%-16px)] h-[calc(100%-16px)]"
        animate={{ rotate: 360 }} transition={{ duration: 20, repeat: Infinity, ease: 'linear' }} style={{ transformOrigin: '72px 72px' }}>
        <defs>
          <filter id="holoGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <g filter="url(#holoGlow)" stroke="rgba(56,214,255,0.5)" fill="none">
          <circle cx="72" cy="72" r="64" strokeWidth="0.6" />
          <circle cx="72" cy="72" r="44" strokeWidth="0.5" strokeDasharray="2 3" />
          <circle cx="72" cy="72" r="24" strokeWidth="0.5" strokeDasharray="2 3" />
          <ellipse cx="72" cy="72" rx="64" ry="20" strokeWidth="0.5" transform="rotate(60 72 72)" />
          <ellipse cx="72" cy="72" rx="64" ry="20" strokeWidth="0.5" transform="rotate(-60 72 72)" />
          {RADAR_SPOKE_ANGLES.map((deg) => {
            const rad = (deg * Math.PI) / 180;
            return <line key={deg} x1="72" y1="72" x2={72 + 64 * Math.cos(rad)} y2={72 + 64 * Math.sin(rad)} strokeWidth="0.4" opacity="0.5" />;
          })}
        </g>
      </motion.svg>

      {/* Scan sweep, counter-rotating at a different speed for a layered radar feel */}
      <motion.div animate={{ rotate: -360 }} transition={{ duration: 5, repeat: Infinity, ease: 'linear' }} className="absolute inset-4 rounded-full"
        style={{ background: 'conic-gradient(from 0deg, transparent 82%, rgba(120,235,255,0.35) 100%)' }} />
      <motion.div
        animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.35, 1] }}
        transition={{ duration: 1.8, repeat: Infinity }}
        className="absolute w-3 h-3 rounded-full bg-cyan-200"
        style={{ boxShadow: '0 0 16px 5px rgba(120,235,255,0.85)' }}
      />
    </div>
  );
}
