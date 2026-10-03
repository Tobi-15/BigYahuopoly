/**
 * Integrationstest mit mehreren simulierten Clients über echte
 * Socket.IO-Verbindungen: Lobby, Spielstart, Synchronität, Reconnect,
 * Abwesenheit (KI übernimmt), Zuschauer, Chat, Rate-Limit, Zug-Timer und ein
 * komplettes Spiel bis zum Statistik-Screen.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { io as ioc } from 'socket.io-client';
import { createServer } from '../server/app.js';

let srv;
let url;

before(async () => {
  srv = createServer({ botDelayMs: 5, absenceMs: 400, persistFile: null, limits: { connectionsPerMinute: 1000, roomCreatesPerMinute: 100, actionBurst: 100, actionRate: 60 } });
  await new Promise((r) => srv.server.listen(0, r));
  url = `http://localhost:${srv.server.address().port}`;
});

after(async () => {
  await srv.close();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Test-Client: merkt sich den letzten Zustand jeder Nachrichtenart */
function client(target = url) {
  const socket = ioc(target, { transports: ['websocket'], forceNew: true, reconnection: false });
  const c = { socket, state: null, room: null, stats: null, chat: [], emotes: [], updates: 0, full: 0 };
  socket.on('state:update', (m) => { c.state = m.state; c.updates++; if (m.full) c.full++; });
  socket.on('room:update', (r) => { c.room = r; });
  socket.on('stats:update', (s) => { c.stats = s; });
  socket.on('chat:message', (m) => c.chat.push(m));
  socket.on('chat:emote', (m) => c.emotes.push(m));
  c.send = (event, data = {}) => socket.emitWithAck(event, data);
  c.ok = async (event, data) => {
    const r = await c.send(event, data);
    assert.equal(r.error, undefined, `${event}: ${r.error}`);
    return r;
  };
  c.close = () => socket.disconnect();
  return c;
}

async function waitFor(fn, ms = 4000, what = 'Bedingung') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return;
    await sleep(15);
  }
  throw new Error(`Timeout: ${what}`);
}

/** Einfache Strategie für menschliche Test-Clients */
async function playStep(c, me) {
  const s = c.state;
  if (s?.phase === 'auction' && !s.auction.passed.includes(me) && s.auction.bidder !== me && c.actedAt !== c.updates) {
    c.actedAt = c.updates;
    await c.send('game:auction:pass');
    return true;
  }
  if (!s || s.phase === 'over' || s.responsible !== me) return false;
  // Nicht zweimal auf denselben Zustand reagieren
  if (c.actedAt === c.updates) return false;
  c.actedAt = c.updates;
  const event = {
    roll: 'game:roll',
    jail: 'game:roll',
    buy: s.players.find((p) => p.id === me).money > 400 ? 'game:buy' : 'game:decline',
    end: 'game:endTurn',
    debt: s.debt && s.players.find((p) => p.id === me).money >= s.debt.amount ? 'game:debt:pay' : 'game:bankrupt',
  }[s.phase];
  if (!event) return false;
  await c.send(event);
  return true;
}

