import { and, asc, eq, or } from 'drizzle-orm';
import jwt from 'jsonwebtoken';
import { getDb, isDbConfigured } from '../db/client.js';
import { messages } from '../db/schema.js';
import { sendVideoMeetingStartedAlert } from './email.js';
import * as onlineState from '../lib/onlineState.js';
import { logger } from '../lib/logger.js';
import { JWT_SECRET } from '../lib/jwtSecret.js';

const adminSockets = new Set();
const activeMeetingByRoom = new Map();

// Both nickname and isAdmin must never be taken from client-supplied data
// (register payload) -- they are only ever derived here from a server-signed
// JWT (which already carries the correct nickname for the logged-in user,
// see routes/auth.js), so a client cannot register under someone else's
// nickname (hijacking their presence/DMs) or self-declare admin powers by
// sending {nickname: 'someone-else', isAdmin: true} over the socket.
function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

export function initSocketHandlers(io) {
  io.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'New connection');

    socket.on('register', async (payload) => {
      const token = typeof payload === 'string' ? socket.handshake.auth?.token : (payload?.token || socket.handshake.auth?.token);
      const decoded = verifyToken(token);
      if (!decoded?.nickname) return;

      const nickname = decoded.nickname;
      const isAdmin = !!decoded.isAdmin;

      await onlineState.setOnline(nickname, socket.id);
      socket.nickname = nickname;
      socket.isAdmin = isAdmin;
      if (isAdmin) adminSockets.add(socket.id);

      io.emit('users:online', await onlineState.getOnlineNicknames());
      logger.info({ nickname, isAdmin }, 'User connected');
    });

    socket.on('users:request', async () => {
      socket.emit('users:online', await onlineState.getOnlineNicknames());
    });

    socket.on('chat:send', async (data) => {
      const { to, message } = data;
      const from = socket.nickname;
      if (!from) return;

      try {
        if (isDbConfigured()) {
          await getDb().insert(messages).values({ fromUser: from, toUser: to || null, message, messageType: 'chat' });
        }
      } catch (e) {
        logger.error({ err: e }, 'DB message save error');
      }

      const payload = { from, message, timestamp: Date.now() };
      if (to) {
        const targetSocket = await onlineState.getOnlineSocketId(to);
        if (targetSocket) io.to(targetSocket).emit('chat:receive', payload);
      } else {
        socket.broadcast.emit('chat:receive', payload);
      }
      socket.emit('chat:sent', payload);
    });

    socket.on('chat:history', async ({ withUser }) => {
      if (!isDbConfigured()) return socket.emit('chat:history:result', []);
      try {
        const me = socket.nickname;
        const rows = await getDb()
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.messageType, 'chat'),
              or(
                and(eq(messages.fromUser, me), eq(messages.toUser, withUser)),
                and(eq(messages.fromUser, withUser), eq(messages.toUser, me))
              )
            )
          )
          .orderBy(asc(messages.createdAt))
          .limit(200);
        socket.emit(
          'chat:history:result',
          rows.map((r) => ({
            id: r.id,
            from_user: r.fromUser,
            to_user: r.toUser,
            message: r.message,
            message_type: r.messageType,
            created_at: r.createdAt,
          }))
        );
      } catch (e) {
        logger.error({ err: e }, 'Chat history query error');
        socket.emit('chat:history:result', []);
      }
    });

    socket.on('location:update', async (data) => {
      if (!socket.nickname) return;
      const { lat, lng, city } = data || {};
      if (typeof lat !== 'number' || typeof lng !== 'number') return;
      await onlineState.setLocation(socket.nickname, { lat, lng, city: city || null, updatedAt: Date.now() });

      const snapshot = await onlineState.getAllLocations();
      for (const sid of adminSockets) io.to(sid).emit('locations:update', snapshot);
    });

    socket.on('locations:request', async () => {
      if (!socket.isAdmin) return;
      socket.emit('locations:update', await onlineState.getAllLocations());
    });

    socket.on('video:meeting:start', () => {
      if (!socket.isAdmin) return;
      const roomId = 'acil-toplanti';
      const startedAt = Date.now();
      sendVideoMeetingStartedAlert(socket.nickname).catch(() => {});
      activeMeetingByRoom.set(roomId, {
        host: socket.nickname,
        startedAt,
        participants: new Map(),
        logs: [{ ts: startedAt, text: `${socket.nickname} toplantıyı başlattı` }],
      });
      io.emit('video:meeting:started', { roomId, host: socket.nickname, startedAt });
      io.to(roomId).emit('video:logs:result', { roomId, logs: activeMeetingByRoom.get(roomId)?.logs?.slice(-100) || [] });
      io.emit('notification:new', {
        type: 'system',
        title: 'VIDEO_MEETING_STARTED',
        body: `${socket.nickname} görüntülü toplantı başlattı.`,
        action: 'open-emergency-chat',
        initiator: socket.nickname,
        ts: startedAt,
      });
      // Also surface the meeting-start event in the app's notification center.
      io.emit('emergency:broadcast', {
        from: 'MERKEZ',
        message: `Görüntülü toplantı başlatıldı (${socket.nickname}). Acil Merkez > Mesajlaşma panelinden katılabilirsiniz.`,
        initiator: socket.nickname,
        timestamp: startedAt,
      });
    });

    socket.on('video:meeting:end', ({ roomId }) => {
      if (!socket.isAdmin) return;
      const rid = roomId || 'acil-toplanti';
      activeMeetingByRoom.delete(rid);
      io.to(rid).emit('video:meeting:ended', { roomId: rid });
      io.socketsLeave(rid);
    });

    socket.on('video:meeting:status', ({ roomId }) => {
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      socket.emit('video:meeting:status:result', {
        roomId: rid,
        active: !!meeting,
        meeting: meeting
          ? {
              host: meeting.host,
              startedAt: meeting.startedAt,
              participants: Array.from(meeting.participants.values()),
              logs: meeting.logs.slice(-100),
            }
          : null,
      });
    });

    socket.on('video:join', ({ roomId }) => {
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      if (!meeting) return;
      socket.join(rid);
      meeting.participants.set(socket.id, {
        peerId: socket.id,
        nickname: socket.nickname,
        isAdmin: !!socket.isAdmin,
        micOn: true,
        camOn: true,
        handRaised: false,
      });
      meeting.logs.push({ ts: Date.now(), text: `${socket.nickname} toplantıya katıldı` });
      const peers = Array.from(io.sockets.adapter.rooms.get(rid) || [])
        .filter((sid) => sid !== socket.id);
      socket.emit('video:peers', { roomId: rid, peers });
      io.to(rid).emit('video:participants:update', {
        roomId: rid,
        participants: Array.from(meeting.participants.values()),
      });
      io.to(rid).emit('video:logs:result', { roomId: rid, logs: meeting.logs.slice(-100) });
      socket.to(rid).emit('video:peer-joined', { roomId: rid, peerId: socket.id, nickname: socket.nickname });
    });

    socket.on('video:leave', ({ roomId }) => {
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      if (meeting) {
        meeting.participants.delete(socket.id);
        meeting.logs.push({ ts: Date.now(), text: `${socket.nickname || socket.id} toplantıdan ayrıldı` });
        io.to(rid).emit('video:participants:update', {
          roomId: rid,
          participants: Array.from(meeting.participants.values()),
        });
        io.to(rid).emit('video:logs:result', { roomId: rid, logs: meeting.logs.slice(-100) });
      }
      socket.leave(rid);
      socket.to(rid).emit('video:peer-left', { roomId: rid, peerId: socket.id });
    });

    socket.on('video:signal', ({ roomId, to, data }) => {
      const rid = roomId || 'acil-toplanti';
      if (!to) return;
      io.to(to).emit('video:signal', { roomId: rid, from: socket.id, data });
    });

    socket.on('video:media-state', ({ roomId, micOn, camOn, handRaised, screenOn }) => {
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      if (!meeting) return;
      const p = meeting.participants.get(socket.id);
      if (!p) return;
      if (typeof micOn === 'boolean') p.micOn = micOn;
      if (typeof camOn === 'boolean') p.camOn = camOn;
      if (typeof handRaised === 'boolean') p.handRaised = handRaised;
      if (typeof screenOn === 'boolean') p.screenOn = screenOn;
      io.to(rid).emit('video:participants:update', {
        roomId: rid,
        participants: Array.from(meeting.participants.values()),
      });
    });

    socket.on('video:admin:kick', ({ roomId, targetPeerId }) => {
      if (!socket.isAdmin || !targetPeerId) return;
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      if (!meeting) return;
      meeting.logs.push({ ts: Date.now(), text: `${socket.nickname} katılımcı çıkardı` });
      io.to(targetPeerId).emit('video:admin:kicked', { roomId: rid });
    });

    socket.on('video:admin:mute', ({ roomId, targetPeerId, mute }) => {
      if (!socket.isAdmin || !targetPeerId) return;
      const rid = roomId || 'acil-toplanti';
      io.to(targetPeerId).emit('video:admin:mute', { roomId: rid, mute: !!mute });
    });

    socket.on('video:logs:request', ({ roomId }) => {
      const rid = roomId || 'acil-toplanti';
      const meeting = activeMeetingByRoom.get(rid);
      if (!meeting) return socket.emit('video:logs:result', { roomId: rid, logs: [] });
      socket.emit('video:logs:result', { roomId: rid, logs: meeting.logs.slice(-100) });
    });

    socket.on('disconnect', async () => {
      for (const roomId of socket.rooms) {
        if (roomId !== socket.id) {
          const meeting = activeMeetingByRoom.get(roomId);
          if (meeting) {
            meeting.participants.delete(socket.id);
            io.to(roomId).emit('video:participants:update', {
              roomId,
              participants: Array.from(meeting.participants.values()),
            });
          }
          socket.to(roomId).emit('video:peer-left', { roomId, peerId: socket.id });
        }
      }
      if (socket.nickname) {
        await onlineState.removeOnline(socket.nickname);
        await onlineState.removeLocation(socket.nickname);
      }
      adminSockets.delete(socket.id);
      io.emit('users:online', await onlineState.getOnlineNicknames());
      logger.info({ nickname: socket.nickname || socket.id }, 'Connection disconnected');
    });
  });
}

export async function getOnlineUsers() {
  return onlineState.getOnlineNicknames();
}

export async function broadcastToUser(io, nickname, event, data) {
  const sid = await onlineState.getOnlineSocketId(nickname);
  if (sid) io.to(sid).emit(event, data);
}


