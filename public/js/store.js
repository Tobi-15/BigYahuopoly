/**
 * Client-Zustand (nur Anzeige – die Wahrheit liegt auf dem Server).
 */
export const store = {
  me: null, // eigene Spieler-ID (null bei Zuschauern)
  code: null, // Raumcode
  spectator: false,
  room: null, // letzte room:update-Nachricht
  state: null, // letzter Spielzustand vom Server
  stats: null, // letzte Statistik
  chat: [],
  offset: 0, // Serverzeit − lokale Zeit
};

export const serverNow = () => Date.now() + store.offset;
export const isHost = () => Boolean(store.me) && store.room?.hostId === store.me;
export const member = (id) => store.room?.members.find((m) => m.id === id);
export const gamePlayer = (id) => store.state?.players.find((p) => p.id === id);

/* Minimaler Event-Bus zwischen den Modulen */
const listeners = {};
export function onStore(evt, fn) {
  (listeners[evt] ||= []).push(fn);
}
export function emitStore(evt, data) {
  for (const fn of listeners[evt] || []) fn(data);
}