test('Lobby, Spielstart, Synchronität, Reconnect und Abwesenheit mit 3 Clients', async () => {
  const a = client();
  const b = client();
  const c = client();
  const created = await a.ok('room:create', { name: 'Anna', token: 'hat' });
  assert.match(created.code, /^[A-Z0-9]{4}$/);
  const code = created.code;

  // Figur doppelt → Fehler
  const dup = await b.send('room:join', { code, name: 'Ben', token: 'hat' });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /vergeben/);
  const jb = await b.ok('room:join', { code, name: 'Ben', token: 'car' });
  const jc = await c.ok('room:join', { code, name: 'Cleo<script>', token: 'ship' });
  await waitFor(() => a.room?.members.length === 3, 2000, '3 Mitglieder');
  assert.equal(a.room.members.find((m) => m.id === jc.playerId).name, 'Cleoscript', 'HTML wird entfernt');

  // Nur der Host darf Regeln ändern; ungültige Regeln werden abgelehnt
  const notHost = await b.send('room:rules:update', { rules: { startMoney: 2000 } });
  assert.match(notHost.error, /Host/);
  const invalid = await a.send('room:rules:update', { rules: { startMoney: 1 } });
  assert.match(invalid.error, /Ungültige Regeln/);
  await a.ok('room:rules:update', { rules: { ...a.room.rules, startMoney: 2000, freeParking: 'jackpot' } });
  await waitFor(() => b.room?.rules.startMoney === 2000, 2000, 'Regeln synchron');

  // Start erst, wenn alle bereit sind
  const early = await a.send('room:start');
  assert.match(early.error, /Noch nicht bereit/);
  await a.ok('room:bot:add', { level: 'easy' });
  await b.ok('room:ready', { ready: true });
  await c.ok('room:ready', { ready: true });
  await a.ok('room:start');
  await waitFor(() => a.state && b.state && c.state, 2000, 'Spielzustand bei allen');
  assert.equal(a.state.players.length, 4);
  assert.equal(a.state.rules.startMoney, 2000);
  assert.equal(a.state.rules.freeParking, 'jackpot');
  // Startgeld laut Vermögensverlauf (Runde 0), unabhängig davon, ob die KI schon gezogen hat
  const start = (await a.ok('stats:request')).stats.history[0];
  for (const p of a.state.players) assert.equal(start.values[p.id].cash, 2000);

  // Beitritt während des Spiels nur als Zuschauer
  const late = client();
  const lateJoin = await late.send('room:join', { code, name: 'Dora', token: 'dog' });
  assert.equal(lateJoin.code, 'GAME_RUNNING');
  await late.ok('room:join', { code, name: 'Dora', spectator: true });
  await waitFor(() => late.state, 2000, 'Zuschauer erhält Zustand');
  const spectatorRoll = await late.send('game:roll');
  assert.equal(spectatorRoll.ok, false);

  // Nur der aktive Spieler darf würfeln
  const ids = { [created.playerId]: a, [jb.playerId]: b, [jc.playerId]: c };
  const clients = [a, b, c];
  for (const [pid, cl] of Object.entries(ids)) {
    if (a.state.responsible !== pid) {
      const r = await cl.send('game:roll');
      assert.equal(r.ok, false);
    }
  }

  // Einige Züge spielen; alle Clients sehen denselben Zustand
  for (let i = 0; i < 40; i++) {
    for (const [pid, cl] of Object.entries(ids)) await playStep(cl, pid);
    await sleep(20);
  }
  await sleep(150);
  const snap = (x) => JSON.stringify({ ...x.state, deadline: null });
  assert.equal(snap(a), snap(b));
  assert.equal(snap(a), snap(c));
  assert.equal(snap(a), snap(late));
  assert.ok(a.state.log.length > 5);

  // Verbindungsabbruch und Wiederverbinden: kompletter Zustand wird gesendet
  b.close();
  await waitFor(() => a.state.players.find((p) => p.id === jb.playerId).online === false, 2000, 'B offline');
  const b2 = client();
  const re = await b2.ok('room:rejoin', { code, playerId: jb.playerId, secret: jb.secret });
  assert.equal(re.playerId, jb.playerId);
  await waitFor(() => b2.full === 1 && b2.room, 2000, 'voller Zustand nach Reconnect');
  assert.equal(JSON.stringify({ ...b2.state, deadline: null }), JSON.stringify({ ...a.state, deadline: null }));
  ids[jb.playerId] = b2;
  // Falsches Geheimnis wird abgelehnt
  const evil = client();
  const hijack = await evil.send('room:rejoin', { code, playerId: jb.playerId, secret: 'falsch' });
  assert.equal(hijack.ok, false);
  // Zweites Fenster ohne force wird abgelehnt (Spieler ist schon verbunden)
  const inUse = await evil.send('room:rejoin', { code, playerId: jb.playerId, secret: jb.secret });
  assert.equal(inUse.code, 'IN_USE');
  evil.close();

  // Abwesenheit > Frist: KI übernimmt für C
  c.close();
  delete ids[jc.playerId];
  await waitFor(() => a.room.members.find((m) => m.id === jc.playerId).away, 3000, 'C als abwesend markiert');
  const cTurnsBefore = a.state.turnNo;
  for (let i = 0; i < 60 && a.state.phase !== 'over'; i++) {
    for (const [pid, cl] of Object.entries(ids)) await playStep(cl, pid);
    await sleep(15);
  }
  assert.ok(a.state.turnNo > cTurnsBefore + 2, 'Spiel läuft trotz abwesendem Spieler weiter');

  // Host entfernt den abwesenden Spieler
  if (a.state.phase !== 'over') {
    await a.ok('room:kick', { playerId: jc.playerId });
    await waitFor(() => a.state.players.find((p) => p.id === jc.playerId).bankrupt, 2000, 'C entfernt');
  }

  // Chat und Emotes
  await a.ok('chat:message', { text: 'Hallo <b>alle</b>!' });
  await a.ok('chat:emote', { emote: '👏' });
  await waitFor(() => b2.chat.some((m) => m.text === 'Hallo balle/b!') && b2.emotes.length === 1, 2000, 'Chat kommt an');
  const badEmote = await a.send('chat:emote', { emote: '💩' });
  assert.equal(badEmote.ok, false);
  // Rate-Limit beim Chat
  const results = [];
  for (let i = 0; i < 12; i++) results.push(await a.send('chat:message', { text: `spam ${i}` }));
  assert.ok(results.some((r) => /Zu viele/.test(r.error || '')), 'Rate-Limit greift');

  // Live-Statistik auf Anfrage
  const st = await late.ok('stats:request');
  assert.ok(st.stats.history.length >= 1);
  assert.equal(st.stats.finished, false);

  for (const cl of [a, b2, late]) cl.close();
});

