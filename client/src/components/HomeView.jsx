import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Wifi, Activity, Shield, Zap, Radio, Satellite, Eye, Radar } from 'lucide-react';
import TurkeyMap from './TurkeyMap.jsx';
import { useLang } from '../services/langContext.jsx';
import { api, getCurrentUser } from '../services/api.js';
import { t, localeFor } from '../services/i18n.js';

// ─── Animated metric bar ─────────────────────────────────────────────────
function MetricBar({ label, value, color = 'cyan', unit = '%' }) {
  const colors = {
    cyan:  { bar: 'bg-cyan-400',    text: 'text-cyan-300' },
    gold:  { bar: 'bg-yellow-400',  text: 'text-yellow-300' },
    green: { bar: 'bg-emerald-400', text: 'text-emerald-300' },
    red:   { bar: 'bg-red-400',     text: 'text-red-300' },
  };
  const c = colors[color] || colors.cyan;
  return (
    <div className="mb-3">
      <div className="flex justify-between items-center mb-1">
        <span className="text-[10px] text-white/50 tracking-widest uppercase">{label}</span>
        <span className={`text-[11px] font-bold ${c.text}`}>{value}{unit}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${c.bar}`}
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

// ─── Frequency waveform ──────────────────────────────────────────────────
function Waveform() {
  const [bars, setBars] = useState(() => Array.from({ length: 28 }, () => Math.random()));
  useEffect(() => {
    const t = setInterval(() => {
      setBars(prev => prev.map(v => Math.max(0.05, Math.min(1, v + (Math.random() - 0.5) * 0.35))));
    }, 140);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-end gap-0.5 h-8 w-full">
      {bars.map((h, i) => (
        <div key={i} className="flex-1 rounded-sm bg-cyan-400/60 transition-all duration-100"
          style={{ height: `${h * 100}%` }} />
      ))}
    </div>
  );
}

// ─── Connection dots ─────────────────────────────────────────────────────
function ConnectionDots({ lang }) {
  const nodes = [
    { id: 'SAT-7',  ok: true  },
    { id: 'RAD-3',  ok: true  },
    { id: 'NET-A',  ok: false },
    { id: 'Q-HUB',  ok: true  },
  ];
  return (
    <div className="mt-3 space-y-1.5">
      <div className="text-[9px] text-white/30 tracking-[0.3em] uppercase mb-1">
        {t(lang, 'homeLinks')}
      </div>
      {nodes.map(n => (
        <div key={n.id} className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${n.ok ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-[10px] text-white/50">{n.id}</span>
          <span className={`ml-auto text-[9px] ${n.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            {n.ok ? 'OK' : 'OFF'}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Left panel ──────────────────────────────────────────────────────────
function LeftPanel({ lang, showRadar = false, onOpenRadar = null }) {
  const [cpu, setCpu]   = useState(44);
  const [mem, setMem]   = useState(68);
  const [net, setNet]   = useState(91);

  useEffect(() => {
    const t = setInterval(() => {
      setCpu(v => Math.max(10, Math.min(99, v + (Math.random() - 0.5) * 14)));
      setMem(v => Math.max(30, Math.min(95, v + (Math.random() - 0.5) * 6)));
      setNet(v => Math.max(40, Math.min(100, v + (Math.random() - 0.5) * 12)));
    }, 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full" style={{ fontFamily: "'Times New Roman', Times, serif" }}>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-cyan-500/20">
        <Cpu className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
        <span className="text-[10px] text-cyan-300 tracking-[0.25em] uppercase">
          {t(lang, 'homeSystem')}
        </span>
      </div>
      <div className="flex-1 px-4 py-4 overflow-auto">
        <MetricBar label="CPU" value={Math.round(cpu)} color={cpu > 80 ? 'red' : 'cyan'} />
        <MetricBar label={t(lang, 'homeMemory')} value={Math.round(mem)} color={mem > 85 ? 'red' : 'green'} />
        <MetricBar label={t(lang, 'homeNetwork')} value={Math.round(net)} color="gold" />

        <div className="mt-4 mb-1">
          <div className="text-[9px] text-white/30 tracking-[0.3em] uppercase mb-2">RF</div>
          <Waveform />
        </div>

        <ConnectionDots lang={lang} />
        {showRadar && (
          <button onClick={onOpenRadar} className="btn-depth w-full mt-3 px-3 py-2 rounded text-[10px] tracking-widest uppercase flex items-center justify-center gap-2">
            <Radar className="w-3.5 h-3.5" />
            {t(lang, 'homePersonnelRadar')}
          </button>
        )}
      </div>
      <div className="flex items-center justify-around py-3 border-t border-cyan-500/20">
        {[Shield, Zap, Radio, Satellite, Eye].map((Icon, i) => (
          <Icon key={i} className="w-3.5 h-3.5 text-cyan-400/40" />
        ))}
      </div>
    </div>
  );
}

// ─── Category tag colors ────────────────────────────────────────────────
const CAT_COLORS = {
  savunma:       'text-cyan-300   border-cyan-500/40   bg-cyan-900/30',
  enerji:        'text-yellow-300 border-yellow-500/40 bg-yellow-900/30',
  saldiri:       'text-red-300    border-red-500/40    bg-red-900/30',
  ekonomi:       'text-green-300  border-green-500/40  bg-green-900/30',
  toplumsal:     'text-violet-300 border-violet-500/40 bg-violet-900/30',
  danisma:       'text-blue-300   border-blue-500/40   bg-blue-900/30',
  saglik:        'text-emerald-300 border-emerald-500/40 bg-emerald-900/30',
  'cok-alanli':  'text-orange-300 border-orange-500/40 bg-orange-900/30',
  emergency:     'text-red-300    border-red-500/40    bg-red-900/30',
};

function tagStyle(item) {
  if (item.type === 'emergency') return CAT_COLORS.emergency;
  return CAT_COLORS[item.category] || 'text-white/60 border-white/20 bg-white/5';
}

function tagLabel(item, lang) {
  if (item.type === 'emergency') return t(lang, 'homeEmrgTag');
  const cat = (item.category || '').toUpperCase().replace('-', '·');
  return cat || t(lang, 'newAnalysisShort');
}

// ─── Activity feed item ─────────────────────────────────────────────────
function FeedItem({ item, lang }) {
  const fmt = (d) => new Date(d).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' });

  let text;
  if (item.type === 'analysis') {
    text = item.title || t(lang, 'homeAnalysisGenerated');
  } else {
    const msg = item.message || '';
    text = msg.length > 80 ? msg.slice(0, 80) + 'â€¦' : msg;
  }
  if (typeof text === 'string' && text.trim().toLowerCase() === 'time news') {
    text = t(lang, 'timeNews');
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="bg-[#010e1e]/70 border border-white/8 rounded p-2"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`text-[8px] font-bold border rounded px-1 py-0.5 ${tagStyle(item)}`}>
          {tagLabel(item, lang)}
        </span>
        <span className="text-[9px] text-white/25 ml-auto">{fmt(item.created_at)}</span>
      </div>
      <p className="text-[10px] text-white/60 leading-snug">{text}</p>
      {item.user_code && (
        <p className="text-[9px] text-white/25 mt-0.5">{item.user_code}</p>
      )}
    </motion.div>
  );
}

// ─── Right panel — real activity feed ───────────────────────────────────
function RightPanel({ lang }) {
  const me = getCurrentUser();
  const isAdmin = !!me?.isAdmin;
  const [refreshing, setRefreshing] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [items, setItems] = useState([]);
  const [brief, setBrief] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [data, b] = await Promise.all([
        api.activityFeed(),
        api.morningBriefToday().catch(() => ({ exists: false })),
      ]);
      if (Array.isArray(data)) setItems(data);
      if (b?.exists) setBrief(b);
    } catch {
      // Leave empty if there's no DB or an error occurs
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gold/20">
        <Activity className="w-3.5 h-3.5 text-gold shrink-0" />
        <span className="text-[10px] text-cyan-300 tracking-[0.2em] uppercase">
          {t(lang, 'homeActivity')}
        </span>
        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-gold animate-pulse" />
      </div>

      <div className="flex-1 overflow-auto px-2 py-2 space-y-1.5">
        <BriefingCard
          lang={lang}
          brief={brief}
          showRefresh={isAdmin}
          refreshing={refreshing}
          onRefresh={async () => {
            try {
              setBriefError('');
              setRefreshing(true);
              await api.morningBriefRefresh();
              const latest = await api.morningBriefToday().catch(() => ({ exists: false }));
              if (latest?.exists) setBrief(latest);
              else setBriefError(t(lang, 'homeBriefFailed'));
            } catch (e) {
              setBriefError(e?.message || t(lang, 'homeRefreshFailed'));
            } finally {
              setRefreshing(false);
            }
          }}
        />
        {!!briefError && <p className="text-[10px] text-red-300">{briefError}</p>}

        {loading && (
          <p className="text-[10px] text-white/30 text-center py-6">
            {t(lang, 'homeLoadingActivity')}
          </p>
        )}
        {!loading && items.length === 0 && (
          <p className="text-[10px] text-white/25 text-center py-6">
            {t(lang, 'homeNoActivityYet')}
          </p>
        )}
        <AnimatePresence initial={false}>
          {items.map(item => (
            <FeedItem key={`${item.type}-${item.id}`} item={item} lang={lang} />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function BriefingCard({ lang, brief, showRefresh = false, refreshing = false, onRefresh = null }) {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [viewedBrief, setViewedBrief] = useState(brief);
  const [pastDates, setPastDates] = useState([]);
  const [filterQuery, setFilterQuery] = useState('');

  useEffect(() => { setViewedBrief(brief); }, [brief]);

  useEffect(() => {
    if (!open) return;
    api.morningBriefList().then(setPastDates).catch(() => setPastDates([]));
  }, [open]);

  const selectDate = async (date) => {
    if (date === viewedBrief?.date) return;
    try {
      const b = await api.morningBriefByDate(date);
      if (b?.exists) setViewedBrief(b);
    } catch { /* keep the previously shown brief on failure */ }
  };

  const fullItems = Array.isArray(viewedBrief?.items) ? viewedBrief.items : [];
  const filteredItems = fullItems.filter((it) => {
    const q = filterQuery.trim().toLowerCase();
    if (!q) return true;
    return it.title?.toLowerCase().includes(q) || it.source?.toLowerCase().includes(q);
  });

  return (
    <div className="bg-[#021728]/80 border border-cyan-500/30 rounded p-2 mb-2">
      <div className="flex items-start gap-2 mb-1">
        <div className="text-[9px] text-cyan-300 tracking-widest uppercase flex-1">
          {t(lang, 'homeMorningBriefTitle')}
        </div>
        <div className="ml-auto flex flex-col items-end gap-1 shrink-0">
          {showRefresh && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="text-[9px] border border-cyan-500/40 text-cyan-300 rounded px-2 py-0.5 disabled:opacity-50"
            >
              {refreshing ? t(lang, 'homeRefreshing') : t(lang, 'homeRefresh')}
            </button>
          )}
          {brief?.exists && (
            <button
              onClick={() => setOpen(true)}
              className="text-[9px] border border-gold/40 text-gold rounded px-2 py-0.5"
            >
              {t(lang, 'homeBriefingBtn')}
            </button>
          )}
        </div>
      </div>
      <div className="text-[10px] text-white/70 leading-snug">
        {brief?.exists ? t(lang, 'homeBriefReady') : t(lang, 'homeBriefNotYet')}
      </div>

      {open && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-3" onClick={() => setOpen(false)}>
          <div className="w-full max-w-3xl max-h-[85vh] overflow-auto bg-[#021728] border border-cyan-500/40 rounded-lg p-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm text-cyan-200 tracking-widest uppercase">
                {t(lang, 'homeFullBriefingTitle')}
              </h3>
              <button onClick={() => setOpen(false)} className="text-cyan-300/70 hover:text-cyan-200">×</button>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <input
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Başlık veya kaynakta ara…"
                className="flex-1 bg-black/30 border border-cyan-500/30 rounded px-2.5 py-1.5 text-xs text-white placeholder:text-white/30 outline-none focus:border-cyan-400/50"
              />
              {pastDates.length > 0 && (
                <select
                  value={viewedBrief?.date || ''}
                  onChange={(e) => selectDate(e.target.value)}
                  className="bg-black/30 border border-cyan-500/30 rounded px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-400/50"
                >
                  {pastDates.map((d) => (
                    <option key={d.date} value={d.date}>{d.date} ({d.itemCount})</option>
                  ))}
                </select>
              )}
            </div>

            {filteredItems.length === 0 ? (
              <p className="text-sm text-white/60">{fullItems.length === 0 ? t(lang, 'homeNoItems') : 'Arama sonucu bulunamadı.'}</p>
            ) : (
              <div className="space-y-2">
                {filteredItems.map((it, i) => (
                  <div key={`${it.link || it.title}-${i}`} className="border border-white/10 rounded p-2">
                    <button
                      type="button"
                      onClick={() => setExpandedIdx(expandedIdx === i ? null : i)}
                      className="w-full text-left text-sm text-white/90 hover:text-cyan-200"
                    >
                      {i + 1}. {it.title}
                    </button>
                    {expandedIdx === i && (
                      <div className="mt-2 text-xs text-white/75 leading-relaxed whitespace-pre-wrap">
                        {it.description || it.summary || it.contentSnippet || it.content || t(lang, 'homeNoDetail')}
                        {!!it.link && !(it.description || it.summary || it.contentSnippet || it.content) && (
                          <div className="mt-2">
                            <a
                              href={it.link}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-300 hover:text-cyan-200 underline"
                            >
                              {t(lang, 'openSourceNews')}
                            </a>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
// ─── Center panel ───────────────────────────────────────────────────────
function CenterPanel({ lang }) {
  const me = getCurrentUser();
  const isAdmin = !!me?.isAdmin;
  const [refreshing, setRefreshing] = useState(false);
  const [briefError, setBriefError] = useState('');
  const [brief, setBrief] = useState(null);
  const [activityStats, setActivityStats] = useState({ total: 0, alerts: 0 });

  useEffect(() => {
    api.morningBriefToday()
      .then((b) => { if (b?.exists) setBrief(b); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const loadStats = async () => {
      try {
        const feed = await api.activityFeed();
        const list = Array.isArray(feed) ? feed : [];
        setActivityStats({
          total: list.length,
          alerts: list.filter((x) => x?.type === 'emergency').length,
        });
      } catch {
        setActivityStats({ total: 0, alerts: 0 });
      }
    };
    loadStats();
    const t = setInterval(loadStats, 30000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-center gap-3 px-4 py-3 border-b border-white/8">
        <span className="text-[9px] text-cyan-300 tracking-[0.35em] uppercase">
          {t(lang, 'homeLiveTacticalMap')}
        </span>
        <span className="flex items-center gap-1 text-[9px] text-emerald-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          LIVE
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center p-3 sm:p-5 relative overflow-hidden">
        {/* Background radar ring */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-[55%] aspect-square rounded-full border border-cyan-500/10 relative overflow-hidden">
            <motion.div
              className="absolute inset-0"
              style={{ background: 'conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgba(34,211,238,0.10) 360deg)' }}
              animate={{ rotate: 360 }}
              transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
            />
          </div>
        </div>
        <div className="relative w-full">
          <TurkeyMap />
        </div>
      </div>

      <div className="px-3 pb-2 lg:hidden">
        <BriefingCard
          lang={lang}
          brief={brief}
          showRefresh={isAdmin}
          refreshing={refreshing}
          onRefresh={async () => {
            try {
              setBriefError('');
              setRefreshing(true);
              await api.morningBriefRefresh();
              const latest = await api.morningBriefToday().catch(() => ({ exists: false }));
              if (latest?.exists) setBrief(latest);
              else setBriefError(t(lang, 'homeBriefFailed'));
            } catch (e) {
              setBriefError(e?.message || t(lang, 'homeRefreshFailed'));
            } finally {
              setRefreshing(false);
            }
          }}
        />
        {!!briefError && <p className="text-[10px] text-red-300 mt-1">{briefError}</p>}
      </div>

      {/* Bottom stat strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 border-t border-white/8">
        {[
          { label: t(lang, 'homeBriefItemsLabel'), value: String(Array.isArray(brief?.items) ? brief.items.length : 0), color: 'text-cyan-300' },
          { label: t(lang, 'homeActivity'), value: String(activityStats.total), color: 'text-cyan-300' },
          { label: t(lang, 'homeAlertsLabel'), value: String(activityStats.alerts), color: 'text-orange-300' },
        ].map((s, i) => (
          <div key={i} className={`text-center py-2.5 ${i === 0 ? 'border-r border-white/8' : ''} ${i === 1 ? 'sm:border-r border-white/8' : ''}`}>
            <div className={`text-base font-bold ${s.color}`}>{s.value}</div>
            <div className="text-[9px] text-white/25 tracking-widest uppercase">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Mobile strip (left + right panels in compact form) ─────────────────
function MobileStrip({ lang }) {
  return (
    <div className="md:hidden flex gap-2 p-2 border-t border-white/8 bg-[#020f1e]/60 overflow-x-auto" style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))' }}>
      {/* Compact system card */}
      <div className="shrink-0 w-40 border border-cyan-500/20 rounded p-2.5 bg-[#010e1e]/70">
        <div className="text-[9px] text-cyan-300 tracking-widest uppercase mb-2">
          {t(lang, 'homeSystem')}
        </div>
        <MetricBar label="CPU" value={44} color="cyan" />
        <MetricBar label="MEM" value={68} color="green" />
        <MetricBar label="NET" value={91} color="gold" />
      </div>
      {/* Compact activity card */}
      <div className="flex-1 min-w-[160px] border border-gold/20 rounded bg-[#010e1e]/70 flex flex-col overflow-hidden">
        <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gold/15 shrink-0">
          <Activity className="w-3 h-3 text-cyan-300" />
          <span className="text-[9px] text-cyan-300 tracking-widest">
            {t(lang, 'homeActivity')}
          </span>
        </div>
        <MobileActivityFeed lang={lang} />
      </div>
    </div>
  );
}

function MobileActivityFeed({ lang }) {
  const [items, setItems] = useState([]);
  useEffect(() => {
    api.activityFeed().then(d => { if (Array.isArray(d)) setItems(d.slice(0, 5)); }).catch(() => {});
  }, []);
  if (!items.length) return (
    <p className="text-[9px] text-white/25 text-center p-3">
      {t(lang, 'homeNoActivityShort')}
    </p>
  );
  return (
    <div className="overflow-auto flex-1 p-2 space-y-1.5">
      {items.map(item => <FeedItem key={`m-${item.type}-${item.id}`} item={item} lang={lang} />)}
    </div>
  );
}

// ─── HomeView root ───────────────────────────────────────────────────────
export default function HomeView({ isAdmin = false, onOpenRadar = null }) {
  const { lang } = useLang();

  return (
    <motion.div
      className="flex flex-col h-full min-h-0"
      style={{ fontFamily: "'Times New Roman', Times, serif" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT — system metrics */}
        <div className="hidden md:flex md:w-48 lg:w-56 shrink-0 flex-col border-r border-cyan-500/15 bg-[#020f1e]/60">
          <LeftPanel lang={lang} showRadar={isAdmin} onOpenRadar={onOpenRadar} />
        </div>

        {/* CENTER — map */}
        <div className="flex-1 min-h-0 flex flex-col border-b lg:border-b-0 border-white/8 overflow-hidden">
          <CenterPanel lang={lang} />
        </div>

        {/* RIGHT — real activity feed, narrow */}
        <div className="hidden lg:flex lg:w-48 shrink-0 flex-col border-l border-gold/15 bg-[#020f1e]/60 overflow-hidden">
          <RightPanel lang={lang} />
        </div>
      </div>

      {/* MOBILE — bottom strip */}
      <MobileStrip lang={lang} />
    </motion.div>
  );
}




