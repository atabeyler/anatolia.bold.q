import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { X, Trash2, ShieldOff, ShieldCheck, UserPlus, Pencil, ScrollText } from 'lucide-react';
import { adminApi } from '../services/api.js';

const AUDIT_ACTION_LABELS = {
  user_added: 'Kullanıcı eklendi',
  user_updated: 'Kullanıcı düzenlendi',
  user_blocked: 'Kullanıcı engellendi',
  user_unblocked: 'Engel kaldırıldı',
  user_deleted: 'Kullanıcı silindi',
};

function AuditLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    adminApi.auditLog()
      .then(setLogs)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-cyan-100/50">Yükleniyor…</p>;
  if (error) return <p className="text-xs text-red-300">{error}</p>;
  if (logs.length === 0) return <p className="text-sm text-cyan-100/50">Kayıt yok.</p>;

  return (
    <div className="space-y-1.5 max-h-[50vh] overflow-y-auto pr-1">
      {logs.map((log) => (
        <div key={log.id} className="border border-cyan-300/15 rounded px-3 py-2 bg-[#071225]/50 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="text-cyan-100">{AUDIT_ACTION_LABELS[log.action] || log.action}</span>
            <span className="text-cyan-100/40 shrink-0">{new Date(log.created_at).toLocaleString('tr-TR')}</span>
          </div>
          <div className="text-cyan-100/50 mt-1 font-mono">
            {log.actor_nickname || log.actor_user_code} → {log.target_user_code || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function EditRow({ u, onCancel, onSaved, setError }) {
  const [nickname, setNickname] = useState(u.nickname || '');
  const [isAdmin, setIsAdmin] = useState(!!u.is_admin);
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminApi.updateUser(u.user_code, {
        nickname,
        isAdmin,
        password: password || undefined,
      });
      setPassword('');
      onSaved();
    } catch (e2) {
      setError(e2.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="border border-cyan-300/25 rounded px-3 py-2.5 bg-[#071225]/70 space-y-2">
      <div className="text-xs text-cyan-100/50 font-mono">{u.user_code}</div>
      <div className="grid grid-cols-2 gap-2">
        <input placeholder="Rumuz" value={nickname} onChange={(e) => setNickname(e.target.value)}
          className="bg-black/30 border border-cyan-300/20 rounded px-2.5 py-1.5 text-sm text-cyan-100" />
        <input type="password" placeholder="Yeni şifre (opsiyonel)" value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bg-black/30 border border-cyan-300/20 rounded px-2.5 py-1.5 text-sm text-cyan-100 placeholder:text-cyan-100/30" />
      </div>
      <label className="flex items-center gap-2 text-sm text-cyan-100/80">
        <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} />
        Admin yetkisi
      </label>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving}
          className="px-3 py-1.5 text-xs tracking-widest uppercase rounded bg-cyan-500/20 border border-cyan-300/40 text-cyan-100 hover:bg-cyan-500/30 transition disabled:opacity-50">
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        <button type="button" onClick={onCancel}
          className="px-3 py-1.5 text-xs tracking-widest uppercase rounded border border-cyan-300/20 text-cyan-100/60 hover:text-cyan-100 transition">
          Vazgeç
        </button>
      </div>
    </form>
  );
}

export default function UserManagementModal({ onClose }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyCode, setBusyCode] = useState(null);
  const [editingCode, setEditingCode] = useState(null);
  const [form, setForm] = useState({ userCode: '', password: '', nickname: '', isAdmin: false });
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState('users');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await adminApi.listUsers();
      setUsers(rows);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!form.userCode || !form.password) return;
    setAdding(true);
    setError('');
    try {
      await adminApi.addUser(form.userCode, form.password, form.nickname, form.isAdmin);
      setForm({ userCode: '', password: '', nickname: '', isAdmin: false });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const toggleBlock = async (u) => {
    setBusyCode(u.user_code);
    setError('');
    try {
      await adminApi.setBlocked(u.user_code, !u.blocked);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCode(null);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`${u.user_code} kullanıcısını silmek istediğinize emin misiniz?`)) return;
    setBusyCode(u.user_code);
    setError('');
    try {
      await adminApi.deleteUser(u.user_code);
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyCode(null);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[71] bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}>
      <motion.div initial={{ y: 24, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 24, scale: 0.98 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-2xl h-[88vh] sm:h-auto sm:max-h-[85vh] overflow-auto hud-panel rounded-t-2xl sm:rounded-xl p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-cyan-100 font-display tracking-widest text-sm sm:text-lg">KULLANICI YÖNETİMİ</h3>
          <button onClick={onClose} className="text-cyan-100/70 hover:text-cyan-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex gap-1 mb-4 border-b border-cyan-300/15">
          <button onClick={() => setTab('users')}
            className={`px-3 py-1.5 text-xs tracking-widest uppercase transition ${tab === 'users' ? 'text-cyan-200 border-b-2 border-cyan-400' : 'text-cyan-100/40 hover:text-cyan-100/70'}`}>
            Kullanıcılar
          </button>
          <button onClick={() => setTab('audit')}
            className={`px-3 py-1.5 text-xs tracking-widest uppercase transition flex items-center gap-1.5 ${tab === 'audit' ? 'text-cyan-200 border-b-2 border-cyan-400' : 'text-cyan-100/40 hover:text-cyan-100/70'}`}>
            <ScrollText className="w-3.5 h-3.5" /> İşlem Kaydı
          </button>
        </div>

        {error && (
          <div className="mb-3 text-xs text-red-300 bg-red-500/10 border border-red-400/30 rounded px-3 py-2">{error}</div>
        )}

        {tab === 'audit' && <AuditLogTab />}

        {tab === 'users' && (
        <>
        <form onSubmit={handleAdd} className="mb-5 border border-cyan-300/25 rounded-lg p-3 bg-[#071225]/70">
          <div className="text-xs text-gold/70 tracking-widest uppercase mb-2 flex items-center gap-1.5">
            <UserPlus className="w-3.5 h-3.5" /> Yeni Kullanıcı Ekle
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input required placeholder="Kullanıcı kodu" value={form.userCode}
              onChange={(e) => setForm({ ...form, userCode: e.target.value })}
              className="bg-black/30 border border-cyan-300/20 rounded px-2.5 py-2 text-sm text-cyan-100 placeholder:text-cyan-100/30" />
            <input required type="password" placeholder="Şifre (min 8 karakter)" value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              className="bg-black/30 border border-cyan-300/20 rounded px-2.5 py-2 text-sm text-cyan-100 placeholder:text-cyan-100/30" />
            <input placeholder="Rumuz (opsiyonel)" value={form.nickname}
              onChange={(e) => setForm({ ...form, nickname: e.target.value })}
              className="bg-black/30 border border-cyan-300/20 rounded px-2.5 py-2 text-sm text-cyan-100 placeholder:text-cyan-100/30" />
            <label className="flex items-center gap-2 text-sm text-cyan-100/80 px-1">
              <input type="checkbox" checked={form.isAdmin}
                onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
              Admin yetkisi
            </label>
          </div>
          <button type="submit" disabled={adding}
            className="mt-2.5 w-full sm:w-auto px-4 py-2 text-xs tracking-widest uppercase rounded bg-cyan-500/20 border border-cyan-300/40 text-cyan-100 hover:bg-cyan-500/30 transition disabled:opacity-50">
            {adding ? 'Ekleniyor…' : 'Ekle'}
          </button>
        </form>

        <div className="space-y-1.5">
          {loading && <p className="text-sm text-cyan-100/50">Yükleniyor…</p>}
          {!loading && users.length === 0 && <p className="text-sm text-cyan-100/50">Kayıtlı kullanıcı yok.</p>}
          {users.map((u) => (
            editingCode === u.user_code ? (
              <EditRow key={u.user_code} u={u} setError={setError}
                onCancel={() => setEditingCode(null)}
                onSaved={() => { setEditingCode(null); load(); }} />
            ) : (
              <div key={u.user_code}
                className="flex items-center justify-between gap-2 border border-cyan-300/15 rounded px-3 py-2 bg-[#071225]/50">
                <div className="min-w-0">
                  <div className="text-sm text-cyan-100 flex items-center gap-2 flex-wrap">
                    <span className="font-mono">{u.user_code}</span>
                    {u.nickname && <span className="text-cyan-100/50">· {u.nickname}</span>}
                    {u.is_admin && <span className="text-[9px] px-1.5 py-0.5 rounded bg-gold/15 text-gold border border-gold/30">ADMIN</span>}
                    {u.blocked && <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-400/30">ENGELLİ</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => setEditingCode(u.user_code)} disabled={busyCode === u.user_code}
                    title="Düzenle"
                    className="p-1.5 rounded border border-cyan-300/30 text-cyan-200 hover:bg-cyan-500/10 transition disabled:opacity-40">
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button onClick={() => toggleBlock(u)} disabled={busyCode === u.user_code}
                    title={u.blocked ? 'Engeli kaldır' : 'Engelle'}
                    className={`p-1.5 rounded border transition disabled:opacity-40 ${
                      u.blocked
                        ? 'border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/10'
                        : 'border-amber-400/30 text-amber-300 hover:bg-amber-500/10'
                    }`}>
                    {u.blocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldOff className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(u)} disabled={busyCode === u.user_code}
                    title="Sil"
                    className="p-1.5 rounded border border-red-400/30 text-red-300 hover:bg-red-500/10 transition disabled:opacity-40">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )
          ))}
        </div>
        </>
        )}
      </motion.div>
    </motion.div>
  );
}