test('Zug-Timer: Bei Ablauf zieht die KI für den Spieler', async () => {
  const a = client();
  const b = client();
  const r = await a.ok('room:create', { name: 'Tim', token: 'iron' });
  await b.ok('room:join', { code: r.code, name: 'Tom', token: 'shoe' });
  await waitFor(() => a.room, 1000, 'Raum');
  await a.ok('room:rules:update', { rules: { ...a.room.rules, turnTimer: 30 } });
  await b.ok('room:ready', { ready: true });
  await a.ok('room:start');
  await waitFor(() => a.state, 2000, 'Spiel gestartet');
  assert.ok(a.state.deadline > Date.now() + 25000, 'Frist gesetzt');
  const room = srv.rooms.get(r.code);
  const turnNo = a.state.turnNo;
  // Frist künstlich ablaufen lassen
  room.game.s.deadline = Date.now() - 1;
  room.armTimers();
  await waitFor(() => a.state.log.some((l) => /Zeit abgelaufen/.test(l.text)), 2000, 'Auto-Zug');
  assert.ok(a.state.log.some((l) => /würfelt/.test(l.text)), 'Auto-Zug hat gewürfelt');
  assert.ok(a.state.turnNo > turnNo || ['end', 'roll', 'jail', 'buy', 'debt', 'auction'].includes(a.state.phase));
  a.close();
  b.close();
});

