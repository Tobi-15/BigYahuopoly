/**
 * Räume: Lobby, Mitglieder, Zuschauer, Spielstart, Bots, Timer, Anwesenheit.
 *
 * Ein Raum kennt seine Mitglieder (Menschen und Bots) und – sobald das Spiel
 * läuft – eine Game-Instanz. Alle Spielaktionen laufen über handleAction(),
 * danach verteilt afterChange() den neuen Zustand an alle Clients und plant
 * Bots, Versteigerungs-Ende und Zug-Timer neu.
 */
import crypto from 'node:crypto';
import { Game } from './game/Game.js';
import { computeSummary, replayLog } from './game/stats.js';
import { decide, tradeResponse, botName, BOT_LEVELS } from './game/bot.js';
import { DEFAULT_RULES, FIXED, validateRules } from '../shared/rules.js';
import { TOKEN_IDS, getToken } from '../shared/tokens.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CHAT_HISTORY = 60;

export const newId = () => crypto.randomBytes(6).toString('base64url');
export const newSecret = () => crypto.randomBytes(18).toString('base64url');

export class Room {
  /**
   * @param {string} code
   * @param {object} env  { io, botDelayMs, absenceMs, onChange }
   */
  constructor(code, env) {
    this.code = code;
    this.env = env;
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
    this.hostId = null;
    /** @type {Map<string, object>} */
    this.members = new Map();
    /** socketId → { name } */
    this.spectators = new Map();
    this.settings = { maxPlayers: FIXED.maxPlayers };
    this.rules = { ...DEFAULT_RULES, playerBonus: {} };
    this.status = 'lobby'; // lobby | playing | over
    this.game = null;
    this.chat = [];
    this.chatSeq = 0;
    this.timers = { bot: null, auction: null, deadline: null };
    this.absenceTimers = new Map();
    this.botMemory = {};
    this.lastSummary = null;
    this.destroyed = false;
  }

  get channel() {
    return `room:${this.code}`;
  }

  emit(event, data) {
    this.env.io?.to(this.channel).emit(event, data);
  }

  touch() {
    this.lastActivity = Date.now();
    this.env.onChange?.();
  }

  /* ------------------------------------------------------------------ */
  /* Mitglieder                                                          */
  /* ------------------------------------------------------------------ */

  humans() {
    return [...this.members.values()].filter((m) => !m.isBot);
  }

  onlineHumans() {
    return this.humans().filter((m) => m.sockets.size > 0);
  }

  takenTokens(exceptId) {
    return [...this.members.values()].filter((m) => m.id !== exceptId).map((m) => m.token);
  }

  freeToken() {
    const taken = this.takenTokens();
    return TOKEN_IDS.find((t) => !taken.includes(t));
  }

  addMember({ name, token, isBot = false, botLevel = null }) {
    if (this.members.size >= this.settings.maxPlayers) throw new Error('Der Raum ist voll.');
    if (this.takenTokens().includes(token)) throw new Error(`Die Figur ${getToken(token)?.name ?? token} ist schon vergeben.`);
    const m = {
      id: newId(),
      secret: newSecret(),
      name,
      token,
      isBot,
      botLevel: isBot ? botLevel : null,
      ready: isBot,
      sockets: new Set(),
      away: false,
      removed: false,
      joinedAt: Date.now(),
    };
    this.members.set(m.id, m);
    if (!this.hostId && !isBot) this.hostId = m.id;
    this.touch();
    return m;
  }

  removeMember(pid) {
    const m = this.members.get(pid);
    if (!m) return;
    this.members.delete(pid);
    delete this.rules.playerBonus[pid];
    clearTimeout(this.absenceTimers.get(pid));
    this.absenceTimers.delete(pid);
    if (this.hostId === pid) this.passHost();
    this.touch();
  }

