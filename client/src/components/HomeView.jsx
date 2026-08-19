import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, Atom, Bot, Database, HardDrive, History, Network, Radar, RefreshCw, Search, Server, ShieldCheck, Sparkles, Upload, Users, X, Zap } from 'lucide-react';
import TurkeyMap from './TurkeyMap.jsx';
import { api } from '../services/api.js';
import { useLang } from '../services/langContext.jsx';
import { localeFor } from '../services/i18n.js';

const PANEL = 'rounded-lg border border-cyan-400/15 bg-[#031326]/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.025)]';
const navigate = (view, category = null) => window.dispatchEvent(new CustomEvent('aq:navigate', { detail: { view, category } }));

function useCommandData() {
  const [health, setHealth] = useState(null);
  const [feed, setFeed] = useState([]);
  const [brief, setBrief] = useState(null);
  const loadBrief = async () => { const value = await api.morningBriefToday(); setBrief(value); return value; };
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [healthResult, feedResult, briefResult] = await Promise.allSettled([
        fetch('/api/v1/platform/health/ready', { cache: 'no-store' }).then((r) => r.json()), api.activityFeed(), api.morningBriefToday(),
      ]);
      if (!alive) return;
      if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
      if (feedResult.status === 'fulfilled' && Array.isArray(feedResult.value)) setFeed(feedResult.value);
      if (briefResult.status === 'fulfilled') setBrief(briefResult.value);
    };
    load(); const timer = setInterval(load, 30000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  return { health, feed, brief, loadBrief };
}

function SectionTitle({ children, action }) { return <div className="h-9 px-3 flex items-center border-b border-cyan-400/10"><span className="text-[10px] text-cyan-100 tracking-[0.15em] font-semibold uppercase">{children}</span>{action && <span className="ml-auto text-[9px] text-cyan-400/70">{action}</span>}</div>; }

function WorkspaceNav({ isAdmin, onOpenRadar }) {
  return <div className={`${PANEL} mb-2 px-2 flex items-center gap-1 overflow-x-auto`}>
    {[['KOMUTA','home'],['ANALİZ','analysis'],['İSTİHBARAT','history']].map(([label, view], i) => <button key={label} onClick={() => navigate(view)} className={`px-4 py-2.5 text-[10px] tracking-[0.18em] border-b-2 whitespace-nowrap ${i === 0 ? 'text-cyan-100 border-cyan-300 bg-cyan-400/5' : 'text-white/45 border-transparent hover:text-cyan-200'}`}>{label}</button>)}
    {isAdmin && <button onClick={onOpenRadar} className="px-4 py-2.5 text-[10px] tracking-[0.18em] border-b-2 border-transparent text-white/45 hover:text-cyan-200 whitespace-nowrap">YÖNETİM</button>}
    <div className="ml-auto hidden md:flex items-center gap-2 px-3 text-[9px] text-emerald-400/80"><ShieldCheck className="w-3.5 h-3.5" /> SECURE SESSION</div>
  </div>;
}

function EngineCard({ icon: Icon, name, detail, online }) { return <div className="min-w-[150px] flex-1 px-3 py-2 flex items-center gap-2.5 border-r border-white/5 last:border-r-0"><Icon className="w-5 h-5 text-cyan-300"/><div><div className="text-[10px] tracking-[0.14em] text-white/80 font-semibold">{name}</div><div className={`text-[9px] ${online ? 'text-emerald-400' : 'text-amber-300'}`}>{online ? '● ONLINE' : '● STANDBY'}</div><div className="text-[9px] text-white/30">{detail}</div></div></div>; }

