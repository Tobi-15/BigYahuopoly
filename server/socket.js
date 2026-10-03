/**
 * Netzwerk-Schicht: Socket.IO-Protokoll.
 *
 * Jede Client-Nachricht wird hier auf Form und Typ geprüft, gegen ein
 * Rate-Limit gezählt und an Raum bzw. Spiel weitergereicht. Antworten laufen
 * über Socket.IO-Acks: { ok: true, ... } oder { ok: false, error }.
 * Das vollständige Protokoll ist in docs/PROTOCOL.md beschrieben.
 */
import { TokenBucket, KeyedLimiter } from './ratelimit.js';
import { TOKEN_IDS } from '../shared/tokens.js';

/** Socket-Event → Spielaktion (server/game/Game.js) */
export const GAME_EVENTS = {
  'game:roll': 'roll',
  'game:buy': 'buy',
  'game:decline': 'decline',
  'game:endTurn': 'endTurn',
  'game:jail:pay': 'payBail',
  'game:jail:card': 'useCard',
  'game:build': 'build',
  'game:sell': 'sell',
  'game:mortgage': 'mortgage',
  'game:unmortgage': 'unmortgage',
  'game:auction:bid': 'bid',
  'game:auction:pass': 'pass',
  'game:debt:pay': 'payDebt',
  'game:bankrupt': 'bankrupt',
  'trade:offer': 'tradeOffer',
  'trade:accept': 'tradeAccept',
  'trade:reject': 'tradeReject',
  'trade:cancel': 'tradeCancel',
  'trade:counter': 'tradeCounter',
};

export const EMOTES = ['👏', '😂', '😡', '😱', '🎉', '👍', '😭', '🤑', '🔥', '🙈'];

