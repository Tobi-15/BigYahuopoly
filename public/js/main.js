/**
 * Einstiegspunkt des Clients: Bildschirme (Start, Lobby, Spiel), Verbindung,
 * automatisches Wiederverbinden, Theme und Ton.
 */
import { $, $$, toast, storage } from './util.js';
import { socket, on, send, saveSession, tabSession, storedSession, clearSession } from './net.js';
import { store, onStore } from './store.js';
import { initHome, initLobby, renderLobby, resetLobby, renderResume, enterRoom, peekIfCode } from './lobby.js';
import { initGame, onStateUpdate, resetGame, render as renderGame } from './game.js';
import { mountChats, renderChat, addChatMessage, showEmote } from './chat.js';
import { onStats } from './stats.js';
import { isMuted, setMuted } from './sound.js';

/* --- Theme und Ton --------------------------------------------------------- */
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  // Rohwert, weil das Inline-Skript in index.html ihn vor dem Rendern liest
  try { localStorage.setItem('mono.theme', next); } catch { /* ignorieren */ }
}
function renderThemeButtons() {
  for (const b of $$('[data-action="theme"]')) {
    const dark = currentTheme() === 'dark';
    b.textContent = b.classList.contains('icon-btn') ? (dark ? '☀️' : '🌙') : (dark ? '☀️ Hell' : '🌙 Dunkel');
    b.title = dark ? 'Helles Design' : 'Dunkles Design';
  }
}
function renderSoundButtons() {
  for (const b of $$('[data-action="sound"]')) {
    b.textContent = isMuted() ? '🔇' : '🔊';
    b.setAttribute('aria-pressed', String(!isMuted()));
  }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-action]');
  if (!a) return;
  if (a.dataset.action === 'theme') { toggleTheme(); renderThemeButtons(); }
  if (a.dataset.action === 'sound') { setMuted(!isMuted()); renderSoundButtons(); }
});

/* --- Bildschirme ------------------------------------------------------------ */
let screen = null;
function show(name) {
  if (screen === name) return;
  screen = name;
  for (const s of $$('.screen')) s.hidden = s.id !== `screen-${name}`;
  window.scrollTo(0, 0);
}

function route() {
  if (!store.code) {
    show('home');
    renderResume();
    return;
  }
  if (!store.room) return; // wartet auf room:update
  if (store.room.status === 'lobby') {
    show('lobby');
    renderLobby();
  } else {
    show('game');
    renderGame();
  }
  mountChats();
}

function goHome() {
  const code = store.code;
  Object.assign(store, { me: null, code: null, spectator: false, room: null, state: null, stats: null, chat: [] });
  if (code) clearSession(null);
  resetGame();
  resetLobby();
  history.replaceState(null, '', '/');
  route();
}

onStore('route', () => { flushPending(); route(); });
onStore('left', () => { clearSession(store.code); goHome(); });
// Verlassen eines laufenden Spiels: Sitzung für den Raum behalten, damit man über
// den Einladungslink (oder „Zurückkehren“) wieder einsteigen kann
document.addEventListener('mono:left', () => {
  if (store.room?.status === 'lobby') clearSession(store.code);
  goHome();
});
onStore('rejoin', (sess) => rejoin(sess));

/* --- Wiederverbinden --------------------------------------------------------- */
async function rejoin(sess) {
  if (sess.spectator) {
    const r = await send('room:join', { code: sess.code, name: sess.name || 'Zuschauer', spectator: true });
    if (r.ok) { enterRoom(sess); return true; }
    clearSession(sess.code);
    return false;
  }
  const r = await send('room:rejoin', { code: sess.code, playerId: sess.playerId, secret: sess.secret, force: sess.force !== false });
  if (r.ok) {
    enterRoom({ ...sess });
    if (sess.manual) toast('Willkommen zurück!');
    return true;
  }
  if (r.code === 'IN_USE') {
    toast('Dieser Spieler ist schon in einem anderen Fenster aktiv. Du kannst neu beitreten oder zuschauen.', 'warn', 6000);
  } else {
    clearSession(sess.code);
    if (sess.manual) toast(r.error, 'error');
  }
  return false;
}