function SystemPanel({ health, isAdmin, onOpenRadar }) {
  const rows = [['AI Sağlayıcıları', health?.ai?.configured ? 'Aktif':'Kontrol', Sparkles],['Veritabanı', health?.database?.ok ? 'Sağlıklı':'Kontrol',Database],['Quantum Worker',health?.quantum?.ok === false ? 'Sınırlı':'Aktif',Atom],['IBM Quantum',health?.quantum?.ibmConfigured ? 'Hazır':'Standby',Server],['Depolama',health?.storage?.persistentObjectStorageConfigured ? 'Object':'Yerel',HardDrive],['Gerçek Zaman','Aktif',Network]];
  return <div className={PANEL}><SectionTitle>Platform / Sistem Durumu</SectionTitle><div className="p-3 space-y-2">{rows.map(([label,value,Icon]) => <div key={label} className="flex items-center gap-2 text-[10px]"><Icon className="w-3.5 h-3.5 text-cyan-400/55"/><span className="text-white/55">{label}</span><span className="ml-auto text-white/75">{value}</span></div>)}{isAdmin && <button onClick={onOpenRadar} className="w-full mt-2 py-2 rounded border border-cyan-400/20 bg-cyan-400/5 text-[10px] text-cyan-200 flex items-center justify-center gap-2"><Radar className="w-3.5 h-3.5"/> Personel Radarı</button>}</div></div>;
}

function BriefingModal({ brief, onClose }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState(null);
  const items = (brief?.items || []).filter((x) => `${x.title || ''} ${x.source || ''}`.toLocaleLowerCase('tr-TR').includes(query.toLocaleLowerCase('tr-TR')));
  return <div className="fixed inset-0 z-[100] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4" role="dialog" aria-label="Brifing"><div className={`${PANEL} w-full max-w-3xl max-h-[82vh] flex flex-col`}><div className="p-4 border-b border-cyan-400/15 flex items-center"><div><div className="text-xs tracking-[0.2em] text-cyan-200">GÜNLÜK BRİFİNG</div><div className="text-[9px] text-white/35 mt-1">{brief?.date || 'Güncel'}</div></div><button onClick={onClose} aria-label="Kapat" className="ml-auto p-2 text-white/50"><X className="w-4 h-4"/></button></div><div className="p-3 border-b border-cyan-400/10"><div className="flex items-center gap-2 rounded border border-cyan-400/15 px-3"><Search className="w-3.5 h-3.5 text-cyan-300/60"/><input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Başlık veya kaynakta ara…" className="w-full bg-transparent py-2 text-xs text-white outline-none"/></div></div><div className="overflow-auto p-3 space-y-2">{items.map((item,i)=><button key={`${item.title}-${i}`} onClick={()=>setSelected(selected === i ? null : i)} className="w-full text-left rounded border border-cyan-400/10 bg-black/15 p-3"><div className="text-[11px] text-cyan-100">{i + 1}. {item.title || 'Başlıksız kayıt'}</div>{item.source && <div className="text-[9px] text-white/30 mt-1">{item.source}</div>}{selected === i && item.description && <div className="text-[10px] text-white/60 mt-2 border-t border-white/5 pt-2">{item.description}</div>}</button>)}{!items.length && <div className="text-center text-xs text-white/30 py-8">Eşleşen brifing kaydı yok</div>}</div></div></div>;
}