  /** Host-Rolle an einen anderen (möglichst verbundenen) Menschen übergeben */
  passHost() {
    const candidates = this.humans().filter((m) => m.id !== this.hostId && !m.removed);
    const next = candidates.find((m) => m.sockets.size > 0) || candidates[0];
    this.hostId = next ? next.id : null;
    if (next) this.systemChat(`${next.name} ist jetzt Host.`);
  }

  /** Öffentliche Raum-Infos (ohne Geheimnisse) */
  publicInfo() {
    return {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      settings: this.settings,
      rules: this.rules,
      members: [...this.members.values()].map((m) => ({
        id: m.id,
        name: m.name,
        token: m.token,
        isBot: m.isBot,
        botLevel: m.botLevel,
        ready: m.ready,
        online: m.isBot || m.sockets.size > 0,
        away: m.away,
        removed: m.removed,
      })),
      spectators: this.spectators.size,
    };
  }

  broadcastRoom() {
    this.emit('room:update', this.publicInfo());
  }

  /* ------------------------------------------------------------------ */
  /* Anwesenheit                                                         */
  /* ------------------------------------------------------------------ */

  attach(socket, pid) {
    const m = this.members.get(pid);
    m.sockets.add(socket.id);
    clearTimeout(this.absenceTimers.get(pid));
    this.absenceTimers.delete(pid);
    const wasAway = m.away;
    m.away = false;
    if (this.game) this.game.setPresence(pid, { online: true, away: false });
    if (wasAway) this.systemChat(`${m.name} ist zurück und übernimmt wieder selbst.`);
    if (!this.hostId) this.hostId = pid;
    this.touch();
    if (this.game) this.broadcastState([]);
    this.resume();
  }

  /** Pausiertes Spiel fortsetzen (Bots und Zug-Timer), sobald wieder jemand da ist */
  resume() {
    if (this.game && this.status === 'playing') {
      this.armTimers();
      this.scheduleBots();
    }
  }

  /** Ist niemand mehr da, der zuschaut oder mitspielt? */
  deserted() {
    return this.onlineHumans().length === 0 && this.spectators.size === 0;
  }

  /** Socket getrennt: nach der Abwesenheitsfrist übernimmt die KI */
  detach(socketId, pid) {
    const m = this.members.get(pid);
    if (!m) return;
    m.sockets.delete(socketId);
    if (m.sockets.size > 0) return;
    if (this.game) {
      this.game.setPresence(pid, { online: false });
      this.broadcastState([]);
    }
    clearTimeout(this.absenceTimers.get(pid));
    if (this.destroyed) return;
    this.absenceTimers.set(pid, setTimeout(() => this.onAbsent(pid), this.env.absenceMs ?? FIXED.absenceTakeoverMs));
    this.touch();
  }

  onAbsent(pid) {
    this.absenceTimers.delete(pid);
    const m = this.members.get(pid);
    if (!m || m.sockets.size > 0) return;
    if (this.status === 'lobby') {
      // In der Lobby wird ein abwesender Spieler entfernt
      this.removeMember(pid);
      this.systemChat(`${m.name} hat den Raum verlassen.`);
    } else {
      m.away = true;
      if (this.game) this.game.setPresence(pid, { away: true });
      if (this.hostId === pid) this.passHost();
      const gp = this.game?.player(pid);
      if (gp && !gp.bankrupt && this.status === 'playing') {
        this.systemChat(`${m.name} ist seit über 2 Minuten weg. Die KI spielt weiter, bis ${m.name} zurückkommt. Der Host kann ${m.name} auch entfernen.`);
        this.scheduleBots();
      }
    }
    this.broadcastRoom();
    if (this.game) this.broadcastState([]);
  }

  /** Wird der Spieler gerade von der KI gesteuert? */
  isBotControlled(pid) {
    const m = this.members.get(pid);
    return Boolean(m && (m.isBot || m.away));
  }

  botLevelOf(pid) {
    const m = this.members.get(pid);
    return m?.isBot ? m.botLevel : 'medium';
  }

  /* ------------------------------------------------------------------ */
  /* Lobby-Aktionen                                                      */
  /* ------------------------------------------------------------------ */