test('Komplettes Spiel (1 Mensch + 3 Bots) bis zum Statistik-Screen, dann Revanche', async () => {
  const h = client();
  const r = await h.ok('room:create', { name: 'Hanna', token: 'thimble' });
  await waitFor(() => h.room, 1000, 'Raum');
  await h.ok('room:rules:update', { rules: { ...h.room.rules, winCondition: 'rounds', roundLimit: 15 } });
  await h.ok('room:settings:update', { maxPlayers: 4 });
  const fill = await h.ok('room:bot:fill', { level: 'hard' });
  assert.equal(fill.added, 3);
  await h.ok('room:start');
  await waitFor(() => h.state, 2000, 'Spiel gestartet');
  const me = r.playerId;
  const t0 = Date.now();
  while (!h.stats && Date.now() - t0 < 60000) {
    await playStep(h, me);
    await sleep(5);
  }
  assert.ok(h.stats, 'Statistik nach Spielende empfangen');
  assert.equal(h.state.phase, 'over');
  assert.equal(h.stats.finished, true);
  assert.equal(h.stats.ranking.length, 4);
  assert.ok(h.stats.history.length >= 2);
  assert.ok(h.stats.badges.some((b) => b.id === 'winner'));
  await waitFor(() => h.room.status === 'over', 1000, 'Raumstatus over');
  const replay = await h.ok('replay:request');
  assert.ok(replay.log.length > 50);

  // Revanche: gleicher Raum, gleiche Regeln
  h.stats = null;
  await h.ok('room:rematch');
  await waitFor(() => h.state?.phase !== 'over' && h.room.status === 'playing', 2000, 'Revanche gestartet');
  assert.equal(h.state.rules.roundLimit, 15);
  assert.equal(h.state.round, 1);
  h.close();
});

test('Lobby: Host entfernt Spieler, Host-Wechsel beim Verlassen', async () => {
  const a = client();
  const b = client();
  const c = client();
  const r = await a.ok('room:create', { name: 'Ana', token: 'hat' });
  const jb = await b.ok('room:join', { code: r.code, name: 'Bo', token: 'car' });
  await c.ok('room:join', { code: r.code, name: 'Cy', token: 'ship' });
  let kicked = false;
  b.socket.on('room:kicked', () => { kicked = true; });
  await a.ok('room:kick', { playerId: jb.playerId });
  await waitFor(() => kicked && a.room.members.length === 2, 2000, 'B entfernt');
  await a.ok('room:leave');
  await waitFor(() => c.room.members.length === 1 && c.room.hostId === c.room.members[0].id, 2000, 'C wird Host');
  for (const x of [a, b, c]) x.close();
});

test('Snapshot: Ein laufendes Spiel überlebt einen Server-Neustart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-'));
  const file = path.join(dir, 'rooms.json');
  const start = async () => {
    const s = createServer({ botDelayMs: 5, persistFile: file, limits: { connectionsPerMinute: 1000 } });
    await new Promise((r) => s.server.listen(0, r));
    return { s, url: `http://localhost:${s.server.address().port}` };
  };
  const first = await start();
  const a = client(first.url);
  const r = await a.ok('room:create', { name: 'Paula', token: 'shoe' });
  await a.ok('room:bot:add', { level: 'easy' });
  await a.ok('room:start');
  await waitFor(() => a.state, 2000, 'Spiel gestartet');
  for (let i = 0; i < 10; i++) { await playStep(a, r.playerId); await sleep(30); }
  await sleep(100);
  const before = a.state;
  a.close();
  await first.s.close(); // speichert den Snapshot
  assert.ok(fs.existsSync(file), 'Snapshot-Datei geschrieben');

  const second = await start();
  const b = client(second.url);
  await b.ok('room:rejoin', { code: r.code, playerId: r.playerId, secret: r.secret });
  await waitFor(() => b.state && b.room, 2000, 'Zustand nach Neustart');
  assert.equal(b.room.code, r.code);
  assert.equal(b.state.turnNo, before.turnNo);
  assert.deepEqual(b.state.players.map((p) => [p.id, p.money, p.position]), before.players.map((p) => [p.id, p.money, p.position]));
  assert.deepEqual(b.state.props, before.props);
  b.close();
  await second.s.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
