/**
 * Jede Hausregel ändert das Verhalten der Spiellogik.
 * Pro Regel: Verhalten mit Standardwert vs. mit geänderter Regel.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, setDice, place, own, ok, bad } from './helpers.js';
import { POS } from '../shared/board.js';
import { validateRules, resolveRules, PRESETS, DEFAULT_RULES, matchPreset, describeRules, RULE_DEFS } from '../shared/rules.js';
import * as L from '../shared/logic.js';
import { Game } from '../server/game/Game.js';

const money = (g, pid) => g.player(pid).money;

describe('Regel-Konfiguration', () => {
  test('Standard = Original', () => {
    const { ok: valid, rules } = validateRules({});
    assert.equal(valid, true);
    assert.equal(rules.startMoney, 1500);
    assert.equal(rules.goSalary, 200);
    assert.equal(rules.jailBail, 50);
    assert.equal(rules.freeParking, 'off');
    assert.equal(matchPreset(rules), 'classic');
  });

  test('Ungültige Werte werden erkannt und durch Standardwerte ersetzt', () => {
    const r = validateRules({ startMoney: 99999, goSalary: '200', freeParking: 'yes', auctions: 1, turnTimer: 45, playerBonus: { X: 5000 } });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 6);
    assert.equal(r.rules.startMoney, 1500);
    assert.equal(r.rules.turnTimer, 0);
    assert.deepEqual(r.rules.playerBonus, {});
  });

  test('Startbonus nur für Spieler im Raum', () => {
    const r = validateRules({ playerBonus: { A: 500, Z: 300 } }, { playerIds: ['A', 'B'] });
    assert.deepEqual(r.rules.playerBonus, { A: 500 });
  });

  test('Presets sind gültig und erkennbar', () => {
    for (const [id, p] of Object.entries(PRESETS)) {
      assert.equal(validateRules(p.rules).ok, true, id);
      assert.equal(matchPreset(p.rules), id);
    }
    assert.equal(PRESETS.party.rules.freeParking, 'jackpot');
    assert.equal(PRESETS.fast.rules.winCondition, 'rounds');
  });

  test('Regel-Übersicht markiert Abweichungen und blendet abhängige Regeln aus', () => {
    const list = describeRules({ ...DEFAULT_RULES, goSalary: 300 });
    assert.ok(list.find((x) => x.key === 'goSalary').changed);
    assert.ok(!list.find((x) => x.key === 'startMoney').changed);
    assert.ok(!list.some((x) => x.key === 'roundLimit'));
  });

  test('Spiellogik enthält alle Regeln als Konfiguration', () => {
    const R = resolveRules({});
    for (const key of Object.keys(RULE_DEFS)) assert.ok(key in R, key);
    assert.equal(R.bankHouses, 32);
    assert.equal(R.bankHotels, 12);
  });

  test('Spielstart mit ungültiger Spielerzahl scheitert', () => {
    assert.throws(() => Game.create({ players: [{ id: 'A', name: 'A', token: 'hat' }], rules: {} }), /2–6 Spieler/);
  });
});

describe('Hausregeln', () => {
  test('Startgeld', () => {
    const g = makeGame({ rules: { startMoney: 3000 } });
    assert.equal(money(g, 'A'), 3000);
  });

  test('LOS-Gehalt', () => {
    const g = makeGame({ rules: { goSalary: 400 } });
    place(g, 'A', 38);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    assert.equal(money(g, 'A'), 1900);
  });

  test('Doppeltes Gehalt genau auf LOS', () => {
    const std = makeGame();
    place(std, 'A', 35);
    setDice(std, [2, 3]);
    ok(std, 'A', 'roll');
    assert.equal(money(std, 'A'), 1700);

    const g = makeGame({ rules: { doubleGoOnLand: true } });
    place(g, 'A', 35);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').position, POS.GO);
    assert.equal(money(g, 'A'), 1900);
  });

  test('Frei Parken: Jackpot sammelt Steuern und zahlt aus', () => {
    const std = makeGame();
    setDice(std, [1, 3]);
    ok(std, 'A', 'roll');
    assert.equal(std.s.pot, 0);

    const g = makeGame({ rules: { freeParking: 'jackpot' } });
    setDice(g, [1, 3]);
    ok(g, 'A', 'roll'); // Einkommensteuer 200
    assert.equal(g.s.pot, 200);
    ok(g, 'A', 'endTurn');
    place(g, 'B', 15);
    setDice(g, [2, 3]);
    ok(g, 'B', 'roll'); // Frei Parken
    assert.equal(money(g, 'B'), 1700);
    assert.equal(g.s.pot, 0);
  });

  test('Versteigerungen aus: Feld bleibt unverkauft', () => {
    const g = makeGame({ rules: { auctions: false } });
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'decline');
    assert.equal(g.s.phase, 'end');
    assert.equal(g.s.auction, null);
    assert.equal(g.s.props[5].owner, null);
  });

  test('Gleichmäßiges Bauen aus', () => {
    const g = makeGame({ rules: { evenBuild: false } });
    own(g, 'A', [1, 3]);
    ok(g, 'A', 'build', { idx: 1 });
    ok(g, 'A', 'build', { idx: 1 });
    ok(g, 'A', 'build', { idx: 1 });
    assert.equal(g.s.props[1].houses, 3);
    assert.equal(g.s.props[3].houses, 0);
  });

  test('Keine Miete im Gefängnis', () => {
    for (const [rentInJail, expected] of [[true, 1496], [false, 1500]]) {
      const g = makeGame({ rules: { rentInJail } });
      own(g, 'B', 3);
      Object.assign(g.player('B'), { inJail: true, position: POS.JAIL });
      setDice(g, [1, 2]);
      ok(g, 'A', 'roll');
      assert.equal(money(g, 'A'), expected, `rentInJail=${rentInJail}`);
    }
  });

  test('Doppelte Miete bei Farbgruppe abschaltbar', () => {
    const g = makeGame({ rules: { monopolyDoubleRent: false } });
    own(g, 'B', [1, 3]);
    assert.equal(L.calcRent(g.s, g.rules, 3, 7), 4);
    const std = makeGame();
    own(std, 'B', [1, 3]);
    assert.equal(L.calcRent(std.s, std.rules, 3, 7), 8);
  });

  test('Hypothekenzinsen 0 %', () => {
    const g = makeGame({ rules: { mortgageInterest: 0 } });
    own(g, 'A', 39);
    ok(g, 'A', 'mortgage', { idx: 39 });
    ok(g, 'A', 'unmortgage', { idx: 39 });
    assert.equal(money(g, 'A'), 1500);
    const std = makeGame();
    own(std, 'A', 39);
    ok(std, 'A', 'mortgage', { idx: 39 });
    ok(std, 'A', 'unmortgage', { idx: 39 });
    assert.equal(money(std, 'A'), 1480);
  });

  test('Gefängniskaution und maximale Gefängnisrunden', () => {
    const g = makeGame({ rules: { jailBail: 120, maxJailTurns: 1 } });
    Object.assign(g.player('A'), { inJail: true, position: POS.JAIL });
    g.s.phase = 'jail';
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').inJail, false, 'nach 1 Versuch frei');
    assert.equal(money(g, 'A'), 1380);
    assert.equal(g.player('A').position, 13);
  });

  test('Gebäudelimit unbegrenzt', () => {
    const g = makeGame({ rules: { buildingLimit: 'unlimited' } });
    own(g, 'A', [1, 3]);
    g.s.bank.houses = 0;
    ok(g, 'A', 'build', { idx: 1 });
    const std = makeGame();
    own(std, 'A', [1, 3]);
    std.s.bank.houses = 0;
    bad(std, 'A', 'build', { idx: 1 }, /keine Häuser/);
  });

  test('Zug-Timer setzt eine Frist pro Entscheidung', () => {
    const off = makeGame();
    assert.equal(off.s.deadline, null);
    const g = makeGame({ rules: { turnTimer: 30 } });
    assert.equal(g.s.deadline, g.clock() + 30000);
    g.clock.advance(5000);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    assert.equal(g.s.phase, 'buy');
    assert.equal(g.s.deadline, g.clock() + 30000, 'neue Frist für die Kaufentscheidung');
  });

  test('Handel deaktiviert / erst ab Runde X', () => {
    const off = makeGame({ rules: { trading: false } });
    own(off, 'B', 6);
    bad(off, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } }, /deaktiviert/);

    const g = makeGame({ rules: { noTradeRounds: 2 } });
    own(g, 'B', 6);
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } }, /ab Runde 3/);
    g.s.round = 3;
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } });
  });

  test('Siegbedingung Rundenlimit: höchstes Vermögen gewinnt', () => {
    const g = makeGame({ n: 2, rules: { winCondition: 'rounds', roundLimit: 5 } });
    own(g, 'B', [5, 39]);
    g.s.round = 5;
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll'); // Miete an B
    ok(g, 'A', 'endTurn');
    assert.equal(g.s.phase, 'roll', 'Runde 5 läuft noch');
    setDice(g, [2, 3]);
    ok(g, 'B', 'roll'); // eigenes Feld
    ok(g, 'B', 'endTurn');
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.endReason, 'rounds');
    assert.equal(g.s.winner, 'B');
    assert.deepEqual(g.s.ranking, ['B', 'A']);
  });

  test('Siegbedingung Zeitlimit: laufende Runde wird beendet', () => {
    const g = makeGame({ n: 2, rules: { winCondition: 'time', timeLimit: 10 } });
    own(g, 'A', [5, 39]);
    g.clock.advance(11 * 60000);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'endTurn');
    assert.equal(g.s.phase, 'roll', 'Runde läuft noch');
    setDice(g, [2, 3]);
    ok(g, 'B', 'roll');
    ok(g, 'B', 'endTurn');
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.endReason, 'time');
    assert.equal(g.s.winner, 'A');
  });

  test('Letzter Überlebender: Rundenzahl spielt keine Rolle', () => {
    const g = makeGame({ n: 2 });
    g.s.round = 500;
    ok(g, 'A', 'roll');
    while (g.s.phase !== 'end') {
      if (g.s.phase === 'buy') ok(g, 'A', 'decline');
      else if (g.s.phase === 'auction') { g.clock.advance(20000); g.tick(); }
      else if (g.s.phase === 'roll') ok(g, 'A', 'roll');
      else break;
    }
    if (g.s.phase === 'end') ok(g, 'A', 'endTurn');
    assert.notEqual(g.s.phase, 'over');
  });

  test('Bot-Handicap und Startbonus für einzelne Spieler', () => {
    const g = Game.create({
      players: [
        { id: 'A', name: 'A', token: 'hat' },
        { id: 'B', name: 'B', token: 'car' },
        { id: 'K', name: 'Bot', token: 'dog', isBot: true, botLevel: 'easy' },
      ],
      rules: { botHandicap: 300, playerBonus: { B: 500 } },
      shuffleOrder: false,
    });
    assert.equal(money(g, 'A'), 1500);
    assert.equal(money(g, 'B'), 2000);
    assert.equal(money(g, 'K'), 1200);
  });
});