function SourcePanel({ brief, isAdmin, refreshing, error, onRefresh, onOpen }) {
  const count = Array.isArray(brief?.items) ? brief.items.length : 0;
  return <div className={PANEL}><SectionTitle action={isAdmin ? <button onClick={onRefresh} disabled={refreshing} className="flex items-center gap-1 hover:text-cyan-200"><RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin':''}`}/> Yenile</button> : null}>Veri Kaynakları</SectionTitle><div className="p-3 space-y-2">{[['Açık Kaynak İstihbaratı',count || '—'],['Resmi Raporlar','AKTİF'],['Haber Akışları','AKTİF'],['Ekonomik Veriler','AKTİF'],['Saha / Yüklenen Veri','HAZIR']].map(([name,value])=><div key={name} className="flex items-center text-[10px]"><Database className="w-3 h-3 text-cyan-400/45 mr-2"/><span className="text-white/50">{name}</span><span className="ml-auto text-emerald-400/80 text-[9px]">{value}</span></div>)}{brief?.exists && <button onClick={onOpen} className="w-full mt-2 py-2 rounded border border-cyan-400/20 bg-cyan-400/5 text-[10px] text-cyan-200">Brifing</button>}{error && <div className="text-[10px] text-red-300">{error}</div>}</div></div>;
}

function ActivityPanel({ feed, lang }) { const fmt=(d)=>{try{return new Date(d).toLocaleTimeString(localeFor(lang),{hour:'2-digit',minute:'2-digit'});}catch{return '--:--';}}; return <div className={`${PANEL} min-h-0 flex flex-col`}><SectionTitle action="SON 30 DK">Canlı Aktiviteler</SectionTitle><div className="p-3 space-y-2 overflow-auto">{feed.slice(0,7).map((item,i)=><div key={`${item.id}-${i}`} className="flex gap-2 text-[9px] border-l border-cyan-400/20 pl-2"><span className="text-cyan-300/55">{fmt(item.created_at)}</span><span className="text-white/50">{item.title || item.message || 'Sistem aktivitesi'}</span></div>)}{!feed.length && <div className="text-[10px] text-white/30">Henüz kayıt yok</div>}</div></div>; }
function AlertPanel({ feed }) { const alerts=feed.filter((x)=>x?.type==='emergency').slice(0,4); return <div className={PANEL}><SectionTitle action="CANLI">Kritik Uyarılar</SectionTitle><div className="p-2 space-y-2">{!alerts.length && <div className="p-4 text-center text-[10px] text-emerald-300/70"><ShieldCheck className="w-6 h-6 mx-auto mb-2"/>Aktif kritik uyarı bulunmuyor</div>}{alerts.map((x,i)=><div key={i} className="rounded border border-red-500/30 bg-red-500/5 p-2 text-[10px] text-white/70"><AlertTriangle className="w-3.5 h-3.5 text-red-400 inline mr-2"/>{x.message || 'Kritik sistem bildirimi'}</div>)}</div></div>; }
function DecisionCards({ feed }) { const cards=feed.filter((x)=>x?.type==='analysis').slice(0,4); return <div className={PANEL}><SectionTitle action="TÜM ANALİZLER →">Aktif Kararlar & Analizler</SectionTitle><div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 p-2">{(cards.length?cards:[{title:'Yeni karar analizi bekleniyor',category:'SİSTEM'}]).map((x,i)=><div key={i} className="rounded border border-cyan-400/15 p-3"><div className="text-[9px] text-cyan-300/60">{x.category || 'ANALİZ'}</div><div className="text-[11px] text-white/80 mt-2">{x.title}</div><button onClick={()=>navigate('history')} className="mt-3 text-[8px] text-cyan-200/70">DECISION TRACE</button></div>)}</div></div>; }

export default function HomeView({ isAdmin=false, onOpenRadar=null }) {
  const { lang }=useLang(); const { health,feed,brief,loadBrief }=useCommandData(); const [briefOpen,setBriefOpen]=useState(false); const [refreshing,setRefreshing]=useState(false); const [briefError,setBriefError]=useState('');
  const refreshBrief=async()=>{setRefreshing(true);setBriefError('');try{await api.morningBriefRefresh();const next=await loadBrief();if(!next?.exists)setBriefError('Briefing üretilemedi.');}catch{setBriefError('Yenileme başarısız.');}finally{setRefreshing(false);}};
  const emergencyCount=useMemo(()=>feed.filter((x)=>x?.type==='emergency').length,[feed]);
  const engines=[[Bot,'AI ENGINE','Provider',!!health?.ai?.configured],[Database,'DATA ENGINE','Veri motoru',!!health?.database?.ok],[Activity,'SCENARIO ENGINE','Senaryo analizi',true],[Atom,'QISKIT AER','Simulator',health?.quantum?.ok!==false],[Server,'IBM QUANTUM','Hardware verification',!!health?.quantum?.ibmConfigured],[Network,'SOCKET.IO','Gerçek zamanlı',true]];
  return <motion.div initial={{opacity:0}} animate={{opacity:1}} className="h-full min-h-0 overflow-auto bg-[#010a15] p-2 sm:p-3">
    <WorkspaceNav isAdmin={isAdmin} onOpenRadar={onOpenRadar}/><div className={`${PANEL} mb-2 overflow-x-auto`}><div className="flex min-w-[900px]">{engines.map(([Icon,name,detail,online])=><EngineCard key={name} icon={Icon} name={name} detail={detail} online={online}/>)}</div></div>
    <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_280px] gap-2 min-h-[520px]"><aside className="space-y-2"><SystemPanel health={health} isAdmin={isAdmin} onOpenRadar={onOpenRadar}/><SourcePanel brief={brief} isAdmin={isAdmin} refreshing={refreshing} error={briefError} onRefresh={refreshBrief} onOpen={()=>setBriefOpen(true)}/><ActivityPanel feed={feed} lang={lang}/></aside><section className="min-w-0 space-y-2"><div className={`${PANEL} overflow-hidden`}><SectionTitle action={<span className="text-emerald-400">● LIVE</span>}>Küresel Operasyon Görünümü</SectionTitle><div className="relative min-h-[330px] h-[42vh] max-h-[520px] overflow-hidden"><div className="absolute inset-0 opacity-90"><TurkeyMap/></div></div><div className="grid grid-cols-3 sm:grid-cols-6 border-t border-cyan-400/10">{[['AKTİF KAYIT',feed.length],['KRİTİK OLAY',emergencyCount],['BRİFİNG',brief?.exists?'HAZIR':'BEKLİYOR'],['AI',health?.ai?.configured?'ONLINE':'STANDBY'],['QISKIT','AER'],['SON DURUM',health?.ready?'READY':'CHECK']].map(([l,v])=><div key={l} className="p-2 text-center"><div className="text-[11px] text-cyan-200">{v}</div><div className="text-[8px] text-white/30">{l}</div></div>)}</div></div><DecisionCards feed={feed}/></section><aside className="space-y-2"><AlertPanel feed={feed}/><div className={PANEL}><SectionTitle>Anatolia'ya Sor</SectionTitle><div className="p-3"><button onClick={()=>navigate('analysis')} className="w-full h-10 rounded border border-cyan-400/15 text-[10px] text-white/40">Komutunuzu yazın veya analiz başlatın…</button><div className="grid grid-cols-2 gap-2 mt-2"><button onClick={()=>navigate('analysis')} className="py-2 border border-cyan-400/15 text-[9px] text-cyan-200"><Bot className="w-3 h-3 inline mr-1"/>HIZLI SORU</button><button onClick={()=>navigate('chat')} className="py-2 border border-cyan-400/15 text-[9px] text-cyan-200"><Zap className="w-3 h-3 inline mr-1"/>SESLİ KOMUT</button></div></div></div><div className={PANEL}><SectionTitle>Hızlı İşlemler</SectionTitle><div className="grid grid-cols-3 gap-2 p-3"><button onClick={()=>navigate('analysis')} className="text-[8px] text-cyan-200"><Activity className="w-4 h-4 mx-auto"/>Yeni Analiz</button><button onClick={()=>navigate('analysis')} className="text-[8px] text-cyan-200"><Upload className="w-4 h-4 mx-auto"/>Dosya Yükle</button><button onClick={()=>navigate('history')} className="text-[8px] text-cyan-200"><History className="w-4 h-4 mx-auto"/>Raporlar</button></div></div>{isAdmin&&<div className={PANEL}><SectionTitle>Yönetim</SectionTitle><button onClick={onOpenRadar} className="w-full p-3 text-[9px] text-cyan-200"><Users className="w-4 h-4 inline mr-2"/>Operasyon personeli ve radar görünümü</button></div>}</aside></div>
    {briefOpen&&brief?.exists&&<BriefingModal brief={brief} onClose={()=>setBriefOpen(false)}/>} 
  </motion.div>;
}
