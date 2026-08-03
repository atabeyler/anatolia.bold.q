import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X, Send, MessageCircle, Users, Lock, Building2, Video, PhoneOff, Mic, MicOff, Camera, CameraOff, Hand, MonitorUp, Disc, UserX } from 'lucide-react';
import { api, getCurrentUser, getToken } from '../services/api.js';
import { connectSocket, getSocket } from '../services/socket.js';
import VoiceButton from './VoiceButton.jsx';
import FileAttach, { FileMessageContent } from './FileAttach.jsx';
import { useLang } from '../services/langContext.jsx';

const PANELS = { CENTER: 'center', USERS: 'users', CHAT: 'chat' };
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const getIceServers = () => {
  const raw = import.meta.env.VITE_ICE_SERVERS;
  if (!raw) return DEFAULT_ICE_SERVERS;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_ICE_SERVERS;
};

const buildMessageWithFiles = (text, files) => {
  const note = text || '';
  const attachments = files
    .map((f) => `\n\n[📎 EKLİ DOSYA: ${f.filename}]\n${window.location.origin}${f.url}`)
    .join('');
  return `${note}${attachments}`;
};

const fixMojibake = (text) => {
  const s = String(text || '');
  const fixed = s
    .replaceAll('Ã§', 'ç')
    .replaceAll('Ã‡', 'Ç')
    .replaceAll('Ã¶', 'ö')
    .replaceAll('Ã–', 'Ö')
    .replaceAll('Ã¼', 'ü')
    .replaceAll('Ãœ', 'Ü')
    .replaceAll('Ä±', 'ı')
    .replaceAll('Ä°', 'İ')
    .replaceAll('ÅŸ', 'ş')
    .replaceAll('Åž', 'Ş')
    .replaceAll('ÄŸ', 'ğ')
    .replaceAll('Äž', 'Ğ')
    .replaceAll('ý', 'ı')
    .replaceAll('Ý', 'İ')
    .replaceAll('þ', 'ş')
    .replaceAll('Þ', 'Ş')
    .replaceAll('ð', 'ğ')
    .replaceAll('Ð', 'Ğ');

  // Fallback for replacement-char mojibake (�) seen in legacy logs.
  return fixed
    .replaceAll('g�r�nt�l�', 'görüntülü')
    .replaceAll('toplant�y�', 'toplantıyı')
    .replaceAll('toplant�ya', 'toplantıya')
    .replaceAll('toplant�dan', 'toplantıdan')
    .replaceAll('toplant�', 'toplantı')
    .replaceAll('ba�latt�', 'başlattı')
    .replaceAll('ba�lat�ld�', 'başlatıldı')
    .replaceAll('kat�ld�', 'katıldı')
    .replaceAll('kat�l', 'katıl')
    .replaceAll('ayr�ld�', 'ayrıldı')
    .replaceAll('ayr�l', 'ayrıl')
    .replaceAll('Mesajla�ma', 'Mesajlaşma')
    .replaceAll('kat�l�mc�', 'katılımcı');
};

