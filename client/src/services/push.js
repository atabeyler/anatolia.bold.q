// Web Push subscribe/unsubscribe for emergency notifications -- lets a
// closed/backgrounded browser tab still surface an emergency broadcast as an
// OS-level notification, delivered via server/src/lib/webPush.js.
import { api } from './api.js';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export function isPushSupported() {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window;
}

export async function getPushSubscriptionState() {
  if (!isPushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'subscribed' : 'unsubscribed';
}

export async function subscribeToPush() {
  if (!isPushSupported()) throw new Error('Bu tarayıcı push bildirimlerini desteklemiyor');

  const { publicKey } = await api.pushVapidPublicKey();
  if (!publicKey) throw new Error('Sunucuda push bildirimleri yapılandırılmamış');

  if (Notification.permission === 'default') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Bildirim izni verilmedi');
  } else if (Notification.permission === 'denied') {
    throw new Error('Bildirim izni engellenmiş — tarayıcı ayarlarından etkinleştirin');
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await api.pushSubscribe(sub.toJSON());
  return sub;
}

export async function unsubscribeFromPush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await api.pushUnsubscribe(endpoint).catch(() => {});
}
