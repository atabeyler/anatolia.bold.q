import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Activity, AlertTriangle, Atom, Bot, Database, FileText, HardDrive,
  Network, Radar, Server, ShieldCheck, Sparkles, Upload, Zap,
} from 'lucide-react';
import TurkeyMap from './TurkeyMap.jsx';
import { api } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';
import { localeFor } from '../services/i18n.js';

const PANEL = 'rounded-lg border border-cyan-400/15 bg-[#031326]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]';

function useCommandData() {
  const [health, setHealth] = useState(null);
  const [feed, setFeed] = useState([]);
  const [brief, setBrief] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [healthResult, feedResult, briefResult] = await Promise.allSettled([
        fetch('/api/v1/platform/health/ready', { cache: 'no-store' }).then((r) => r.json()),
        api.activityFeed(),
        api.morningBriefToday(),
      ]);
      if (!alive) return;
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
      if (feedResult.status === 'fulfilled' && Array.isArray(feedResult.value)) setFeed(feedResult.value);
      if (briefResult.status === 'fulfilled') setBrief(briefResult.value);
    };
    load();
    const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  return { health, feed, brief };
}

function EngineCard({ icon: Icon, name, detail, state = 'online' }) {
  const online = state === 'online';
  return (
    <div className="min-w-[150px] flex-1 px-3 py-2 flex items-center gap-2.5 border-r border-white/5 last:border-r-0">
      <Icon className="w-5 h-5 text-cyan-300 shrink-0" />
      <div className="min-w-0">
        <div className="text-[10px] tracking-[0.14em] text-white/80 font-semibold truncate">{name}</div>
        <div className={`text-[9px] tracking-wider ${online ? 'text-emerald-400' : 'text-amber-300'}`}>
          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${online ? 'bg-emerald-400' : 'bg-amber-300'}`} />
          {online ? 'ONLINE' : 'STANDBY'}
        </div>
        <div className="text-[9px] text-white/30 truncate">{detail}</div>
      </div>
    </div>
  );
}

function SectionTitle({ children, action }) {
  return (
    <div className="h-9 px-3 flex items-center border-b border-cyan-400/10">
      <span className="text-[10px] text-cyan-100 tracking-[0.15em] font-semibold uppercase">{children}</span>
      {action && <span className="ml-auto text-[9px] text-cyan-400/70">{action}</span>}
    </div>
  );
}

function SystemPanel({ health, isAdmin, onOpenRadar }) {
  const rows = [
    ['AI Sağlayıcıları', health?.ai?.configured ? 'Aktif' : 'Kontrol', Sparkles],
    ['Veritabanı', health?.database?.ok ? 'Sağlıklı' : health?.database?.configured ? 'Hata' : 'N/A', Database],
    ['Quantum Worker', health?.quantum?.ok === false ? 'Sınırlı' : 'Aktif', Atom],
    ['IBM Quantum', health?.quantum?.ibmConfigured ? 'Hazır' : 'Standby', Server],
    ['Depolama', health?.storage?.persistentObjectStorageConfigured ? 'Object' : 'Yerel', HardDrive],
    ['Gerçek Zaman', 'Aktif', Network],
  ];
  return (
    <div className={PANEL}>
      <SectionTitle>Sistem Durumu</SectionTitle>
      <div className="p-3 space-y-2">
        {rows.map(([label, value, Icon]) => (
          <div key={label} className="flex items-center gap-2 text-[10px]">
            <Icon className="w-3.5 h-3.5 text-cyan-400/55" />
            <span className="text-white/55">{label}</span>
            <span className="ml-auto text-white/75">{value}</span>
            <span className={`w-1.5 h-1.5 rounded-full ${/Hata|Sınırlı/.test(value) ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          </div>
        ))}
        {isAdmin && (
          <button onClick={onOpenRadar} className="w-full mt-2 py-2 rounded border border-cyan-400/20 bg-cyan-400/5 text-[10px] text-cyan-200 tracking-wider hover:bg-cyan-400/10 flex items-center justify-center gap-2">
            <Radar className="w-3.5 h-3.5" /> PERSONEL RADARI
          </button>
        )}
      </div>
    </div>
  );
}