  requireHost(pid) {
    if (pid !== this.hostId) throw new Error('Nur der Host darf das.');
  }

  requireLobby() {
    if (this.status !== 'lobby') throw new Error('Das geht nur in der Lobby.');
  }

  updateRules(pid, rules) {
    this.requireHost(pid);
    this.requireLobby();
    const res = validateRules(rules, { playerIds: [...this.members.keys()] });
    if (!res.ok) throw new Error(`Ungültige Regeln: ${res.errors.join(', ')}`);
    this.rules = res.rules;
    for (const m of this.members.values()) if (!m.isBot && m.id !== this.hostId) m.ready = false;
    this.touch();
  }

  updateSettings(pid, { maxPlayers }) {
    this.requireHost(pid);
    this.requireLobby();
    if (!Number.isInteger(maxPlayers) || maxPlayers < FIXED.minPlayers || maxPlayers > FIXED.maxPlayers) {
      throw new Error(`Spielerzahl ${FIXED.minPlayers}–${FIXED.maxPlayers}.`);
    }
    if (maxPlayers < this.members.size) throw new Error('Es sind bereits mehr Spieler im Raum.');
    this.settings.maxPlayers = maxPlayers;
    this.touch();
  }

  setReady(pid, ready) {
    this.requireLobby();
    const m = this.members.get(pid);
    m.ready = Boolean(ready);
    this.touch();
  }

  setToken(pid, token) {
    this.requireLobby();
    if (!TOKEN_IDS.includes(token)) throw new Error('Unbekannte Figur.');
    if (this.takenTokens(pid).includes(token)) throw new Error('Diese Figur ist schon vergeben.');
    this.members.get(pid).token = token;
    this.touch();
  }

  addBot(pid, level) {
    this.requireHost(pid);
    this.requireLobby();
    if (!BOT_LEVELS.includes(level)) throw new Error('Unbekannte KI-Stufe.');
    const token = this.freeToken();
    if (!token) throw new Error('Keine Figur mehr frei.');
    const name = botName([...this.members.values()].map((m) => m.name));
    return this.addMember({ name, token, isBot: true, botLevel: level });
  }

  fillBots(pid, level) {
    this.requireHost(pid);
    this.requireLobby();
    let n = 0;
    while (this.members.size < this.settings.maxPlayers) {
      this.addBot(pid, level);
      n++;
    }
    return n;
  }

  setBotLevel(pid, botId, level) {
    this.requireHost(pid);
    this.requireLobby();
    const m = this.members.get(botId);
    if (!m?.isBot) throw new Error('Kein Bot.');
    if (!BOT_LEVELS.includes(level)) throw new Error('Unbekannte KI-Stufe.');
    m.botLevel = level;
    this.touch();
  }

  /**
   * Host entfernt ein Mitglied. In der Lobby jederzeit, im Spiel nur
   * abwesende Spieler (Host-Entscheidung nach 2 Minuten Abwesenheit).
   * @returns {object} entferntes Mitglied
   */
  kick(pid, targetId) {
    this.requireHost(pid);
    const m = this.members.get(targetId);
    if (!m) throw new Error('Unbekannter Spieler.');
    if (targetId === pid) throw new Error('Du kannst dich nicht selbst entfernen.');
    if (this.status === 'lobby') {
      this.removeMember(targetId);
      return m;
    }
    if (this.status === 'playing') {
      if (!m.isBot && !m.away && m.sockets.size > 0) throw new Error('Im Spiel kann der Host nur abwesende Spieler entfernen.');
      this.removeFromGame(targetId);
      return m;
    }
    throw new Error('Das geht gerade nicht.');
  }

  /** Spieler scheidet aus dem laufenden Spiel aus (Aufgeben oder Entfernen) */
  removeFromGame(pid) {
    const m = this.members.get(pid);
    if (!this.game || !m) return;
    m.removed = true;
    this.game.removePlayer(pid);
    this.afterChange();
  }