/** Anzeigenamen bereinigen (keine Steuerzeichen, kein HTML) */
export function cleanText(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

const isCode = (v) => typeof v === 'string' && /^[A-Za-z0-9]{4}$/.test(v);
const isId = (v) => typeof v === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(v);

/** Fehler, die für Nutzer bestimmt sind, von Programmfehlern unterscheiden */
const isInternal = (err) => err instanceof TypeError || err instanceof ReferenceError || err instanceof RangeError;

/**
 * Socket.IO-Handler registrieren.
 * @param {import('socket.io').Server} io
 * @param {import('./rooms.js').RoomManager} rooms
 */
export function setupSockets(io, rooms, opts = {}) {
  const createLimiter = new KeyedLimiter(opts.roomCreatesPerMinute ?? 6, (opts.roomCreatesPerMinute ?? 6) / 60);
  const connLimiter = new KeyedLimiter(opts.connectionsPerMinute ?? 40, (opts.connectionsPerMinute ?? 40) / 60);

  io.on('connection', (socket) => {
    const ip = socket.handshake.headers['x-forwarded-for']?.split(',')[0].trim() || socket.handshake.address;
    if (!connLimiter.take(ip)) {
      socket.emit('toast', { kind: 'error', text: 'Zu viele Verbindungen. Bitte später erneut versuchen.' });
      socket.disconnect(true);
      return;
    }
    const buckets = {
      action: new TokenBucket(opts.actionBurst ?? 25, opts.actionRate ?? 12),
      chat: new TokenBucket(5, 0.5),
    };
    socket.data = { code: null, pid: null, spectator: false };

    const room = () => rooms.get(socket.data.code);
    const requireRoom = () => {
      const r = room();
      if (!r) throw new Error('Du bist in keinem Raum.');
      return r;
    };
    const requireMember = () => {
      const r = requireRoom();
      if (!socket.data.pid || !r.members.has(socket.data.pid)) throw new Error('Nur Mitspieler können das.');
      return r;
    };

    /** Handler mit Rate-Limit, Fehlerbehandlung und Ack */
    const on = (event, fn, limit = 'action') => {
      socket.on(event, (payload, ack) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!buckets[limit].take()) return reply({ ok: false, error: 'Zu viele Anfragen. Bitte kurz warten.' });
        try {
          const res = fn(payload && typeof payload === 'object' ? payload : {});
          reply({ ok: true, ...(res || {}) });
        } catch (err) {
          if (isInternal(err)) console.error(`[${event}]`, err);
          reply({ ok: false, error: isInternal(err) ? 'Interner Fehler.' : err.message, code: err.code });
        }
      });
    };

    /** Socket aus dem bisherigen Raum lösen */
    const leaveCurrent = () => {
      const r = room();
      if (r) {
        socket.leave(r.channel);
        if (socket.data.spectator) {
          r.spectators.delete(socket.id);
        } else if (socket.data.pid) {
          r.detach(socket.id, socket.data.pid);
        }
        r.broadcastRoom();
      }
      socket.data = { code: null, pid: null, spectator: false };
    };

    const enter = (r, pid, spectator = false, name = '') => {
      socket.join(r.channel);
      socket.data = { code: r.code, pid: spectator ? null : pid, spectator };
      if (spectator) {
        r.spectators.set(socket.id, { name });
        r.resume();
      } else r.attach(socket, pid);
      r.snapshotFor(socket);
      r.broadcastRoom();
    };

    const readProfile = (p) => {
      const name = cleanText(p.name, 20);
      if (name.length < 1) throw new Error('Bitte gib einen Namen ein.');
      if (!TOKEN_IDS.includes(p.token)) throw new Error('Bitte wähle eine Figur.');
      return { name, token: p.token };
    };

    /* --- Räume ------------------------------------------------------ */

    /** Raum vorab ansehen (vergebene Figuren, Status) – für das Beitrittsformular */
    on('room:peek', (p) => {
      if (!isCode(p.code)) throw new Error('Ungültiger Raumcode.');
      const r = rooms.get(p.code);
      if (!r) return { exists: false };
      return {
        exists: true,
        status: r.status,
        taken: [...r.members.values()].map((m) => m.token),
        players: r.members.size,
        maxPlayers: r.settings.maxPlayers,
      };
    });

    on('room:create', (p) => {
      const profile = readProfile(p);
      if (!createLimiter.take(ip)) throw new Error('Zu viele neue Räume. Bitte kurz warten.');
      leaveCurrent();
      const r = rooms.create();
      const m = r.addMember(profile);
      enter(r, m.id);
      r.systemChat(`${m.name} hat den Raum erstellt.`);
      return { code: r.code, playerId: m.id, secret: m.secret };
    });

    on('room:join', (p) => {
      if (!isCode(p.code)) throw new Error('Ungültiger Raumcode.');
      const r = rooms.get(p.code);
      if (!r) throw new Error('Diesen Raum gibt es nicht (mehr).');
      if (p.spectator) {
        const name = cleanText(p.name, 20) || 'Zuschauer';
        leaveCurrent();
        enter(r, null, true, name);
        return { code: r.code, spectator: true };
      }
      const profile = readProfile(p);
      if (r.status !== 'lobby') {
        const err = new Error('Das Spiel läuft bereits. Du kannst zuschauen.');
        err.code = 'GAME_RUNNING';
        throw err;
      }
      leaveCurrent();
      const m = r.addMember(profile);
      enter(r, m.id);
      r.systemChat(`${m.name} ist beigetreten.`);
      return { code: r.code, playerId: m.id, secret: m.secret };
    });

    /** Wiederverbinden mit gespeicherter Spieler-ID und Geheimnis */
    on('room:rejoin', (p) => {
      if (!isCode(p.code) || !isId(p.playerId) || typeof p.secret !== 'string') throw new Error('Ungültige Sitzung.');
      const r = rooms.get(p.code);
      if (!r) throw new Error('Diesen Raum gibt es nicht mehr.');
      const m = r.members.get(p.playerId);
      if (!m || m.secret !== p.secret) throw new Error('Sitzung ungültig.');
      // Läuft die Sitzung schon in einem anderen Tab, nur mit force übernehmen
      if (m.sockets.size > 0 && !p.force) {
        const err = new Error('Dieser Spieler ist bereits in einem anderen Fenster verbunden.');
        err.code = 'IN_USE';
        throw err;
      }
      if (p.force) {
        for (const sid of m.sockets) {
          const other = io.sockets.sockets.get(sid);
          if (other && other.id !== socket.id) {
            other.emit('toast', { kind: 'info', text: 'Die Sitzung wurde in einem anderen Fenster geöffnet.' });
            other.emit('room:kicked', { reason: 'takeover' });
            other.leave(r.channel);
            other.data = { code: null, pid: null, spectator: false };
          }
        }
        m.sockets.clear();
      }
      leaveCurrent();
      enter(r, m.id);
      return { code: r.code, playerId: m.id, secret: m.secret, status: r.status };
    });

    on('room:leave', () => {
      const r = room();
      const pid = socket.data.pid;
      if (r && pid && r.status === 'lobby') {
        const m = r.members.get(pid);
        socket.leave(r.channel);
        r.removeMember(pid);
        socket.data = { code: null, pid: null, spectator: false };
        if (r.humans().length === 0) rooms.delete(r.code);
        else {
          r.systemChat(`${m.name} hat den Raum verlassen.`);
          r.broadcastRoom();
        }
        return {};
      }
      leaveCurrent();
      return {};
    });

    on('room:rules:update', (p) => {
      const r = requireMember();
      r.updateRules(socket.data.pid, p.rules);
      r.broadcastRoom();
    });

    on('room:settings:update', (p) => {
      const r = requireMember();
      r.updateSettings(socket.data.pid, { maxPlayers: p.maxPlayers });
      r.broadcastRoom();
    });

    on('room:ready', (p) => {
      const r = requireMember();
      r.setReady(socket.data.pid, p.ready);
      r.broadcastRoom();
    });

    on('room:token', (p) => {
      const r = requireMember();
      r.setToken(socket.data.pid, p.token);
      r.broadcastRoom();
    });

    on('room:kick', (p) => {
      const r = requireMember();
      if (!isId(p.playerId)) throw new Error('Unbekannter Spieler.');
      const m = r.kick(socket.data.pid, p.playerId);
      if (r.status === 'lobby') {
        for (const sid of m.sockets) {
          const s = io.sockets.sockets.get(sid);
          if (s) {
            s.emit('room:kicked', { reason: 'kick' });
            s.leave(r.channel);
            s.data = { code: null, pid: null, spectator: false };
          }
        }
        if (!m.isBot) r.systemChat(`${m.name} wurde vom Host entfernt.`);
      } else {
        r.systemChat(`${m.name} wurde vom Host aus dem Spiel entfernt.`);
      }
      r.broadcastRoom();
    });

    on('room:bot:add', (p) => {
      const r = requireMember();
      r.addBot(socket.data.pid, p.level || 'medium');
      r.broadcastRoom();
    });

    on('room:bot:fill', (p) => {
      const r = requireMember();
      const n = r.fillBots(socket.data.pid, p.level || 'medium');
      r.broadcastRoom();
      return { added: n };
    });

    on('room:bot:level', (p) => {
      const r = requireMember();
      r.setBotLevel(socket.data.pid, p.playerId, p.level);
      r.broadcastRoom();
    });

    on('room:start', () => {
      const r = requireMember();
      r.startGame(socket.data.pid);
    });

    on('room:rematch', () => {
      const r = requireMember();
      r.rematch(socket.data.pid);
    });

    on('room:lobby', () => {
      const r = requireMember();
      r.backToLobby(socket.data.pid);
    });

    /* --- Spiel ------------------------------------------------------ */

    for (const [event, type] of Object.entries(GAME_EVENTS)) {
      on(event, (p) => {
        const r = requireMember();
        const res = r.handleAction(socket.data.pid, type, p);
        if (!res.ok) throw new Error(res.error);
      });
    }

    on('game:resign', () => {
      const r = requireMember();
      if (r.status !== 'playing') throw new Error('Es läuft kein Spiel.');
      const gp = r.game.player(socket.data.pid);
      if (!gp || gp.bankrupt) throw new Error('Du bist nicht mehr im Spiel.');
      r.removeFromGame(socket.data.pid);
      r.broadcastRoom();
    });

    on('stats:request', () => {
      const r = requireRoom();
      return { stats: r.stats() };
    });

    on('replay:request', () => {
      const r = requireRoom();
      return { log: r.replay() };
    });

    /* --- Chat ------------------------------------------------------- */

    const chatSender = () => {
      const r = requireRoom();
      if (socket.data.spectator) return { r, name: r.spectators.get(socket.id)?.name || 'Zuschauer', from: null, spectator: true };
      const m = r.members.get(socket.data.pid);
      if (!m) throw new Error('Du bist in keinem Raum.');
      return { r, name: m.name, from: m.id, spectator: false };
    };

    on('chat:message', (p) => {
      const text = cleanText(p.text, 300);
      if (!text) throw new Error('Leere Nachricht.');
      const { r, name, from, spectator } = chatSender();
      r.addChat({ from, name, text, spectator });
    }, 'chat');

    on('chat:emote', (p) => {
      if (!EMOTES.includes(p.emote)) throw new Error('Unbekanntes Emote.');
      const { r, name, from } = chatSender();
      r.emit('chat:emote', { from, name, emote: p.emote, ts: Date.now() });
    }, 'chat');

    socket.on('disconnect', () => {
      leaveCurrent();
    });
  });
}
