/**
 * Netzwerk-Schicht des Clients: Socket.IO-Verbindung, Anfragen mit Antwort
 * (Ack) und gespeicherte Sitzungen für das Wiederverbinden.
 *
 * Sitzungen:
 *   sessionStorage 'mono.session'  → pro Tab (überlebt Neuladen); erlaubt
 *                                    mehrere Spieler in Tabs eines Browsers
 *   localStorage   'mono.sessions' → pro Raumcode (nach Schließen des Tabs)
 */
import { storage } from './util.js';

/* global io */
export const socket = io({ transports: ['websocket', 'polling'], reconnectionDelay: 500, reconnectionDelayMax: 4000 });

/** Anfrage an den Server; liefert immer { ok, error?, ... } */
export function send(event, data = {}) {
  return new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, error: 'Keine Verbindung zum Server.' });
      return;
    }
    socket.timeout(8000).emit(event, data, (err, res) => {
      if (err) resolve({ ok: false, error: 'Der Server antwortet nicht.' });
      else resolve(res || { ok: false, error: 'Leere Antwort.' });
    });
  });
}

export const on = (event, fn) => socket.on(event, fn);

/* --- Sitzungen ----------------------------------------------------------- */
const SESSION_MAX_AGE = 12 * 60 * 60 * 1000;

export function saveSession(sess) {
  storage.set('mono.session', sess, 'session');
  if (sess.playerId) {
    const all = storage.get('mono.sessions', {});
    all[sess.code] = { ...sess, savedAt: Date.now() };
    // Alte Einträge aufräumen
    for (const [k, v] of Object.entries(all)) if (Date.now() - v.savedAt > SESSION_MAX_AGE) delete all[k];
    storage.set('mono.sessions', all);
  }
}

export function tabSession() {
  return storage.get('mono.session', null, 'session');
}

export function storedSession(code) {
  const all = storage.get('mono.sessions', {});
  const s = code ? all[code.toUpperCase()] : Object.values(all).sort((a, b) => b.savedAt - a.savedAt)[0];
  return s && Date.now() - s.savedAt < SESSION_MAX_AGE ? s : null;
}

export function clearSession(code) {
  storage.remove('mono.session', 'session');
  if (code) {
    const all = storage.get('mono.sessions', {});
    delete all[code];
    storage.set('mono.sessions', all);
  }
}