  /* ------------------------------------------------------------------ */
  /* Spiel                                                               */
  /* ------------------------------------------------------------------ */

  startGame(pid) {
    this.requireHost(pid);
    this.requireLobby();
    const players = [...this.members.values()];
    if (players.length < FIXED.minPlayers) throw new Error(`Mindestens ${FIXED.minPlayers} Spieler nötig (Bots zählen mit).`);
    const notReady = players.filter((m) => !m.isBot && m.id !== this.hostId && !m.ready);
    if (notReady.length) throw new Error(`Noch nicht bereit: ${notReady.map((m) => m.name).join(', ')}`);
    // Regeln beim Start erneut prüfen (serverseitig verbindlich)
    const res = validateRules(this.rules, { playerIds: players.map((m) => m.id) });
    if (!res.ok) throw new Error(`Ungültige Regeln: ${res.errors.join(', ')}`);
    this.rules = res.rules;
    this.launch(players);
  }

  launch(players) {
    this.clearTimers();
    for (const m of players) { m.removed = false; m.away = false; }
    this.game = Game.create({
      players: players.map((m) => ({ id: m.id, name: m.name, token: m.token, isBot: m.isBot, botLevel: m.botLevel })),
      rules: this.rules,
    });
    for (const m of players) this.game.setPresence(m.id, { online: m.isBot || m.sockets.size > 0 });
    this.status = 'playing';
    this.botMemory = {};
    this.lastSummary = null;
    this.systemChat('Das Spiel beginnt. Viel Glück!');
    this.broadcastRoom();
    this.afterChange();
  }

  /** Revanche: gleiche Mitspieler (verbundene Menschen + Bots), gleiche Regeln */
  rematch(pid) {
    this.requireHost(pid);
    if (this.status !== 'over') throw new Error('Das Spiel läuft noch.');
    const players = [...this.members.values()].filter((m) => m.isBot || m.sockets.size > 0);
    if (players.length < FIXED.minPlayers) throw new Error('Zu wenige Spieler für eine Revanche.');
    const res = validateRules(this.rules, { playerIds: players.map((m) => m.id) });
    this.rules = res.rules;
    this.launch(players);
  }

  backToLobby(pid) {
    this.requireHost(pid);
    if (this.status !== 'over') throw new Error('Das Spiel läuft noch.');
    this.clearTimers();
    this.status = 'lobby';
    this.game = null;
    // Mitglieder ohne Verbindung verlassen den Raum
    for (const m of [...this.members.values()]) {
      m.removed = false;
      m.away = false;
      if (!m.isBot) m.ready = false;
      if (!m.isBot && m.sockets.size === 0) this.removeMember(m.id);
    }
    this.touch();
    this.broadcastRoom();
    this.emit('state:update', { state: null, events: [], serverNow: Date.now() });
  }

  /**
   * Spielaktion eines Spielers (Mensch oder Bot).
   * @returns {{ok: boolean, error?: string}}
   */
  handleAction(pid, type, payload) {
    if (!this.game || this.status !== 'playing') return { ok: false, error: 'Es läuft kein Spiel.' };
    const res = this.game.act(pid, type, payload);
    if (res.ok) this.afterChange();
    return res;
  }

  /** Nach jeder Zustandsänderung: verteilen, Timer und Bots neu planen */
  afterChange() {
    const game = this.game;
    if (!game) return;
    const events = game.flushEvents();
    this.touch();
    if (game.s.phase === 'over' && this.status === 'playing') {
      this.status = 'over';
      this.clearTimers();
      this.broadcastState(events);
      this.broadcastRoom();
      this.lastSummary = computeSummary(game.s);
      this.emit('stats:update', this.lastSummary);
      return;
    }
    this.broadcastState(events);
    this.armTimers();
    this.scheduleBots();
  }

  broadcastState(events) {
    if (!this.game) return;
    this.emit('state:update', { state: this.game.publicState(), events, serverNow: Date.now() });
  }

