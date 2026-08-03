import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { X, Check } from 'lucide-react';
import QuantumLogo from './QuantumLogo.jsx';

function DropdownOverlay({ onClose, closeLabel }) {
  return (
    <motion.button
      type="button"
      aria-label={closeLabel}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[69] bg-transparent cursor-default"
    />
  );
}

function MenuPanel({ t, onClose, onOpenGuide, onOpenInfo }) {
  const items = [
    { key: 'usageGuideTitle', onClick: onOpenGuide },
    { key: 'menuAboutUs', onClick: () => onOpenInfo('about') },
    { key: 'menuMissionVision', onClick: () => onOpenInfo('mission') },
    { key: 'menuContact', onClick: () => onOpenInfo('contact') },
  ];
  return (
    <>
      <DropdownOverlay onClose={onClose} closeLabel={t('menuTooltip')} />
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
        className="fixed top-16 right-3 sm:right-6 z-[70] w-[92vw] sm:w-[340px] border border-cyan-300/30 rounded-lg bg-[#061326]/95 backdrop-blur p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 pb-3 border-b border-gold/20">
          <div className="flex items-center gap-2">
            <QuantumLogo size="sm" />
            <div>
              <div className="font-display text-gold text-sm tracking-[0.2em]">{t('appName')}</div>
              <div className="text-[9px] text-gold/50 tracking-widest uppercase">{t('appSubtitle')}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-cyan-200/70 hover:text-cyan-100" title={t('menuTooltip')} aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1">
          {items.map((item) => (
            <button key={item.key} onClick={item.onClick}
              className="w-full text-left rounded px-2.5 py-2 text-sm text-cyan-100 hover:bg-white/5 hover:text-cyan-50 transition">
              {t(item.key)}
            </button>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-gold/20">
          <p className="text-[9px] text-gold/40 tracking-widest">{t('projectCode')}: QTR-200120401018</p>
          <p className="text-[9px] text-gold/40 mt-1 leading-relaxed">
            <span className="text-gold/60">{t('company')}</span>{' · '}{t('rights')}{' · '}{t('classified')}
          </p>
        </div>
      </motion.div>
    </>
  );
}

const SETTINGS_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
];

function SettingsPanel({ t, lang, setLang, onClose, soundEnabled, setSoundEnabled, soundVolume, setSoundVolume, sidebarCollapsed, setSidebarCollapsed, onOpenGuide, showAppearance = true }) {
  const [tab, setTab] = useState('language');
  const tabs = [
    { key: 'language', label: t('settingsLanguage') },
    { key: 'sound', label: t('settingsSound') },
    ...(showAppearance ? [{ key: 'appearance', label: t('settingsAppearance') }] : []),
    { key: 'about', label: t('settingsAbout') },
  ];
  return (
    <>
      <DropdownOverlay onClose={onClose} closeLabel={t('settingsTooltip')} />
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
        className="fixed top-16 right-3 sm:right-6 z-[70] w-[92vw] sm:w-[380px] max-h-[75vh] overflow-hidden flex flex-col border border-cyan-300/30 rounded-lg bg-[#061326]/95 backdrop-blur shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-gold/20 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-1 h-4 bg-cyan-400 rounded-full" />
            <div className="text-[11px] tracking-widest uppercase text-cyan-200">{t('settingsTitle')}</div>
          </div>
          <button onClick={onClose} className="text-cyan-200/70 hover:text-cyan-100" title={t('settingsTitle')} aria-label="Kapat">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex border-b border-gold/10 px-1 shrink-0">
          {tabs.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`relative px-3 py-2 text-[11px] tracking-wide uppercase transition ${tab === tb.key ? 'text-cyan-200' : 'text-cyan-100/40 hover:text-cyan-100/70'}`}>
              {tb.label}
              {tab === tb.key && <span className="absolute left-2 right-2 -bottom-px h-0.5 bg-cyan-400 rounded-full" />}
            </button>
          ))}
        </div>

        <div className="p-3 overflow-auto flex-1">
          {tab === 'language' && (
            <div className="space-y-0.5">
              {SETTINGS_LANGUAGES.map((l) => (
                <button key={l.code} onClick={() => setLang(l.code)}
                  dir={l.code === 'ar' ? 'rtl' : 'ltr'}
                  className={`w-full flex items-center justify-between px-2.5 py-2.5 rounded text-sm transition ${lang === l.code ? 'bg-cyan-500/10 text-cyan-100' : 'text-cyan-100/70 hover:bg-white/5'}`}>
                  <span>{l.label}</span>
                  {lang === l.code && <Check className="w-4 h-4 text-cyan-300 shrink-0" />}
                </button>
              ))}
            </div>
          )}

          {tab === 'sound' && (
            <div>
              <button onClick={() => setSoundEnabled((v) => !v)} className="w-full flex items-center justify-between text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2 mb-3">
                <span>{t('settingsSoundEnable')}</span>
                {soundEnabled ? <Check className="w-4 h-4 text-cyan-300" /> : <X className="w-4 h-4 text-cyan-100/40" />}
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-gold/50 shrink-0">{t('settingsSoundVolume')}</span>
                <input type="range" min="0.02" max="0.2" step="0.01" value={soundVolume} onChange={(e) => setSoundVolume(Number(e.target.value))} className="flex-1" />
              </div>
            </div>
          )}

          {tab === 'appearance' && (
            <button onClick={() => setSidebarCollapsed((v) => !v)} className="w-full flex items-center justify-between text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2">
              <span>{t('settingsCollapseSidebar')}</span>
              {sidebarCollapsed ? <Check className="w-4 h-4 text-cyan-300" /> : <X className="w-4 h-4 text-cyan-100/40" />}
            </button>
          )}

          {tab === 'about' && (
            <div>
              <p className="text-[12px] text-cyan-100/80 mb-3">{t('appName')} · {t('settingsVersion')} {__APP_VERSION__}</p>
              <button onClick={onOpenGuide} className="text-[12px] border border-cyan-300/30 text-cyan-100 rounded px-2.5 py-2">
                {t('settingsOpenGuide')}
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </>
  );
}

function InfoModal({ panel, t, onClose }) {
  const content = {
    about: { title: t('aboutUsTitle'), body: <p className="text-sm text-cyan-100/85 leading-relaxed">{t('aboutUsBody')}</p> },
    mission: {
      title: t('missionVisionTitle'),
      body: (
        <div className="space-y-3">
          <div>
            <div className="text-[10px] text-gold/60 tracking-widest uppercase mb-1">{t('missionLabel')}</div>
            <p className="text-sm text-cyan-100/85 leading-relaxed">{t('missionBody')}</p>
          </div>
          <div>
            <div className="text-[10px] text-gold/60 tracking-widest uppercase mb-1">{t('visionLabel')}</div>
            <p className="text-sm text-cyan-100/85 leading-relaxed">{t('visionBody')}</p>
          </div>
        </div>
      ),
    },
    contact: {
      title: t('contactTitle'),
      body: (
        <div className="space-y-2">
          <p className="text-sm text-cyan-100/85 leading-relaxed">{t('contactBody')}</p>
          <p className="text-xs text-gold/70">{t('contactEmailLabel')}: info@boldkimya.com.tr</p>
        </div>
      ),
    },
  }[panel];
  if (!content) return null;
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[71] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">{content.title}</h3>
          <button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100" aria-label="Kapat"><X className="w-5 h-5" /></button>
        </div>
        {content.body}
      </motion.div>
    </motion.div>
  );
}

