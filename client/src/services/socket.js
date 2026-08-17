import { io } from 'socket.io-client';
import { getSocketBaseUrl } from './api.js';

let socket = null;

export function connectSocket(nickname, token = null) {
  if (socket?.connected) return socket;

  socket = io(getSocketBaseUrl(), {
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 5,
    reconnectionDelay: 2000,
    auth: { token },
  });

  socket.on('connect', () => {
    socket.emit('register', { nickname, token });
  });

  return socket;
}

export function getSocket() { return socket; }

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