  /** Vollständiger Zustand für einen einzelnen Socket (Join/Reconnect) */
  snapshotFor(socket) {
    socket.emit('room:update', this.publicInfo());
    socket.emit('chat:history', this.chat);
    if (this.game) {
      socket.emit('state:update', { state: this.game.publicState(), events: [], serverNow: Date.now(), full: true });
      if (this.status === 'over') socket.emit('stats:update', this.lastSummary || computeSummary(this.game.s));
    }
  }

  stats() {
    if (!this.game) return null;
    return this.status === 'over' && this.lastSummary ? this.lastSummary : computeSummary(this.game.s);
  }

  replay() {
    return this.game ? replayLog(this.game.s) : [];
  }

  /* ------------------------------------------------------------------ */
  /* Timer: Versteigerungsende und Zug-Timer                             */
  /* ------------------------------------------------------------------ */

  clearTimers() {
    for (const k of Object.keys(this.timers)) {
      clearTimeout(this.timers[k]);
      this.timers[k] = null;
    }
  }

  armTimers() {
    const game = this.game;
    if (this.destroyed) return;
    clearTimeout(this.timers.auction);
    clearTimeout(this.timers.deadline);
    this.timers.auction = null;
    this.timers.deadline = null;
    if (!game || this.status !== 'playing') return;
    const wake = game.nextWakeup();
    if (wake) {
      this.timers.auction = setTimeout(() => {
        if (this.game === game && game.tick()) this.afterChange();
        else this.armTimers();
      }, Math.max(0, wake - Date.now()) + 20);
    }
    if (game.s.deadline && !this.deserted()) {
      this.timers.deadline = setTimeout(() => this.onDeadline(game), Math.max(0, game.s.deadline - Date.now()) + 20);
    }
  }

  /**
   * Zug-Timer abgelaufen: ein sinnvoller Minimal-Zug für den Spieler.
   * Würfeln, Kaufen/Ablehnen (Einschätzung der KI, ohne Hypotheken),
   * Zug beenden, Schulden begleichen. Kein Bauen und kein Handel im Namen
   * des Spielers – das macht die KI nur bei längerer Abwesenheit.
   */
  onDeadline(game) {
    if (this.game !== game || this.status !== 'playing') return;
    if (!game.s.deadline || Date.now() < game.s.deadline) return this.armTimers();
    const pid = game.responsiblePid();
    if (!pid) return;
    const name = game.player(pid).name;
    const seq = game.s.phaseSeq;
    for (let i = 0; i < 40 && game.s.phaseSeq === seq && game.responsiblePid() === pid; i++) {
      const a = autoMove(game, pid, this.memoryFor(pid));
      if (!a || !game.act(pid, a.type, a.payload).ok) break;
    }
    if (game.s.phaseSeq === seq) {
      // Notfall: Phase hat sich nicht geändert → sicherer Standardzug
      const fallback = { roll: 'roll', jail: 'roll', buy: 'decline', end: 'endTurn', debt: 'bankrupt' }[game.s.phase];
      if (fallback) game.act(pid, fallback, {});
    }
    game.log(`Zeit abgelaufen: Für ${name} wurde automatisch gezogen.`, 'info', pid);
    this.afterChange();
  }

  /* ------------------------------------------------------------------ */
  /* Bots                                                                */
  /* ------------------------------------------------------------------ */

  memoryFor(pid) {
    this.botMemory[pid] ||= { tried: {} };
    return this.botMemory[pid];
  }

  botDelay(base = 1) {
    const d = this.env.botDelayMs ?? 900;
    return Math.round(d * base * (0.8 + Math.random() * 0.6));
  }