export default function EmergencyButton({ authenticated }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState(PANELS.CENTER);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const dragRef = useRef({ dragging: false, moved: false, sx: 0, sy: 0, px: 24, py: 24 });

  useEffect(() => {
    const onOpen = (e) => {
      const targetUser = e?.detail?.targetUser;
      const forceChat = !!e?.detail?.forceChat;
      if (targetUser || forceChat) {
        window.dispatchEvent(new CustomEvent('aq:emergency:target-user', { detail: { targetUser } }));
        setPanel(PANELS.CHAT);
      } else {
        setPanel(PANELS.CENTER);
      }
      setOpen(true);
    };
    window.addEventListener('aq:emergency:open', onOpen);
    return () => window.removeEventListener('aq:emergency:open', onOpen);
  }, []);

  const onDragStart = (e) => {
    const p = e.touches ? e.touches[0] : e;
    dragRef.current = { dragging: true, moved: false, sx: p.clientX, sy: p.clientY, px: pos.x, py: pos.y };
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchmove', onDragMove, { passive: false });
    window.addEventListener('touchend', onDragEnd);
  };
  const onDragMove = (e) => {
    if (!dragRef.current.dragging) return;
    const p = e.touches ? e.touches[0] : e;
    if (e.cancelable) e.preventDefault();
    const dx = p.clientX - dragRef.current.sx;
    const dy = p.clientY - dragRef.current.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragRef.current.moved = true;
    const nx = Math.max(8, dragRef.current.px - dx);
    const ny = Math.max(8, dragRef.current.py - dy);
    setPos({ x: nx, y: ny });
  };
  const onDragEnd = () => {
    dragRef.current.dragging = false;
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    window.removeEventListener('touchmove', onDragMove);
    window.removeEventListener('touchend', onDragEnd);
  };

  return (
    <>
      <motion.button onMouseDown={onDragStart} onTouchStart={onDragStart} onClick={() => { if (!dragRef.current.moved) setOpen(true); }} className="fixed z-50 emergency-pulse rounded-full" style={{ right: `${pos.x}px`, bottom: `calc(${pos.y}px + env(safe-area-inset-bottom, 0px))` }} whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.96 }} aria-label={t('emergencyCenter')}>
        <div className="relative w-8 h-8 sm:w-10 sm:h-10 md:w-14 md:h-14 rounded-full btn-emergency flex items-center justify-center"><AlertTriangle className="w-3 h-3 sm:w-4 sm:h-4 md:w-6 md:h-6 text-white" /></div>
        <div className="absolute -top-7 sm:-top-8 md:-top-9 left-1/2 -translate-x-1/2 text-[7px] sm:text-[8px] md:text-[10px] tracking-[0.14em] sm:tracking-[0.2em] text-red-400 font-bold pointer-events-none text-center leading-tight whitespace-pre-line">
          {t('emergencyCenterButton')}
        </div>
      </motion.button>
      <AnimatePresence>{open && <EmergencyModal authenticated={authenticated} panel={panel} setPanel={setPanel} onClose={() => setOpen(false)} />}</AnimatePresence>
    </>
  );
}

function EmergencyModal({ authenticated, panel, setPanel, onClose }) {
  const { t } = useLang();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.9, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 30 }} onClick={(e) => e.stopPropagation()} className="bg-navy-light gold-glow-strong rounded-t-2xl sm:rounded-lg w-full max-w-2xl h-[92vh] sm:h-auto sm:max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-4 border-b border-crimson/40 bg-gradient-to-r from-crimson/20 to-transparent"><div className="flex items-center gap-3"><AlertTriangle className="text-crimson w-6 h-6" /><h2 className="font-display text-xl text-gold tracking-widest">{t('emergencyCenter')}</h2></div><button onClick={onClose} className="text-gold/60 hover:text-gold p-1" aria-label="Kapat"><X className="w-5 h-5" /></button></div>
        <div className="flex border-b border-gold/20 overflow-x-auto">
          <TabBtn active={panel === PANELS.CENTER} onClick={() => setPanel(PANELS.CENTER)}><Building2 className="w-4 h-4 mr-2" /> {t('reportToCenter')}</TabBtn>
          <TabBtn active={panel === PANELS.USERS} onClick={() => setPanel(PANELS.USERS)}><Users className="w-4 h-4 mr-2" /> {t('reportToUsers')}</TabBtn>
          <TabBtn active={panel === PANELS.CHAT} onClick={() => authenticated && setPanel(PANELS.CHAT)} locked={!authenticated}><MessageCircle className="w-4 h-4 mr-2" /> {t('messaging')} {!authenticated && <Lock className="w-3 h-3 ml-2" />}</TabBtn>
        </div>
        <div className="flex-1 overflow-auto p-3 sm:p-6">{panel === PANELS.CENTER && <CenterPanel />}{panel === PANELS.USERS && <UsersPanel />}{panel === PANELS.CHAT && (authenticated ? <ChatPanel /> : <LockedPanel />)}</div>
      </motion.div>
    </motion.div>
  );
}

function TabBtn({ children, active, onClick, locked }) { return <button onClick={onClick} disabled={locked} className={`min-w-[130px] sm:min-w-0 flex-1 flex items-center justify-center px-3 sm:px-4 py-3 text-[10px] sm:text-xs tracking-widest uppercase border-r border-gold/10 transition ${active ? 'bg-gold/10 text-gold border-b-2 border-b-gold' : locked ? 'text-gold/30 cursor-not-allowed' : 'text-gold/60 hover:text-gold hover:bg-gold/5'}`}>{children}</button>; }

