/**
 * Test-Hilfen: deterministischer Zufall, Spiel-Fabrik, Invarianten-Prüfung
 * und ein Bot-Simulator für komplette Spiele.
 */
import assert from 'node:assert/strict';
import { Game } from '../server/game/Game.js';
import { decide, tradeResponse } from '../server/game/bot.js';
import { BOARD, PROPERTY_INDICES, HOTEL_LEVEL } from '../shared/board.js';

/** Seedbarer Zufallsgenerator (mulberry32) */
export function seeded(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Steuerbare Uhr */
export function fakeClock(start = 1_700_000_000_000) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

/** Spiel mit festen Spielern A, B, C … in fester Reihenfolge */
export function makeGame({ n = 3, rules = {}, seed = 1, bots = false } = {}) {
  const ids = ['A', 'B', 'C', 'D', 'E', 'F'].slice(0, n);
  const clock = fakeClock();
  const game = Game.create({
    players: ids.map((id, i) => ({ id, name: `Spieler ${id}`, token: ['hat', 'car', 'ship', 'dog', 'shoe', 'iron'][i], isBot: bots, botLevel: bots ? 'medium' : null })),
    rules,
    rng: seeded(seed),
    now: clock,
    shuffleOrder: false,
  });
  game.clock = clock;
  return game;
}

/** Würfelergebnisse vorgeben */
export function setDice(game, ...rolls) {
  game.diceQueue.push(...rolls);
}

/** Spielfigur direkt versetzen (Testaufbau) */
export function place(game, pid, pos) {
  game.player(pid).position = pos;
}

/** Feld zuweisen (Testaufbau) */
export function own(game, pid, idxs, extra = {}) {
  for (const i of [].concat(idxs)) Object.assign(game.s.props[i], { owner: pid, ...extra });
}

/** Aktion ausführen und Erfolg erwarten */
export function ok(game, pid, type, payload) {
  const r = game.act(pid, type, payload);
  assert.equal(r.error, undefined, `${type} von ${pid} sollte klappen: ${r.error}`);
  return r;
}

/** Aktion ausführen und Fehler erwarten */
export function bad(game, pid, type, payload, re) {
  const r = game.act(pid, type, payload);
  assert.equal(r.ok, false, `${type} von ${pid} sollte scheitern`);
  if (re) assert.match(r.error, re);
  return r;
}

/** Grundlegende Invarianten des Spielzustands */
export function checkInvariants(game) {
  const s = game.s;
  const R = game.rules;
  for (const p of s.players) {
    assert.ok(Number.isInteger(p.money) && p.money >= 0, `Geld von ${p.name} ungültig: ${p.money}`);
    assert.ok(p.position >= 0 && p.position < BOARD.length);
    if (p.bankrupt) assert.equal(PROPERTY_INDICES.filter((i) => s.props[i].owner === p.id).length, 0);
  }
  let houses = 0;
  let hotels = 0;
  for (const i of PROPERTY_INDICES) {
    const pr = s.props[i];
    assert.ok(pr.houses >= 0 && pr.houses <= HOTEL_LEVEL);
    if (pr.houses > 0) {
      assert.equal(BOARD[i].type, 'street');
      assert.ok(pr.owner);
      assert.ok(!pr.mortgaged, 'bebautes Feld mit Hypothek');
    }
    if (pr.houses === HOTEL_LEVEL) hotels++;
    else houses += pr.houses;
  }
  if (R.buildingLimit === 'bank') {
    assert.equal(s.bank.houses + houses, R.bankHouses, 'Häuser-Bestand stimmt nicht');
    assert.equal(s.bank.hotels + hotels, R.bankHotels, 'Hotel-Bestand stimmt nicht');
  }
  // Freikarten: jede Karte genau einmal (Stapel oder Spieler)
  const cards = [...s.decks.chance, ...s.decks.community, ...s.players.flatMap((p) => p.jailCards)];
  assert.equal(cards.length, 32, 'Kartenanzahl stimmt nicht');
  assert.equal(new Set(cards).size, 32, 'Karte doppelt');
  const stable = ['roll', 'jail', 'buy', 'auction', 'debt', 'end', 'over'];
  assert.ok(stable.includes(s.phase), `instabile Phase ${s.phase}`);
  if (s.phase === 'auction') assert.ok(s.auction);
  if (s.phase === 'buy') assert.ok(s.pendingBuy !== null);
  if (s.phase === 'debt') assert.ok(s.debts.length);
  // Nach dem Bankrott des aktiven Spielers laufen noch Versteigerungen, dann kommt der nächste Zug
  if (s.phase !== 'over' && s.phase !== 'auction') assert.ok(!game.current.bankrupt, 'aktiver Spieler ist bankrott');
}

/**
 * Spielt ein komplettes Spiel nur mit Bots (ohne Zeitverzögerung).
 * Versteigerungen: alle Bots bieten reihum, bis alle passen; dann läuft die Uhr ab.
 */
export function runBotGame({ n = 4, rules = {}, seed = 1, levels, maxSteps = 60000, check = true } = {}) {
  const game = makeGame({ n, rules, seed, bots: true });
  const lv = (pid) => (levels ? levels[game.s.players.findIndex((p) => p.id === pid) % levels.length] : 'medium');
  const memory = Object.fromEntries(game.s.players.map((p) => [p.id, { tried: {} }]));
  let steps = 0;
  while (game.s.phase !== 'over' && steps < maxSteps) {
    steps++;
    const s = game.s;
    // Offene Handelsangebote beantworten
    if (s.trades.length && s.phase !== 'auction') {
      const t = s.trades[0];
      const r = tradeResponse(game, t.to, t, lv(t.to));
      const res = game.act(t.to, r, { id: t.id });
      if (!res.ok) game.s.trades = game.s.trades.filter((x) => x.id !== t.id);
      if (check) checkInvariants(game);
      continue;
    }
    if (s.phase === 'auction') {
      let acted = false;
      for (const p of game.alivePlayers()) {
        const a = decide(game, p.id, lv(p.id), memory[p.id]);
        if (a && game.s.phase === 'auction') {
          const r = game.act(p.id, a.type, a.payload);
          assert.ok(r.ok, `Bot-Aktion ${a.type} scheiterte: ${r.error}`);
          acted = true;
        }
      }
      if (!acted && game.s.phase === 'auction') {
        game.clock.advance(game.rules.auctionResetMs + 1);
        game.tick();
      }
      if (check) checkInvariants(game);
      continue;
    }
    const pid = game.responsiblePid();
    assert.ok(pid, `niemand verantwortlich in Phase ${s.phase}`);
    const a = decide(game, pid, lv(pid), memory[pid]);
    assert.ok(a, `Bot hat keine Aktion in Phase ${s.phase}`);
    const r = game.act(pid, a.type, a.payload);
    assert.ok(r.ok, `Bot-Aktion ${a.type} in Phase ${s.phase} scheiterte: ${r.error}`);
    game.flushEvents();
    if (check) checkInvariants(game);
  }
  return { game, steps };
}