  /** Plant den nächsten Bot-Schritt (falls ein Bot oder abwesender Spieler handeln muss) */
  scheduleBots(delayFactor = 1) {
    clearTimeout(this.timers.bot);
    this.timers.bot = null;
    const game = this.game;
    if (!game || this.status !== 'playing' || this.destroyed) return;
    // Sind alle Menschen weg, pausiert das Spiel (Bots spielen nicht alleine weiter)
    if (this.deserted()) return;
    if (!this.findBotAction(true)) return;
    // Nach Würfelwürfen länger warten, damit die Animation bei allen ablaufen kann
    const animating = game.s.phase === 'auction' ? 0.9 : delayFactor;
    this.timers.bot = setTimeout(() => this.botStep(), this.botDelay(animating));
  }

  /**
   * Sucht die nächste Bot-Aktion. dryRun: nur prüfen, ob es eine gibt.
   * @returns {{pid, type, payload} | null}
   */
  findBotAction(dryRun = false) {
    const game = this.game;
    const s = game.s;
    // 1. Handelsangebote an Bots beantworten
    if (s.phase !== 'auction') {
      const t = s.trades.find((x) => this.isBotControlled(x.to));
      if (t) {
        if (dryRun) return { pid: t.to };
        return { pid: t.to, type: tradeResponse(game, t.to, t, this.botLevelOf(t.to)), payload: { id: t.id } };
      }
    }
    // 2. Versteigerung: Bots in zufälliger Reihenfolge
    if (s.phase === 'auction') {
      const bots = game.alivePlayers().filter((p) => this.isBotControlled(p.id));
      bots.sort(() => Math.random() - 0.5);
      for (const p of bots) {
        const a = decide(game, p.id, this.botLevelOf(p.id), this.memoryFor(p.id));
        if (a) return { pid: p.id, ...a };
      }
      return null;
    }
    // 3. Verantwortlicher Spieler
    const pid = game.responsiblePid();
    if (!pid || !this.isBotControlled(pid)) return null;
    if (dryRun) return { pid };
    const a = decide(game, pid, this.botLevelOf(pid), this.memoryFor(pid));
    return a ? { pid, ...a } : null;
  }

  botStep() {
    this.timers.bot = null;
    const game = this.game;
    if (!game || this.status !== 'playing') return;
    const a = this.findBotAction(false);
    if (!a) return;
    const res = game.act(a.pid, a.type, a.payload);
    if (!res.ok) {
      // Ungültiges Handelsangebot o. ä.: verwerfen, damit kein Bot hängen bleibt
      if (a.type?.startsWith('trade') && a.payload?.id) game.s.trades = game.s.trades.filter((t) => t.id !== a.payload.id);
      else if (game.s.phase === 'auction') game.act(a.pid, 'pass', {});
      else if (a.type !== 'endTurn' && game.responsiblePid() === a.pid) {
        const fallback = { roll: 'roll', jail: 'roll', buy: 'decline', end: 'endTurn', debt: 'bankrupt' }[game.s.phase];
        if (fallback) game.act(a.pid, fallback, {});
      }
    }
    const events = game.events;
    const rolled = events.some((e) => e.t === 'move' && Math.abs(e.steps) > 0) || events.some((e) => e.t === 'card');
    const managing = ['build', 'sell', 'mortgage', 'unmortgage'].includes(a.type);
    this.afterChange();
    // Nach Bewegungen mehr Zeit für Animationen, Verwaltung geht schneller
    if (this.timers.bot) this.scheduleBots(rolled ? 2.4 : managing ? 0.5 : 1);
  }

  /* ------------------------------------------------------------------ */
  /* Chat                                                                */
  /* ------------------------------------------------------------------ */

  addChat(entry) {
    const msg = { id: ++this.chatSeq, ts: Date.now(), ...entry };
    this.chat.push(msg);
    if (this.chat.length > CHAT_HISTORY) this.chat.shift();
    this.emit('chat:message', msg);
    return msg;
  }

  systemChat(text) {
    return this.addChat({ system: true, text });
  }

  /* ------------------------------------------------------------------ */
  /* Snapshots                                                           */
  /* ------------------------------------------------------------------ */