function CenterPanel() {
  const { t } = useLang();
  const [msg, setMsg] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const send = async () => {
    if (!msg.trim() && attachedFiles.length === 0) return;
    setSending(true);
    const fullMsg = buildMessageWithFiles(msg, attachedFiles);
    try { await api.emergencyCenter(fullMsg); setDone(true); setMsg(''); setAttachedFiles([]); setTimeout(() => setDone(false), 3000); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[10px] text-gold/40 tracking-widest uppercase">{t('attachFileLabel')}</span>
        <FileAttach onFile={(f) => f && setAttachedFiles((prev) => [...prev, f])} compact />
        {attachedFiles.length > 0 && <span className="text-[10px] text-emerald-400 font-mono">✓ {attachedFiles.length} {t('filesAttached')}</span>}
      </div>
      <div className="relative">
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)}
          placeholder={attachedFiles.length > 0 ? t('fileNotePlaceholder') : t('emergencyMsg')} rows={6}
          className="w-full bg-navy/80 border border-gold/30 rounded p-3 pr-12 text-gold/90 font-serif focus:border-gold focus:outline-none" />
        <div className="absolute bottom-3 right-3"><VoiceButton mode="input" size="sm" onTranscript={text => setMsg(prev => prev ? prev + ' ' + text : text)} /></div>
      </div>
      <button onClick={send} disabled={sending || (!msg.trim() && attachedFiles.length === 0)} className="mt-4 w-full btn-emergency py-3 rounded font-display tracking-widest text-sm disabled:opacity-50">{sending ? t('sending') : done ? t('sent') : t('sendToCenter')}</button>
    </div>
  );
}

function UsersPanel() {
  const { t } = useLang();
  const [msg, setMsg] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const send = async () => {
    if (!msg.trim() && attachedFiles.length === 0) return;
    setSending(true);
    const fullMsg = buildMessageWithFiles(msg, attachedFiles);
    try { await api.emergencyUsers(fullMsg); setDone(true); setMsg(''); setAttachedFiles([]); setTimeout(() => setDone(false), 3000); }
    finally { setSending(false); }
  };

  return (
    <div>
      <div className="bg-gold/10 border border-gold/40 rounded p-3 mb-3 text-sm text-gold/90">{t('usersNote')}</div>
      <div className="flex items-center gap-3 mb-3 flex-wrap">
        <span className="text-[10px] text-gold/40 tracking-widest uppercase">{t('attachFileLabel')}</span>
        <FileAttach onFile={(f) => f && setAttachedFiles((prev) => [...prev, f])} compact />
        {attachedFiles.length > 0 && <span className="text-[10px] text-emerald-400 font-mono">✓ {attachedFiles.length} {t('filesAttached')}</span>}
      </div>
      <div className="relative">
        <textarea value={msg} onChange={(e) => setMsg(e.target.value)}
          placeholder={attachedFiles.length > 0 ? t('fileNotePlaceholder') : t('usersMsg')} rows={6}
          className="w-full bg-navy/80 border border-gold/30 rounded p-3 pr-12 text-gold/90 font-serif focus:border-gold focus:outline-none" />
        <div className="absolute bottom-3 right-3"><VoiceButton mode="input" size="sm" onTranscript={text => setMsg(prev => prev ? prev + ' ' + text : text)} /></div>
      </div>
      <button onClick={send} disabled={sending || (!msg.trim() && attachedFiles.length === 0)} className="mt-4 w-full btn-gold py-3 rounded font-display tracking-widest text-sm disabled:opacity-50">{sending ? t('sending') : done ? t('sentAll') : t('sendToUsers')}</button>
    </div>
  );
}

function LockedPanel() { const { t } = useLang(); return <div className="text-center py-12"><Lock className="w-16 h-16 text-gold/40 mx-auto mb-4" /><h3 className="text-lg font-display text-gold/70 tracking-widest mb-2">{t('lockedPanel')}</h3><p className="text-sm text-gold/50 max-w-md mx-auto">{t('lockedNote')}</p></div>; }