function SourcePanel({ brief }) {
  const count = Array.isArray(brief?.items) ? brief.items.length : 0;
  const sources = [
    ['Açık Kaynak İstihbaratı', count || '—'], ['Resmi Raporlar', 'AKTİF'],
    ['Haber Akışları', 'AKTİF'], ['Ekonomik Veriler', 'AKTİF'], ['Saha / Yüklenen Veri', 'HAZIR'],
  ];
  return (
    <div className={PANEL}>
      <SectionTitle>Veri Kaynakları</SectionTitle>
      <div className="p-3 space-y-2">
        {sources.map(([name, value]) => (
          <div key={name} className="flex items-center text-[10px]">
            <Database className="w-3 h-3 text-cyan-400/45 mr-2" />
            <span className="text-white/50 truncate">{name}</span>
            <span className="ml-auto text-emerald-400/80 text-[9px]">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AlertPanel({ feed }) {
  const alerts = feed.filter((x) => x?.type === 'emergency').slice(0, 4);
  return (
    <div className={`${PANEL} min-h-0`}>
      <SectionTitle action="CANLI">Kritik Uyarılar</SectionTitle>
      <div className="p-2 space-y-2 max-h-[220px] overflow-auto">
        {alerts.length === 0 && (
          <div className="p-4 text-center text-[10px] text-emerald-300/70">
            <ShieldCheck className="w-6 h-6 mx-auto mb-2" /> Aktif kritik uyarı bulunmuyor
          </div>
        )}
        {alerts.map((item, i) => (
          <div key={`${item.id}-${i}`} className="rounded border border-red-500/30 bg-red-500/5 p-2.5">
            <div className="flex gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="text-[9px] text-red-300 tracking-wider">YÜKSEK</div>
                <div className="text-[10px] text-white/75 mt-1 line-clamp-2">{item.message || 'Kritik sistem bildirimi'}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivityPanel({ feed, lang }) {
  const fmt = (date) => {
    try { return new Date(date).toLocaleTimeString(localeFor(lang), { hour: '2-digit', minute: '2-digit' }); }
    catch { return '--:--'; }
  };
  return (
    <div className={`${PANEL} min-h-0 flex flex-col`}>
      <SectionTitle action="SON 30 DK">Canlı Aktiviteler</SectionTitle>
      <div className="p-3 space-y-2 overflow-auto">
        {feed.slice(0, 7).map((item, i) => (
          <div key={`${item.type}-${item.id}-${i}`} className="flex gap-2 text-[9px] border-l border-cyan-400/20 pl-2">
            <span className="text-cyan-300/55 shrink-0">{fmt(item.created_at)}</span>
            <span className="text-white/50 line-clamp-2">{item.title || item.message || 'Sistem aktivitesi'}</span>
          </div>
        ))}
        {!feed.length && <div className="text-[10px] text-white/30">Aktivite bekleniyor…</div>}
      </div>
    </div>
  );
}

function DecisionCards({ feed }) {
  const analyses = feed.filter((x) => x?.type === 'analysis').slice(0, 4);
  return (
    <div className={`${PANEL} overflow-hidden`}>
      <SectionTitle action="TÜM ANALİZLER →">Aktif Kararlar & Analizler</SectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 p-2">
        {(analyses.length ? analyses : [
          { title: 'Yeni karar analizi bekleniyor', category: 'SİSTEM' },
          { title: 'Senaryo motoru hazır', category: 'QUANTUM' },
        ]).map((item, i) => (
          <div key={`${item.id || 'placeholder'}-${i}`} className="rounded border border-cyan-400/15 bg-black/15 p-3 min-h-[104px]">
            <div className="flex items-center gap-2 text-[9px] text-cyan-300/60">
              <span>#AQ-{String(item.id || 847 - i).slice(-3)}</span>
              <span className="ml-auto uppercase">{item.category || 'ANALİZ'}</span>
            </div>
            <div className="text-[11px] text-white/80 mt-2 line-clamp-2 min-h-[32px]">{item.title}</div>
            <div className="mt-3 flex gap-1.5">
              <span className="px-2 py-1 rounded border border-cyan-400/15 text-[8px] text-cyan-200/70">DETAY</span>
              <span className="px-2 py-1 rounded border border-cyan-400/15 text-[8px] text-cyan-200/70">DECISION TRACE</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomeView({ isAdmin = false, onOpenRadar = null }) {
  const { lang } = useLang();
  const { health, feed, brief } = useCommandData();
  const emergencyCount = useMemo(() => feed.filter((x) => x?.type === 'emergency').length, [feed]);

  const engines = [
    [Bot, 'AI ENGINE', health?.ai?.configured ? 'Provider hazır' : 'Provider kontrolü', health?.ai?.configured ? 'online' : 'standby'],
    [Database, 'DATA ENGINE', 'Veri motoru', health?.database?.ok ? 'online' : 'standby'],
    [Activity, 'SCENARIO ENGINE', 'Senaryo analizi', 'online'],
    [Atom, 'QISKIT AER', 'Simulator', health?.quantum?.ok === false ? 'standby' : 'online'],
    [Server, 'IBM QUANTUM', 'Hardware verification', health?.quantum?.ibmConfigured ? 'online' : 'standby'],
    [Network, 'SOCKET.IO', 'Gerçek zamanlı', 'online'],
  ];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full min-h-0 overflow-auto bg-[#010a15] p-2 sm:p-3" style={{ fontFamily: "Inter, 'Times New Roman', serif" }}>
      <div className={`${PANEL} mb-2 overflow-x-auto`}>
        <div className="flex min-w-[900px]">
          {engines.map(([Icon, name, detail, state]) => <EngineCard key={name} icon={Icon} name={name} detail={detail} state={state} />)}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-2 min-h-[520px]">
        <aside className="space-y-2 min-h-0">
          <SystemPanel health={health} isAdmin={isAdmin} onOpenRadar={onOpenRadar} />
          <SourcePanel brief={brief} />
          <ActivityPanel feed={feed} lang={lang} />
        </aside>

        <section className="min-w-0 space-y-2">
          <div className={`${PANEL} overflow-hidden`}>
            <SectionTitle action={<span className="text-emerald-400">● LIVE</span>}>Küresel Operasyon Görünümü</SectionTitle>
            <div className="relative min-h-[330px] h-[42vh] max-h-[520px] overflow-hidden">
              <div className="absolute inset-0 opacity-90"><TurkeyMap /></div>
              <div className="absolute left-3 top-3 rounded border border-cyan-400/15 bg-[#020d19]/85 p-2 text-[9px] text-white/50 space-y-1.5 pointer-events-none">
                <div><span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mr-2" />Kritik Olay</div>
                <div><span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mr-2" />Risk Bölgesi</div>
                <div><span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-400 mr-2" />İzleme Noktası</div>
                <div><span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 mr-2" />Veri Kaynağı</div>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-6 border-t border-cyan-400/10">
              {[
                ['AKTİF KAYIT', feed.length], ['KRİTİK OLAY', emergencyCount], ['BRİFİNG', brief?.exists ? 'HAZIR' : 'BEKLİYOR'],
                ['AI', health?.ai?.configured ? 'ONLINE' : 'STANDBY'], ['QISKIT', 'AER'], ['SON DURUM', health?.ready ? 'READY' : 'CHECK'],
              ].map(([label, value]) => (
                <div key={label} className="p-2 text-center border-r border-cyan-400/10 last:border-r-0">
                  <div className="text-[11px] text-cyan-200">{value}</div><div className="text-[8px] text-white/30 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>
          <DecisionCards feed={feed} />
        </section>

        <aside className="space-y-2 min-h-0">
          <AlertPanel feed={feed} />
          <div className={PANEL}>
            <SectionTitle>Anatolia'ya Sor</SectionTitle>
            <div className="p-3">
              <div className="h-10 rounded border border-cyan-400/15 bg-black/20 flex items-center px-3 text-[10px] text-white/30">Komutunuzu yazın veya sesli sorun…</div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <button className="py-2 rounded border border-cyan-400/15 text-[9px] text-cyan-200/70"><Bot className="w-3 h-3 inline mr-1" /> HIZLI SORU</button>
                <button className="py-2 rounded border border-cyan-400/15 text-[9px] text-cyan-200/70"><Zap className="w-3 h-3 inline mr-1" /> SESLİ KOMUT</button>
              </div>
            </div>
          </div>
          <div className={PANEL}>
            <SectionTitle>Hızlı İşlemler</SectionTitle>
            <div className="grid grid-cols-3 gap-2 p-3">
              {[[Activity, 'Yeni Analiz'], [Upload, 'Dosya Yükle'], [FileText, 'Raporlar']].map(([Icon, label]) => (
                <div key={label} className="rounded border border-cyan-400/15 bg-cyan-400/5 py-3 text-center text-[8px] text-white/50">
                  <Icon className="w-4 h-4 mx-auto mb-1 text-cyan-300" />{label}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </motion.div>
  );
}