let firstConnect = true;
socket.on('connect', async () => {
  $('#conn-banner').hidden = true;
  if (store.code) {
    // Verbindung kam zurück: gleiche Sitzung fortsetzen
    const sess = tabSession();
    if (sess && sess.code === store.code) {
      const ok = await rejoin({ ...sess, force: true });
      if (!ok) goHome();
    }
    return;
  }
  if (!firstConnect) return;
  firstConnect = false;
  // 1. Sitzung dieses Tabs (z. B. nach Neuladen)
  const tab = tabSession();
  if (tab && (await rejoin({ ...tab, force: true }))) return;
  // 2. Einladungslink /r/CODE mit gespeicherter Sitzung (Tab wurde geschlossen)
  const urlCode = location.pathname.match(/^\/r\/([A-Za-z0-9]{4})/)?.[1];
  if (urlCode) {
    const stored = storedSession(urlCode);
    if (stored && (await rejoin({ ...stored, force: false }))) return;
  }
  route();
  peekIfCode();
});
socket.on('disconnect', () => {
  if (store.code) $('#conn-banner').hidden = false;
});

/* --- Server-Nachrichten -------------------------------------------------------- */
// Beim Beitritt schickt der Server Raum und Zustand noch vor der Antwort (Ack).
// Solche Nachrichten werden zwischengespeichert, bis der Raumcode feststeht.
const pending = { room: null, state: null, chat: null, stats: null, msgs: [] };

function flushPending() {
  const p = { ...pending };
  Object.assign(pending, { room: null, state: null, chat: null, stats: null, msgs: [] });
  if (p.chat) { store.chat = p.chat; renderChat(); }
  for (const m of p.msgs) if (!store.chat.some((x) => x.id === m.id)) addChatMessage(m);
  if (p.room && p.room.code === store.code) applyRoom(p.room);
  if (p.state) applyState(p.state);
  if (p.stats) onStats(p.stats);
}

function applyRoom(room) {
  const prevStatus = store.room?.status;
  store.room = room;
  // Eigene Sitzung aktualisieren (Name für „Zurückkehren“)
  const meMember = room.members.find((m) => m.id === store.me);
  if (meMember) {
    const sess = tabSession();
    if (sess) saveSession({ ...sess, name: meMember.name });
  }
  if (prevStatus && prevStatus !== 'lobby' && room.status === 'lobby') {
    resetGame();
    resetLobby();
    store.state = null;
    store.stats = null;
  }
  if (prevStatus === 'lobby' && room.status === 'playing') {
    resetGame();
    store.stats = null;
  }
  route();
}

function applyState(msg) {
  store.offset = msg.serverNow - Date.now();
  if (!msg.state) return;
  // Neues Spiel (Revanche): alte Ansicht verwerfen
  if (store.state && msg.state.startedAt !== store.state.startedAt) {
    resetGame();
    store.stats = null;
    msg = { ...msg, full: true };
  }
  store.state = msg.state;
  onStateUpdate(msg);
}

on('room:update', (room) => {
  if (!store.code || room.code !== store.code) { pending.room = room; return; }
  applyRoom(room);
});
on('state:update', (msg) => {
  if (!store.code) { pending.state = msg; return; }
  applyState(msg);
});
on('stats:update', (stats) => {
  if (!store.code) { pending.stats = stats; return; }
  onStats(stats);
});
on('chat:history', (list) => {
  if (!store.code) { pending.chat = list; return; }
  store.chat = list;
  renderChat();
});
on('chat:message', (m) => {
  if (!store.code) { pending.msgs.push(m); return; }
  addChatMessage(m);
});
on('chat:emote', (e) => showEmote(e));
on('toast', (t) => toast(t.text, t.kind));
on('room:kicked', ({ reason }) => {
  if (reason !== 'takeover') toast('Du wurdest aus dem Raum entfernt.', 'warn');
  if (reason === 'takeover') {
    // Sitzung läuft jetzt in einem anderen Fenster weiter
    Object.assign(store, { code: null, room: null, state: null });
    storage.remove('mono.session', 'session');
    resetGame();
    history.replaceState(null, '', '/');
    route();
    return;
  }
  clearSession(store.code);
  goHome();
});

/* --- Start ----------------------------------------------------------------------- */
renderSoundButtons();
renderThemeButtons();
initHome();
initLobby();
initGame();
show('home');