  toJSON() {
    return {
      code: this.code,
      createdAt: this.createdAt,
      lastActivity: this.lastActivity,
      hostId: this.hostId,
      members: [...this.members.values()].map(({ sockets, ...m }) => m),
      settings: this.settings,
      rules: this.rules,
      status: this.status,
      game: this.game ? this.game.toJSON() : null,
      chat: this.chat,
      chatSeq: this.chatSeq,
    };
  }

  static fromJSON(data, env) {
    const r = new Room(data.code, env);
    Object.assign(r, {
      createdAt: data.createdAt,
      lastActivity: data.lastActivity,
      hostId: data.hostId,
      settings: data.settings,
      rules: data.rules,
      status: data.status,
      chat: data.chat || [],
      chatSeq: data.chatSeq || 0,
    });
    for (const m of data.members) r.members.set(m.id, { ...m, sockets: new Set() });
    if (data.game) {
      r.game = Game.fromJSON(data.game);
      for (const m of r.members.values()) {
        r.game.setPresence(m.id, { online: m.isBot });
        // Nach einem Neustart: abwesende Menschen bekommen erneut die volle Frist
        if (!m.isBot && r.status === 'playing') r.detach('restore', m.id);
      }
      if (r.status === 'over') r.lastSummary = computeSummary(r.game.s);
    }
    return r;
  }

  destroy() {
    this.destroyed = true;
    this.clearTimers();
    for (const t of this.absenceTimers.values()) clearTimeout(t);
    this.absenceTimers.clear();
  }
}

/** Verwaltung aller Räume inkl. automatischem Aufräumen */
export class RoomManager {
  constructor(env = {}) {
    this.env = env;
    /** @type {Map<string, Room>} */
    this.rooms = new Map();
    this.idleMs = env.idleMs ?? 3 * 60 * 60 * 1000; // 3 h ohne Aktivität
    this.emptyMs = env.emptyMs ?? 15 * 60 * 1000; // 15 min ohne verbundene Menschen
    this.cleanupTimer = setInterval(() => this.cleanup(), env.cleanupIntervalMs ?? 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  generateCode() {
    for (let tries = 0; tries < 1000; tries++) {
      let code = '';
      for (let i = 0; i < 4; i++) code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Kein freier Raumcode.');
  }

  create() {
    const room = new Room(this.generateCode(), this.env);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) {
    return typeof code === 'string' ? this.rooms.get(code.toUpperCase()) : undefined;
  }

  delete(code) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.destroy();
    this.rooms.delete(code);
  }

  /** Inaktive und leere Räume entfernen */
  cleanup(now = Date.now()) {
    for (const room of this.rooms.values()) {
      const nobody = room.onlineHumans().length === 0 && room.spectators.size === 0;
      if (now - room.lastActivity > this.idleMs || (nobody && now - room.lastActivity > this.emptyMs)) {
        this.delete(room.code);
      }
    }
  }

  toJSON() {
    return [...this.rooms.values()].map((r) => r.toJSON());
  }

  restore(list) {
    for (const data of list || []) {
      try {
        const room = Room.fromJSON(data, this.env);
        this.rooms.set(room.code, room);
        if (room.game && room.status === 'playing') {
          room.armTimers();
          room.scheduleBots();
        }
      } catch (err) {
        console.error(`Raum ${data?.code} konnte nicht wiederhergestellt werden:`, err.message);
      }
    }
  }

  stop() {
    clearInterval(this.cleanupTimer);
    for (const r of this.rooms.values()) r.destroy();
  }
}

/** Minimal-Zug bei abgelaufenem Zug-Timer */
function autoMove(game, pid, memory) {
  const phase = game.s.phase;
  if (phase === 'roll' || phase === 'jail') return { type: 'roll' };
  if (phase === 'end') return { type: 'endTurn' };
  const a = decide(game, pid, 'medium', memory);
  if (phase === 'buy') return a?.type === 'buy' ? a : { type: 'decline' };
  return a; // debt: Geld beschaffen, zahlen oder Bankrott
}