const GUIDE_MODULES = {
  en: [
    { title: '1) Top Bar', items: [
      'NEW ANALYSIS: Opens the analysis workspace for a new report.',
      'CHAT: Opens the voice/chat consultation modal.',
      'HISTORY: Opens saved analyses.',
      'PERSONNEL RADAR: Opens live personnel location radar (admin visibility).',
      'NOTIFICATIONS (bell): Shows new chat/emergency notifications, with a type filter and sound on/off + volume.',
      'MENU: Usage Guide, About Us, Mission & Vision, and Contact.',
      'SETTINGS: Language, sound, appearance (collapse sidebar), and about.',
      'LOGOUT: Ends session and returns to login.'
    ] },
    { title: '2) Left Categories', items: [
      'HOME: Returns to the live map/dashboard.',
      'COLLAPSE/EXPAND: Shrinks the sidebar to icons only — toggle at the top of the sidebar or in Settings > Appearance.',
      'DEFENSE, ENERGY, OFFENSIVE, ECONOMY, SOCIAL EVENTS, CONSULTATION, HEALTH, MULTI-DOMAIN: Sets analysis context by domain.',
      'TIP: Select category first, then generate report for better contextual output.'
    ] },
    { title: '3) Analysis Screen', items: [
      'REPORT TITLE + ANALYSIS TOPIC/BRIEF: Main inputs for report generation.',
      'MICROPHONE BUTTON: Speech-to-text input for prompt fields.',
      'QUANTUM PROBABILITY MODE: Multi-scenario probability generation.',
      'GENERATE DETAILED ANALYSIS REPORT: Runs standard analysis.',
      'START QUANTUM PROBABILITY ANALYSIS: Runs quantum scenario mode.',
      'DOWNLOAD .DOCX: Downloads output as Word file.',
      'NEW ANALYSIS: Clears current output and starts fresh.',
      'TIP: Add clear prompt + title before generation for cleaner report structure.'
    ] },
    { title: '4) Emergency Center', items: [
      'REPORT TO CENTER: Sends urgent message to center.',
      'NOTIFY USERS: Broadcasts urgent message to active users.',
      'MESSAGING: User-to-user messaging (authenticated users).',
      'FILE ATTACH + VOICE INPUT: Supported in emergency forms and messaging.',
      'SEND buttons: Dispatch message to selected target.',
      'NOTE: In messaging tab, choose target user first, then send text/file.'
    ] },
    { title: '5) Home / Live Map', items: [
      'LIVE TACTICAL MAP: Central monitoring area.',
      'CITY PINS: Open regional emergency modal for selected city.',
      'MORNING BRIEF CARD: Shows daily brief status, refresh (admin), and full brief modal.',
      'ACTIVITY FEED: Lists recent analysis and emergency events.',
      'TIP: Use Briefing button for full list; use refresh (admin) when today brief is missing.'
    ] },
    { title: '6) Consultation Modal', items: [
      'VOICE TAB: Microphone-driven consultation flow.',
      'CHAT TAB: Text-based consultation flow.',
      'AUTO-LISTEN: Re-listens automatically after response.',
      'ARCHIVE / SAVE / CLEAR: Manage conversation history.',
      'BEST PRACTICE: Keep one topic per session for cleaner archive and recall.'
    ] }
  ],
  tr: [
    { title: '1) Üst Çubuk', items: [
      'YENİ ANALİZ: Analiz ekranını yeni rapor için açar.',
      'SOHBET: Sesli/yazılı danışma modülünü açar.',
      'GEÇMİŞ: Kaydedilmiş analizleri açar.',
      'PERSONEL RADARI: Canlı personel konum radarını açar (admin görünümü).',
      'BİLDİRİMLER (zil): Yeni mesaj/acil bildirimlerini, tür filtresi ve ses aç/kapat + seviye ayarıyla gösterir.',
      'MENÜ: Kullanım Kılavuzu, Hakkımızda, Misyon & Vizyon ve İletişim.',
      'AYARLAR: Dil, ses, görünüm (sol menüyü daralt) ve hakkında.',
      'ÇIKIŞ: Oturumu kapatır.'
    ] },
    { title: '2) Sol Kategoriler', items: [
      'ANA EKRAN: Canlı harita/izleme paneline döner.',
      'DARALT/GENİŞLET: Sol menüyü sadece ikonlara indirger — sol menünün üstünden veya Ayarlar > Görünüm\'den değiştirilebilir.',
      'SAVUNMA, ENERJİ, SALDIRI, EKONOMİ, TOPLUMSAL OLAYLAR, DANIŞMA, SAĞLIK, ÇOK ALANLI: Analiz bağlamını seçilen alana göre ayarlar.',
      'İPUCU: Raporu üretmeden önce kategori seçmek çıktı kalitesini artırır.'
    ] },
    { title: '3) Analiz Ekranı', items: [
      'RAPOR BAŞLIĞI + ANALİZ KONUSU/BRIEF: Rapor üretimi için ana girişlerdir.',
      'MİKROFON BUTONU: Prompt alanlarına sesli metin ekler.',
      'KUANTUM OLASILIK MODU: Çoklu senaryo olasılık üretimi yapar.',
      'DETAYLI ANALİZ RAPORU ÜRET: Standart analiz çalıştırır.',
      'KUANTUM OLASILIK ANALİZİ BAŞLAT: Kuantum senaryo akışını çalıştırır.',
      '.DOCX İNDİR: Çıktıyı Word dosyası olarak indirir.',
      'YENİ ANALİZ: Mevcut çıktıyı temizleyip yeni analize geçer.',
      'İPUCU: Net başlık + net brief, daha tutarlı rapor verir.'
    ] },
    { title: '4) Acil Merkez', items: [
      'MERKEZE BİLDİR: Acil mesajı merkeze yollar.',
      'KULLANICILARA BİLDİR: Acil mesajı aktif kullanıcılara toplu iletir.',
      'MESAJLAŞMA: Kullanıcıdan kullanıcıya mesajlaşma (onaylı giriş).',
      'DOSYA EKLE + SESLİ GİRİŞ: Acil formlarda ve mesajlaşmada kullanılabilir.',
      'GÖNDER BUTONLARI: Mesajı seçilen hedefe iletir.',
      'NOT: Mesajlaşmada önce hedef kullanıcı seçilmelidir.'
    ] },
    { title: '5) Ana Ekran / Canlı Harita', items: [
      'CANLI TAKTİK HARİTA: Merkez izleme alanıdır.',
      'ŞEHİR PİNLERİ: Seçilen şehir için bölgesel acil bildirim penceresini açar.',
      'GÜNLÜK İSTİHBARAT ÖZETİ KARTI: Günlük brifing durumu, yenile (admin) ve tam brifing penceresi.',
      'AKTİVİTE AKIŞI: Son analiz ve acil kayıtlarını listeler.',
      'İPUCU: Tüm başlıkları görmek için Brifing düğmesini kullanın.'
    ] },
    { title: '6) Danışma Modülü', items: [
      'SESLİ sekme: Mikrofon ile danışma akışı.',
      'SOHBET sekme: Yazılı danışma akışı.',
      'OTO-DİNLE: Yanıt sonrası otomatik tekrar dinleme.',
      'ARŞİV / KAYDET / TEMİZLE: Konuşma geçmişi yönetimi.',
      'EN İYİ KULLANIM: Her oturumda tek konu ilerlemek arşiv kalitesini artırır.'
    ] }
  ],
  de: [
    { title: '1) Obere Leiste', items: [
      'NEUE ANALYSE: Öffnet den Analysebereich für einen neuen Bericht.',
      'CHAT: Öffnet das Sprach-/Chat-Beratungsfenster.',
      'VERLAUF: Öffnet gespeicherte Analysen.',
      'PERSONALRADAR: Öffnet das Live-Standortradar für Personal (Admin-Ansicht).',
      'BENACHRICHTIGUNGEN (Glocke): Zeigt neue Chat-/Notfallbenachrichtigungen mit Typfilter und Ton an/aus + Lautstärke.',
      'MENÜ: Benutzerhandbuch, Über uns, Mission & Vision und Kontakt.',
      'EINSTELLUNGEN: Sprache, Ton, Darstellung (Seitenleiste einklappen) und Info.',
      'ABMELDEN: Beendet die Sitzung und kehrt zur Anmeldung zurück.'
    ] },
    { title: '2) Linke Kategorien', items: [
      'STARTSEITE: Kehrt zur Live-Karte/zum Dashboard zurück.',
      'EINKLAPPEN/ERWEITERN: Reduziert die Seitenleiste auf reine Symbole — oben in der Seitenleiste oder unter Einstellungen > Darstellung umschaltbar.',
      'VERTEIDIGUNG, ENERGIE, ANGRIFF, WIRTSCHAFT, GESELLSCHAFTLICHE EREIGNISSE, BERATUNG, GESUNDHEIT, MULTIDOMÄNE: Legt den Analysekontext nach Bereich fest.',
      'TIPP: Wählen Sie zuerst eine Kategorie, bevor Sie den Bericht erstellen, für ein besseres kontextbezogenes Ergebnis.'
    ] },
    { title: '3) Analysebildschirm', items: [
      'BERICHTSTITEL + ANALYSETHEMA/KURZBESCHREIBUNG: Haupteingaben für die Berichterstellung.',
      'MIKROFON-SCHALTFLÄCHE: Spracheingabe für Textfelder.',
      'QUANTENWAHRSCHEINLICHKEITSMODUS: Erzeugung mehrerer Szenariowahrscheinlichkeiten.',
      'DETAILLIERTEN ANALYSEBERICHT ERSTELLEN: Führt die Standardanalyse aus.',
      'QUANTENWAHRSCHEINLICHKEITSANALYSE STARTEN: Führt den Quanten-Szenariomodus aus.',
      '.DOCX HERUNTERLADEN: Lädt die Ausgabe als Word-Datei herunter.',
      'NEUE ANALYSE: Löscht die aktuelle Ausgabe und beginnt neu.',
      'TIPP: Fügen Sie vor der Erstellung einen klaren Prompt + Titel hinzu für eine klarere Berichtsstruktur.'
    ] },
    { title: '4) Notfallzentrum', items: [
      'AN ZENTRUM MELDEN: Sendet eine dringende Nachricht an das Zentrum.',
      'BENUTZER BENACHRICHTIGEN: Sendet eine dringende Nachricht an alle aktiven Benutzer.',
      'NACHRICHTEN: Benutzer-zu-Benutzer-Nachrichten (angemeldete Benutzer).',
      'DATEIANHANG + SPRACHEINGABE: In Notfallformularen und Nachrichten verfügbar.',
      'SENDEN-Schaltflächen: Sendet die Nachricht an das ausgewählte Ziel.',
      'HINWEIS: Wählen Sie im Nachrichten-Tab zuerst den Zielbenutzer, bevor Sie Text/Datei senden.'
    ] },
    { title: '5) Startseite / Live-Karte', items: [
      'LIVE-LAGEKARTE: Zentraler Überwachungsbereich.',
      'STADT-MARKIERUNGEN: Öffnet das regionale Notfallfenster für die ausgewählte Stadt.',
      'MORGENBERICHT-KARTE: Zeigt den täglichen Berichtsstatus, Aktualisieren (Admin) und das vollständige Berichtsfenster.',
      'AKTIVITÄTSSTROM: Listet aktuelle Analyse- und Notfallereignisse auf.',
      'TIPP: Nutzen Sie die Bericht-Schaltfläche für die vollständige Liste; Aktualisieren (Admin) verwenden, wenn der heutige Bericht fehlt.'
    ] },
    { title: '6) Beratungsfenster', items: [
      'SPRACH-TAB: Mikrofongesteuerter Beratungsablauf.',
      'CHAT-TAB: Textbasierter Beratungsablauf.',
      'AUTO-ZUHÖREN: Hört nach der Antwort automatisch erneut zu.',
      'ARCHIV / SPEICHERN / LÖSCHEN: Verwaltung des Gesprächsverlaufs.',
      'BEWÄHRTE PRAXIS: Ein Thema pro Sitzung für ein übersichtlicheres Archiv und Wiederauffinden.'
    ] }
  ],
  fr: [
    { title: '1) Barre Supérieure', items: [
      'NOUVELLE ANALYSE : Ouvre l\'espace d\'analyse pour un nouveau rapport.',
      'CHAT : Ouvre la fenêtre de consultation vocale/textuelle.',
      'HISTORIQUE : Ouvre les analyses enregistrées.',
      'RADAR DU PERSONNEL : Ouvre le radar de localisation du personnel en direct (visibilité admin).',
      'NOTIFICATIONS (cloche) : Affiche les nouvelles notifications de chat/urgence, avec filtre par type et son activé/désactivé + volume.',
      'MENU : Guide d\'Utilisation, À propos, Mission & Vision et Contact.',
      'PARAMÈTRES : Langue, son, apparence (réduire le menu latéral) et à propos.',
      'DÉCONNEXION : Termine la session et retourne à la connexion.'
    ] },
    { title: '2) Catégories de Gauche', items: [
      'ACCUEIL : Retourne à la carte en direct/tableau de bord.',
      'RÉDUIRE/DÉVELOPPER : Réduit le menu latéral aux icônes seules — bascule en haut du menu latéral ou dans Paramètres > Apparence.',
      'DÉFENSE, ÉNERGIE, OFFENSIVE, ÉCONOMIE, ÉVÉNEMENTS SOCIAUX, CONSULTATION, SANTÉ, MULTI-DOMAINES : Définit le contexte d\'analyse par domaine.',
      'CONSEIL : Sélectionnez d\'abord une catégorie, puis générez le rapport pour un meilleur résultat contextuel.'
    ] },
    { title: '3) Écran d\'Analyse', items: [
      'TITRE DU RAPPORT + SUJET D\'ANALYSE/BRIEF : Principales entrées pour la génération du rapport.',
      'BOUTON MICROPHONE : Saisie vocale pour les champs de texte.',
      'MODE DE PROBABILITÉ QUANTIQUE : Génération de probabilités multi-scénarios.',
      'GÉNÉRER UN RAPPORT D\'ANALYSE DÉTAILLÉ : Exécute l\'analyse standard.',
      'DÉMARRER L\'ANALYSE DE PROBABILITÉ QUANTIQUE : Exécute le mode scénario quantique.',
      'TÉLÉCHARGER .DOCX : Télécharge le résultat sous forme de fichier Word.',
      'NOUVELLE ANALYSE : Efface le résultat actuel et recommence.',
      'CONSEIL : Ajoutez une consigne claire + un titre avant la génération pour une structure de rapport plus claire.'
    ] },
    { title: '4) Centre d\'Urgence', items: [
      'SIGNALER AU CENTRE : Envoie un message urgent au centre.',
      'NOTIFIER LES UTILISATEURS : Diffuse un message urgent à tous les utilisateurs actifs.',
      'MESSAGERIE : Messagerie utilisateur à utilisateur (utilisateurs authentifiés).',
      'PIÈCE JOINTE + SAISIE VOCALE : Prises en charge dans les formulaires d\'urgence et la messagerie.',
      'Boutons ENVOYER : Envoie le message à la cible sélectionnée.',
      'REMARQUE : Dans l\'onglet messagerie, choisissez d\'abord l\'utilisateur cible, puis envoyez le texte/fichier.'
    ] },
    { title: '5) Accueil / Carte en Direct', items: [
      'CARTE TACTIQUE EN DIRECT : Zone de surveillance centrale.',
      'REPÈRES DE VILLE : Ouvre la fenêtre d\'urgence régionale pour la ville sélectionnée.',
      'CARTE DU BRIEF MATINAL : Affiche l\'état du brief quotidien, actualiser (admin) et la fenêtre complète du brief.',
      'FIL D\'ACTIVITÉ : Liste les événements d\'analyse et d\'urgence récents.',
      'CONSEIL : Utilisez le bouton Brief pour la liste complète ; utilisez Actualiser (admin) si le brief du jour est manquant.'
    ] },
    { title: '6) Fenêtre de Consultation', items: [
      'ONGLET VOCAL : Flux de consultation piloté par le microphone.',
      'ONGLET CHAT : Flux de consultation basé sur le texte.',
      'ÉCOUTE AUTO : Réécoute automatiquement après la réponse.',
      'ARCHIVER / ENREGISTRER / EFFACER : Gestion de l\'historique des conversations.',
      'BONNE PRATIQUE : Gardez un seul sujet par session pour un archivage et une recherche plus clairs.'
    ] }
  ],
  ar: [
    { title: '1) الشريط العلوي', items: [
      'تحليل جديد: يفتح مساحة عمل التحليل لتقرير جديد.',
      'محادثة: يفتح نافذة الاستشارة الصوتية/النصية.',
      'السجل: يفتح التحليلات المحفوظة.',
      'رادار الأفراد: يفتح رادار مواقع الأفراد المباشر (رؤية المسؤول).',
      'الإشعارات (الجرس): يعرض إشعارات المحادثة/الطوارئ الجديدة، مع فلتر حسب النوع وتشغيل/إيقاف الصوت + مستوى الصوت.',
      'القائمة: دليل الاستخدام، من نحن، الرسالة والرؤية، واتصل بنا.',
      'الإعدادات: اللغة، الصوت، المظهر (طي القائمة الجانبية)، وحول.',
      'تسجيل الخروج: ينهي الجلسة ويعود إلى صفحة الدخول.'
    ] },
    { title: '2) الفئات الجانبية', items: [
      'الرئيسية: يعود إلى الخريطة المباشرة/لوحة التحكم.',
      'طي/توسيع: يقلص القائمة الجانبية إلى أيقونات فقط — يمكن التبديل من أعلى القائمة الجانبية أو من الإعدادات > المظهر.',
      'الدفاع، الطاقة، الهجوم، الاقتصاد، الأحداث المجتمعية، الاستشارة، الصحة، متعدد المجالات: يحدد سياق التحليل حسب المجال.',
      'نصيحة: اختر الفئة أولاً، ثم أنشئ التقرير للحصول على نتيجة أكثر ملاءمة للسياق.'
    ] },
    { title: '3) شاشة التحليل', items: [
      'عنوان التقرير + موضوع التحليل/الموجز: المدخلات الرئيسية لإنشاء التقرير.',
      'زر الميكروفون: إدخال صوتي إلى نص لحقول الطلب.',
      'وضع الاحتمالية الكمية: إنشاء احتمالية متعددة السيناريوهات.',
      'إنشاء تقرير تحليل مفصل: يشغّل التحليل القياسي.',
      'بدء تحليل الاحتمالية الكمية: يشغّل وضع السيناريو الكمي.',
      'تنزيل .DOCX: ينزّل الناتج كملف Word.',
      'تحليل جديد: يمسح الناتج الحالي ويبدأ من جديد.',
      'نصيحة: أضف طلباً وعنواناً واضحين قبل الإنشاء للحصول على بنية تقرير أوضح.'
    ] },
    { title: '4) مركز الطوارئ', items: [
      'إبلاغ المركز: يرسل رسالة عاجلة إلى المركز.',
      'إخطار المستخدمين: يبث رسالة عاجلة إلى المستخدمين النشطين.',
      'المراسلة: مراسلة بين المستخدمين (للمستخدمين المعتمدين).',
      'إرفاق ملف + إدخال صوتي: مدعومان في نماذج الطوارئ والمراسلة.',
      'أزرار الإرسال: يرسل الرسالة إلى الهدف المحدد.',
      'ملاحظة: في تبويب المراسلة، اختر المستخدم المستهدف أولاً، ثم أرسل النص/الملف.'
    ] },
    { title: '5) الرئيسية / الخريطة المباشرة', items: [
      'الخريطة التكتيكية المباشرة: منطقة المراقبة المركزية.',
      'علامات المدن: يفتح نافذة الطوارئ الإقليمية للمدينة المحددة.',
      'بطاقة الموجز الصباحي: تعرض حالة الموجز اليومي، وزر التحديث (للمسؤول)، ونافذة الموجز الكاملة.',
      'سجل النشاط: يسرد أحدث أحداث التحليل والطوارئ.',
      'نصيحة: استخدم زر الموجز لعرض القائمة الكاملة؛ استخدم التحديث (للمسؤول) عند عدم توفر موجز اليوم.'
    ] },
    { title: '6) نافذة الاستشارة', items: [
      'تبويب الصوت: تدفق استشارة يعتمد على الميكروفون.',
      'تبويب المحادثة: تدفق استشارة نصي.',
      'الاستماع التلقائي: يعيد الاستماع تلقائياً بعد الرد.',
      'أرشفة / حفظ / مسح: إدارة سجل المحادثة.',
      'أفضل ممارسة: التزم بموضوع واحد لكل جلسة للحصول على أرشفة واسترجاع أوضح.'
    ] }
  ]
};

function GuideModal({ onClose, t, lang }) {
  const modules = GUIDE_MODULES[lang] || GUIDE_MODULES.tr;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[65] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }} onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-2xl h-[88vh] sm:h-auto sm:max-h-[85vh] overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">{t('usageGuideTitle')}</h3>
          <button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100" aria-label="Kapat"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-xs sm:text-sm text-gold/70 mb-4">{t('usageGuideIntro')}</p>
        <div className="space-y-4">
          {modules.map((m, i) => (
            <div key={i} className="border border-cyan-300/25 rounded-lg p-3 sm:p-4 bg-[#071225]/70">
              <h4 className="text-cyan-100 text-xs sm:text-sm tracking-widest mb-2">{m.title}</h4>
              <div className="space-y-1.5 text-xs sm:text-sm text-gold/90 leading-relaxed">
                {m.items.map((it, j) => <p key={j}>- {it}</p>)}
              </div>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

export { DropdownOverlay, MenuPanel, SettingsPanel, InfoModal, GuideModal };