function ChatPanel() {
  const { t } = useLang();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [otherUser, setOtherUser] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const me = getCurrentUser();
  const myNick = me?.isAdmin ? 'BOLD' : (me?.nickname || me?.userCode);
  const isAdmin = !!me?.isAdmin;
  const scrollRef = useRef(null);
  const localVideoRef = useRef(null);
  const [meetingActive, setMeetingActive] = useState(false);
  const [inMeeting, setInMeeting] = useState(false);
  const [localStream, setLocalStream] = useState(null);
  const [remotePeers, setRemotePeers] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [meetingLogs, setMeetingLogs] = useState([]);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [handRaised, setHandRaised] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const [screenStream, setScreenStream] = useState(null);
  const peersRef = useRef(new Map());
  const joinedPeersRef = useRef(new Set());
  const localStreamRef = useRef(null);
  const otherUserRef = useRef('');
  const roomId = 'acil-toplanti';

  useEffect(() => {
    otherUserRef.current = otherUser;
  }, [otherUser]);

  useEffect(() => {
    localStreamRef.current = localStream;
  }, [localStream]);

  useEffect(() => {
    const sock = connectSocket(myNick, getToken());
    if (!sock) return;
    const onReceive = (m) => setMessages((prev) => [...prev, m]);
    const onSent = (m) => setMessages((prev) => [...prev, { ...m, mine: true }]);
    const onOnline = (users) => {
      setOnlineUsers(users.filter(u => u !== myNick));
      if (!otherUserRef.current && users.length > 1) setOtherUser(users.find(u => u !== myNick) || '');
    };
    const onHistory = (rows) => setMessages(rows.map(r => ({ from: r.from_user, message: r.message, timestamp: r.created_at, mine: r.from_user === myNick })));
    sock.on('chat:receive', onReceive); sock.on('chat:sent', onSent); sock.on('users:online', onOnline); sock.on('chat:history:result', onHistory);
    sock.emit('users:request');
    sock.emit('video:meeting:status', { roomId });

    const onMeetingStarted = () => setMeetingActive(true);
    const onMeetingEnded = () => {
      setMeetingActive(false);
      leaveMeeting();
    };
    const onMeetingStatus = ({ active }) => setMeetingActive(!!active);
    const onMeetingStatusFull = ({ meeting }) => {
      if (meeting?.participants) setParticipants(meeting.participants);
      if (meeting?.logs) setMeetingLogs(meeting.logs);
    };
    const shouldCreateOfferTo = (peerId) => {
      const myId = getSocket()?.id || '';
      // Deterministic rule: only the peer with the lexically smaller id creates the offer.
      return !!myId && myId < peerId;
    };
    const onPeers = ({ peers }) => {
      peers.forEach((peerId) => {
        joinedPeersRef.current.add(peerId);
        if (shouldCreateOfferTo(peerId)) createOffer(peerId);
        else if (!peersRef.current.get(peerId)) makePeer(peerId);
      });
    };
    const onPeerJoined = ({ peerId }) => {
      joinedPeersRef.current.add(peerId);
      if (shouldCreateOfferTo(peerId)) createOffer(peerId);
      else if (!peersRef.current.get(peerId)) makePeer(peerId);
    };
    const onPeerLeft = ({ peerId }) => {
      joinedPeersRef.current.delete(peerId);
      const pc = peersRef.current.get(peerId);
      if (pc) pc.close();
      peersRef.current.delete(peerId);
      setRemotePeers((prev) => prev.filter((p) => p.peerId !== peerId));
    };
    const onSignal = async ({ from, data }) => {
      let pc = peersRef.current.get(from);
      if (!pc) pc = makePeer(from);
      if (data?.type === 'offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sock.emit('video:signal', { roomId, to: from, data: answer });
      } else if (data?.type === 'answer') {
        await pc.setRemoteDescription(new RTCSessionDescription(data));
      } else if (data?.candidate) {
        try { await pc.addIceCandidate(new RTCIceCandidate(data)); } catch {}
      }
    };
    const onParticipants = ({ participants: p }) => setParticipants(p || []);
    const onLogs = ({ logs }) => setMeetingLogs(logs || []);
    const onKicked = () => leaveMeeting();
    const onAdminMute = ({ mute }) => {
      const ls = localStreamRef.current;
      if (!ls) return;
      ls.getAudioTracks().forEach((t) => { t.enabled = !mute; });
      setMicOn(!mute);
      emitMediaState({ micOn: !mute });
    };
    sock.on('video:meeting:started', onMeetingStarted);
    sock.on('video:meeting:ended', onMeetingEnded);
    sock.on('video:meeting:status:result', onMeetingStatus);
    sock.on('video:meeting:status:result', onMeetingStatusFull);
    sock.on('video:peers', onPeers);
    sock.on('video:peer-joined', onPeerJoined);
    sock.on('video:peer-left', onPeerLeft);
    sock.on('video:signal', onSignal);
    sock.on('video:participants:update', onParticipants);
    sock.on('video:logs:result', onLogs);
    sock.on('video:admin:kicked', onKicked);
    sock.on('video:admin:mute', onAdminMute);
    return () => {
      sock.off('chat:receive', onReceive);
      sock.off('chat:sent', onSent);
      sock.off('users:online', onOnline);
      sock.off('chat:history:result', onHistory);
      sock.off('video:meeting:started', onMeetingStarted);
      sock.off('video:meeting:ended', onMeetingEnded);
      sock.off('video:meeting:status:result', onMeetingStatus);
      sock.off('video:meeting:status:result', onMeetingStatusFull);
      sock.off('video:peers', onPeers);
      sock.off('video:peer-joined', onPeerJoined);
      sock.off('video:peer-left', onPeerLeft);
      sock.off('video:signal', onSignal);
      sock.off('video:participants:update', onParticipants);
      sock.off('video:logs:result', onLogs);
      sock.off('video:admin:kicked', onKicked);
      sock.off('video:admin:mute', onAdminMute);
    };
  }, [myNick]);

  useEffect(() => {
    return () => {
      leaveMeeting();
    };
  }, []);

  useEffect(() => {
    if (!inMeeting || !localStream || !localVideoRef.current) return;
    localVideoRef.current.srcObject = localStream;
    localVideoRef.current.muted = true;
    localVideoRef.current.play?.().catch(() => {});
  }, [inMeeting, localStream]);

  useEffect(() => {
    if (!localStream) return;
    peersRef.current.forEach((pc, peerId) => {
      const senders = pc.getSenders();
      const hasAudio = senders.some((s) => s.track?.kind === 'audio');
      const hasVideo = senders.some((s) => s.track?.kind === 'video');
      localStream.getAudioTracks().forEach((track) => {
        if (!hasAudio) pc.addTrack(track, localStream);
      });
      localStream.getVideoTracks().forEach((track) => {
        if (!hasVideo) pc.addTrack(track, localStream);
      });
      createOffer(peerId).catch(() => {});
    });
  }, [localStream]);

  useEffect(() => {
    if (!inMeeting) return;
    const myId = getSocket()?.id;
    if (!myId) return;
    participants
      .map((p) => p.peerId)
      .filter((peerId) => peerId && peerId !== myId)
      .forEach((peerId) => {
        if (!peersRef.current.get(peerId)) {
          makePeer(peerId);
        }
        if (myId < peerId) createOffer(peerId).catch(() => {});
      });
  }, [participants, inMeeting]);

  useEffect(() => { if (otherUser) getSocket()?.emit('chat:history', { withUser: otherUser }); }, [otherUser]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);
  useEffect(() => {
    const onTarget = (e) => {
      const tu = e?.detail?.targetUser;
      if (tu) setOtherUser(tu);
    };
    window.addEventListener('aq:emergency:target-user', onTarget);
    return () => window.removeEventListener('aq:emergency:target-user', onTarget);
  }, []);

  const send = () => {
    if ((!input.trim() && attachedFiles.length === 0) || !otherUser) return;
    const fullMsg = buildMessageWithFiles(input, attachedFiles);
    if (otherUser === 'MERKEZ') {
      api.emergencyCenter(fullMsg).then(() => {
        setMessages((prev) => [...prev, { from: 'You', message: fullMsg, timestamp: new Date(), mine: true }]);
        setMessages((prev) => [...prev, { from: t('centerUser'), message: t('centerForwarded'), timestamp: new Date(), mine: false }]);
        setInput('');
        setAttachedFiles([]);
      });
    } else {
      getSocket()?.emit('chat:send', { to: otherUser, message: fullMsg });
      setInput('');
      setAttachedFiles([]);
    }
  };

  const makePeer = (peerId) => {
    const sock = getSocket();
    const pc = new RTCPeerConnection({
      iceServers: getIceServers(),
      iceCandidatePoolSize: 10,
    });
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }
    pc.onicecandidate = (e) => {
      if (e.candidate) sock?.emit('video:signal', { roomId, to: peerId, data: e.candidate });
    };
    pc.ontrack = (e) => {
      const stream = e.streams?.[0];
      if (!stream) return;
      setRemotePeers((prev) => {
        const exists = prev.find((x) => x.peerId === peerId);
        if (exists) return prev.map((x) => (x.peerId === peerId ? { ...x, stream } : x));
        return [...prev, { peerId, stream }];
      });
    };
    peersRef.current.set(peerId, pc);
    // Simple network adaptation: cap video bitrate for low bandwidth
    const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (sender?.setParameters) {
      const p = sender.getParameters();
      p.encodings = p.encodings || [{}];
      p.encodings[0].maxBitrate = 300_000;
      sender.setParameters(p).catch(() => {});
    }
    return pc;
  };

  const createOffer = async (peerId) => {
    const sock = getSocket();
    let pc = peersRef.current.get(peerId);
    if (!pc) pc = makePeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    sock?.emit('video:signal', { roomId, to: peerId, data: offer });
  };

  const startMeeting = () => {
    if (!isAdmin) return;
    getSocket()?.emit('video:meeting:start');
    setMeetingActive(true);
    joinMeeting();
  };

  const joinMeeting = async () => {
    if (inMeeting) return;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    } catch {
      return;
    }
    setLocalStream(stream);
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.muted = true;
      localVideoRef.current.play?.().catch(() => {});
    }
    setInMeeting(true);
    setMicOn(true);
    setCamOn(true);
    getSocket()?.emit('video:join', { roomId });
    getSocket()?.emit('video:logs:request', { roomId });
    emitMediaState({ micOn: true, camOn: true, handRaised: false, screenOn: false });
  };

  const leaveMeeting = () => {
    getSocket()?.emit('video:leave', { roomId });
    peersRef.current.forEach((pc) => pc.close());
    peersRef.current.clear();
    joinedPeersRef.current.clear();
    setRemotePeers([]);
    stopRecording();
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
    }
    setLocalStream(null);
    setInMeeting(false);
    setHandRaised(false);
    setScreenOn(false);
    setRecording(false);
  };

  const endMeeting = () => {
    if (!isAdmin) return;
    getSocket()?.emit('video:meeting:end', { roomId });
    setMeetingActive(false);
    leaveMeeting();
  };

  const emitMediaState = (overrides = {}) => {
    getSocket()?.emit('video:media-state', {
      roomId,
      micOn,
      camOn,
      handRaised,
      screenOn,
      ...overrides,
    });
  };

  const toggleMic = () => {
    if (!localStream) return;
    const next = !micOn;
    localStream.getAudioTracks().forEach((t) => { t.enabled = next; });
    setMicOn(next);
    emitMediaState({ micOn: next });
  };

  const toggleCam = () => {
    if (!localStream) return;
    const next = !camOn;
    localStream.getVideoTracks().forEach((t) => { t.enabled = next; });
    setCamOn(next);
    emitMediaState({ camOn: next });
  };

  const toggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    emitMediaState({ handRaised: next });
  };

  const toggleScreenShare = async () => {
    if (!inMeeting) return;
    const restoreCamera = () => {
      if (!localStream) return;
      const camTrack = localStream.getVideoTracks()[0];
      if (!camTrack) return;
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
        if (sender) sender.replaceTrack(camTrack).catch(() => {});
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = localStream;
    };
    if (screenOn) {
      screenStream?.getTracks().forEach((t) => t.stop());
      setScreenStream(null);
      setScreenOn(false);
      restoreCamera();
      emitMediaState({ screenOn: false });
      return;
    }
    try {
      const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      setScreenStream(s);
      const track = s.getVideoTracks()[0];
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((x) => x.track?.kind === 'video');
        if (sender) sender.replaceTrack(track);
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = s;
      setScreenOn(true);
      emitMediaState({ screenOn: true });
      track.onended = () => {
        restoreCamera();
        setScreenStream(null);
        setScreenOn(false);
        emitMediaState({ screenOn: false });
      };
    } catch {}
  };

  const startRecording = () => {
    if (!localStream || recording) return;
    recordChunksRef.current = [];
    const rec = new MediaRecorder(localStream, { mimeType: 'video/webm' });
    rec.ondataavailable = (e) => { if (e.data?.size) recordChunksRef.current.push(e.data); };
    rec.onstop = () => {
      const blob = new Blob(recordChunksRef.current, { type: 'video/webm' });
      if (!blob.size) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `acil-toplanti-${Date.now()}.webm`;
      a.click();
      URL.revokeObjectURL(url);
    };
    recorderRef.current = rec;
    rec.start(1000);
    setRecording(true);
  };

  const stopRecording = (setState = true) => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    if (setState) setRecording(false);
  };

  const kickPeer = (peerId) => {
    if (!isAdmin) return;
    getSocket()?.emit('video:admin:kick', { roomId, targetPeerId: peerId });
  };

  const mutePeer = (peerId, mute = true) => {
    if (!isAdmin) return;
    getSocket()?.emit('video:admin:mute', { roomId, targetPeerId: peerId, mute });
  };

  const fallbackNicks = ['BOLD', 'BOLD-001', 'BOLD-002', 'BOLD-003', 'BOLD-004', 'BOLD-005', 'BOLD-006', 'BOLD-007', 'BOLD-008', 'BOLD-009', 'BOLD-010'];
  const mergedTargets = Array.from(new Set([...(onlineUsers || []), ...fallbackNicks]))
    .filter((n) => n && n !== myNick);

  return (
    <div className="flex flex-col h-[60vh]">
      <div className="mb-2 flex items-center gap-2 flex-wrap">
        {isAdmin && !meetingActive && (
          <button onClick={startMeeting} className="border border-cyan-400/40 text-cyan-200 rounded px-2 py-1 text-xs flex items-center gap-1">
            <Video className="w-3.5 h-3.5" /> {t('startVideoMeeting')}
          </button>
        )}
        {meetingActive && !inMeeting && (
          <button onClick={joinMeeting} className="border border-emerald-400/40 text-emerald-200 rounded px-2 py-1 text-xs flex items-center gap-1">
            <Video className="w-3.5 h-3.5" /> {t('joinMeeting')}
          </button>
        )}
        {inMeeting && (
          <button onClick={leaveMeeting} className="border border-red-400/40 text-red-200 rounded px-2 py-1 text-xs flex items-center gap-1">
            <PhoneOff className="w-3.5 h-3.5" /> {t('leaveMeeting')}
          </button>
        )}
        {inMeeting && (
          <>
            <button onClick={toggleMic} className="border border-gold/40 text-gold rounded px-2 py-1 text-xs flex items-center gap-1">
              {micOn ? <Mic className="w-3.5 h-3.5" /> : <MicOff className="w-3.5 h-3.5" />}
              {t('micLabel')}
            </button>
            <button onClick={toggleCam} className="border border-gold/40 text-gold rounded px-2 py-1 text-xs flex items-center gap-1">
              {camOn ? <Camera className="w-3.5 h-3.5" /> : <CameraOff className="w-3.5 h-3.5" />}
              {t('camLabel')}
            </button>
            <button onClick={toggleHand} className={`border rounded px-2 py-1 text-xs flex items-center gap-1 ${handRaised ? 'border-cyan-300 text-cyan-200' : 'border-gold/40 text-gold'}`}>
              <Hand className="w-3.5 h-3.5" /> {t('raiseHand')}
            </button>
            <button onClick={toggleScreenShare} className="border border-gold/40 text-gold rounded px-2 py-1 text-xs flex items-center gap-1">
              <MonitorUp className="w-3.5 h-3.5" /> {t('shareScreen')}
            </button>
            {!recording ? (
              <button onClick={startRecording} className="border border-red-400/40 text-red-200 rounded px-2 py-1 text-xs flex items-center gap-1">
                <Disc className="w-3.5 h-3.5" /> {t('recordLabel')}
              </button>
            ) : (
              <button onClick={() => stopRecording(true)} className="border border-red-500/50 text-red-300 rounded px-2 py-1 text-xs">
                {t('stopRecordLabel')}
              </button>
            )}
          </>
        )}
        {isAdmin && meetingActive && (
          <button onClick={endMeeting} className="border border-red-500/50 text-red-300 rounded px-2 py-1 text-xs">
            {t('endForAll')}
          </button>
        )}
      </div>
      {inMeeting && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <video ref={localVideoRef} autoPlay muted playsInline className="w-full h-28 bg-black rounded border border-gold/20 object-cover" />
          {remotePeers.slice(0, 3).map((p) => (
            <VideoTile key={p.peerId} stream={p.stream} />
          ))}
        </div>
      )}
      {meetingActive && (
        <div className="mb-3 grid sm:grid-cols-2 gap-2">
          <div className="bg-navy/60 border border-gold/20 rounded p-2 max-h-28 overflow-auto">
            <div className="text-[10px] text-gold/60 mb-1">{t('participantsLabel')}</div>
            <div className="space-y-1">
              {participants.map((p) => (
                <div key={p.peerId} className="text-[11px] text-gold/90 flex items-center gap-1">
                  <span>{p.nickname}</span>
                  <span>{p.micOn ? '🎤' : '🔇'}</span>
                  <span>{p.camOn ? '📷' : '🚫'}</span>
                  {p.handRaised && <span>✋</span>}
                  {isAdmin && p.peerId !== getSocket()?.id && (
                    <>
                      <button
                        onClick={() => mutePeer(p.peerId, !!p.micOn)}
                        className="ml-auto text-red-300"
                        title={p.micOn ? t('muteParticipant') : t('unmuteParticipant')}
                        aria-label={p.micOn ? t('muteParticipant') : t('unmuteParticipant')}
                      >
                        {p.micOn ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                      </button>
                      <button
                        onClick={() => kickPeer(p.peerId)}
                        className="text-red-300"
                        title={t('removeParticipant')}
                        aria-label={t('removeParticipant')}
                      >
                        <UserX className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-navy/60 border border-gold/20 rounded p-2 max-h-28 overflow-auto">
            <div className="text-[10px] text-gold/60 mb-1">{t('meetingLogLabel')}</div>
            <div className="space-y-1">
              {meetingLogs.slice(-6).map((l, i) => (
                <div key={`${l.ts}-${i}`} className="text-[11px] text-gold/80">{fixMojibake(l.text)}</div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2 text-xs flex-wrap">
        <span className="text-gold/60">{t('messaging')}:</span>
        <select value={otherUser} onChange={(e) => setOtherUser(e.target.value)} className="bg-navy border border-gold/30 text-gold rounded px-2 py-1 font-mono">
          <option value="">{t('selectUser')}</option>
          <option value="MERKEZ">{t('centerUserOption')}</option>
          {mergedTargets.map(n => <option key={n} value={n}>{n} {onlineUsers.includes(n) ? '●' : '○'}</option>)}
        </select>
        <FileAttach onFile={(f) => f && setAttachedFiles((prev) => [...prev, f])} compact />
        {attachedFiles.length > 0 && <span className="text-[10px] text-emerald-400 font-mono">📎 {attachedFiles.length} dosya</span>}
      </div>
      <div ref={scrollRef} className="flex-1 overflow-auto bg-navy/50 rounded p-3 space-y-2 mb-3">
        {messages.length === 0 && <p className="text-center text-gold/40 text-sm py-8">{t('noMessages')}</p>}
        {messages.map((m, i) => <div key={i} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[75%] rounded-lg px-3 py-2 ${m.mine ? 'bg-gold/20 text-gold' : 'bg-navy-accent text-gold/90'}`}>{!m.mine && <div className="text-[10px] text-gold/50 mb-1">{m.from}</div>}<FileMessageContent text={m.message} /></div></div>)}
      </div>
      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={attachedFiles.length > 0 ? t('fileNoteShortPlaceholder') : (otherUser ? `${otherUser} ${t('messagePh')}` : t('selectUser'))} disabled={!otherUser} className="flex-1 bg-navy/80 border border-gold/30 rounded px-3 py-2 text-gold/90 focus:border-gold focus:outline-none disabled:opacity-50" />
        <VoiceButton mode="input" onTranscript={text => setInput(prev => prev ? prev + ' ' + text : text)} size="sm" />
        <button onClick={send} disabled={(!input.trim() && attachedFiles.length === 0) || !otherUser} className="btn-gold px-4 rounded disabled:opacity-50"><Send className="w-4 h-4" /></button>
      </div>
    </div>
  );
}

function VideoTile({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      ref.current.srcObject = stream;
      ref.current.muted = false;
      ref.current.play?.().catch(() => {});
    }
  }, [stream]);
  return <video ref={ref} autoPlay playsInline className="w-full h-28 bg-black rounded border border-gold/20 object-cover" />;
}
