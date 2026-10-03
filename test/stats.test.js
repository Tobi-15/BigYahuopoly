/**
 * Statistik-Sammler und Auswertung.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, setDice, place, own, ok, runBotGame } from './helpers.js';
import { computeSummary } from '../server/game/stats.js';

describe('Statistik', () => {
  test('Miete, Landungen, Würfel und LOS-Einnahmen werden gezählt', () => {
    const g = makeGame();
    own(g, 'B', 3);
    place(g, 'A', 38);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll'); // über LOS auf Turmstraße
    const sum = computeSummary(g.s);
    const a = sum.players.A;
    const b = sum.players.B;
    assert.equal(a.rentPaid, 4);
    assert.equal(b.rentReceived, 4);
    assert.equal(a.goIncome, 200);
    assert.equal(a.landings[3], 1);
    assert.equal(sum.landings[3], 1);
    assert.equal(sum.diceSums[5], 1);
    assert.equal(a.rolls, 1);
    assert.equal(sum.ownership.B.bestField.idx, 3);
    assert.equal(sum.bestField.rent, 4);
    assert.deepEqual(sum.topFields[0], { idx: 3, count: 1 });
  });

  test('Steuern, Käufe, Gebäude, Hypothekenzinsen, Pasche, Gefängnis', () => {
    const g = makeGame();
    setDice(g, [1, 3]);
    ok(g, 'A', 'roll'); // Einkommensteuer
    own(g, 'A', [1, 3]);
    ok(g, 'A', 'build', { idx: 1 });
    own(g, 'A', 39);
    ok(g, 'A', 'mortgage', { idx: 39 });
    ok(g, 'A', 'unmortgage', { idx: 39 });
    ok(g, 'A', 'endTurn');
    place(g, 'B', 25);
    setDice(g, [2, 3]);
    ok(g, 'B', 'roll'); // Gehe ins Gefängnis
    const sum = computeSummary(g.s);
    assert.equal(sum.players.A.taxesPaid, 200);
    assert.equal(sum.players.A.buildingSpend, 50);
    assert.equal(sum.players.A.housesBuilt, 1);
    assert.equal(sum.players.A.interestPaid, 20);
    assert.equal(sum.players.B.jailVisits, 1);
    assert.equal(sum.players.B.landings[10], 1);
    assert.equal(sum.players.B.landings[30], 1);
  });

  test('Versteigerungen: höchstes Gebot und Schnäppchen', () => {
    const g = makeGame();
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'decline');
    ok(g, 'B', 'bid', { amount: 20 });
    ok(g, 'A', 'pass');
    ok(g, 'C', 'pass');
    const sum = computeSummary(g.s);
    assert.equal(sum.auctions.count, 1);
    assert.equal(sum.auctions.highest.amount, 20);
    assert.equal(sum.auctions.cheapest.pid, 'B');
    assert.ok(sum.badges.some((b) => b.id === 'bargain' && b.pid === 'B'));
    assert.equal(sum.players.B.purchases, 20);
  });

  test('Handel wird mit Wert gezählt', () => {
    const g = makeGame();
    own(g, 'B', 6);
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 150 }, get: { props: [6] } });
    ok(g, 'B', 'tradeAccept', { id: g.s.trades[0].id });
    const sum = computeSummary(g.s);
    assert.equal(sum.trades.count, 1);
    assert.equal(sum.trades.totalValue, 250);
    assert.equal(sum.players.A.tradesCount, 1);
    assert.ok(sum.badges.some((b) => b.id === 'trader'));
  });

  test('Vermögensverlauf, Rangliste und Auszeichnungen nach einem kompletten Spiel', () => {
    const { game } = runBotGame({ n: 4, seed: 11, levels: ['easy', 'medium', 'hard'] });
    assert.equal(game.s.phase, 'over');
    const sum = computeSummary(game.s);
    assert.equal(sum.finished, true);
    assert.equal(sum.ranking.length, 4);
    assert.equal(sum.ranking[0].pid, sum.winner);
    assert.equal(sum.ranking.at(-1).bankrupt, true);
    // Verlauf: Start (Runde 0) + jede Runde + Ende
    assert.equal(sum.history[0].round, 0);
    assert.ok(sum.history.at(-1).final);
    assert.ok(sum.history.length >= sum.rounds);
    for (const h of sum.history) assert.equal(Object.keys(h.values).length, 4);
    // Würfelsummen passen zur Anzahl der Würfe
    const rolls = Object.values(sum.players).reduce((s, p) => s + p.rolls, 0);
    assert.equal(sum.diceSums.reduce((a, b) => a + b, 0), rolls);
    assert.equal(sum.diceSums[0], 0);
    assert.equal(sum.diceSums[1], 0);
    // Bankrott-Markierungen
    assert.equal(sum.markers.filter((m) => m.kind === 'bankrupt').length, 3);
    // Badges
    assert.equal(sum.badges[0].id, 'winner');
    assert.ok(sum.badges.length >= 4);
    assert.ok(sum.topFields.length === 10);
    // Miete gezahlt = Miete erhalten
    const paid = Object.values(sum.players).reduce((s, p) => s + p.rentPaid, 0);
    const got = Object.values(sum.players).reduce((s, p) => s + p.rentReceived, 0);
    assert.equal(paid, got);
    assert.equal(sum.rentByField.reduce((a, b) => a + b, 0), got);
  });
});
