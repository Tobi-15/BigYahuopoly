/**
 * Unit-Tests der Spiellogik (Standardregeln = Original).
 * Würfel werden über setDice() vorgegeben, das Brett über place()/own().
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeGame, setDice, place, own, ok, bad, checkInvariants } from './helpers.js';
import { POS } from '../shared/board.js';
import * as L from '../shared/logic.js';

const money = (g, pid) => g.player(pid).money;

describe('Grundablauf', () => {
  test('Startgeld, Startposition, erster Spieler', () => {
    const g = makeGame({ n: 3 });
    for (const p of g.s.players) {
      assert.equal(p.money, 1500);
      assert.equal(p.position, POS.GO);
    }
    assert.equal(g.current.id, 'A');
    assert.equal(g.s.phase, 'roll');
  });

  test('Würfeln bewegt die Figur, nur der aktive Spieler darf handeln', () => {
    const g = makeGame();
    bad(g, 'B', 'roll', {}, /nicht am Zug/);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').position, 5);
    assert.equal(g.s.phase, 'buy');
    ok(g, 'A', 'buy');
    assert.equal(g.s.phase, 'end');
    bad(g, 'A', 'roll', {}, /nicht möglich/);
    ok(g, 'A', 'endTurn');
    assert.equal(g.current.id, 'B');
    assert.equal(g.s.phase, 'roll');
    checkInvariants(g);
  });

  test('Pasch: erneut würfeln; dreimal Pasch = Gefängnis', () => {
    const g = makeGame();
    setDice(g, [1, 1]);
    ok(g, 'A', 'roll'); // Feld 2: Gemeinschaftsfeld
    assert.equal(g.s.phase, 'roll', 'nach Pasch darf man nochmal');
    setDice(g, [2, 2]);
    ok(g, 'A', 'roll'); // Feld 6
    if (g.s.phase === 'buy') ok(g, 'A', 'decline');
    while (g.s.phase === 'auction') { g.clock.advance(20000); g.tick(); }
    assert.equal(g.s.phase, 'roll');
    setDice(g, [3, 3]);
    ok(g, 'A', 'roll');
    const a = g.player('A');
    assert.equal(a.inJail, true);
    assert.equal(a.position, POS.JAIL);
    assert.equal(g.s.phase, 'end');
  });

  test('LOS überqueren: Gehalt', () => {
    const g = makeGame();
    place(g, 'A', 38);
    setDice(g, [2, 3]); // 38 + 5 = 3 (Turmstraße)
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').position, 3);
    assert.equal(money(g, 'A'), 1700);
  });

  test('Runden zählen nach einem vollen Umlauf', () => {
    const g = makeGame({ n: 2 });
    for (const pid of ['A', 'B']) {
      setDice(g, [2, 3]);
      ok(g, pid, 'roll');
      ok(g, pid, 'decline');
      g.clock.advance(20000);
      g.tick();
      ok(g, pid, 'endTurn');
    }
    assert.equal(g.s.round, 2);
    assert.equal(g.current.id, 'A');
  });
});

describe('Kaufen und Miete', () => {
  test('Kaufen zieht den Preis ab und setzt den Besitzer', () => {
    const g = makeGame();
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll'); // Turmstraße
    ok(g, 'A', 'buy');
    assert.equal(g.s.props[3].owner, 'A');
    assert.equal(money(g, 'A'), 1440);
  });

  test('Kaufen ohne genug Geld ist nicht möglich', () => {
    const g = makeGame();
    g.player('A').money = 30;
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll');
    bad(g, 'A', 'buy', {}, /Nicht genug Geld/);
  });

  test('Grundmiete, doppelte Miete mit Farbgruppe, Häuser und Hotel', () => {
    const g = makeGame();
    own(g, 'B', 3);
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll');
    assert.equal(money(g, 'A'), 1496);
    assert.equal(money(g, 'B'), 1504);

    const R = g.rules;
    own(g, 'B', 1);
    assert.equal(L.calcRent(g.s, R, 3, 7), 8, 'Farbgruppe verdoppelt');
    g.s.props[3].houses = 1;
    assert.equal(L.calcRent(g.s, R, 3, 7), 20);
    g.s.props[3].houses = 4;
    assert.equal(L.calcRent(g.s, R, 3, 7), 320);
    g.s.props[3].houses = 5;
    assert.equal(L.calcRent(g.s, R, 3, 7), 450);
  });

  test('Bahnhöfe nach Anzahl, Werke nach Augenzahl', () => {
    const g = makeGame();
    const R = g.rules;
    own(g, 'B', 5);
    assert.equal(L.calcRent(g.s, R, 5, 7), 25);
    own(g, 'B', 15);
    assert.equal(L.calcRent(g.s, R, 5, 7), 50);
    own(g, 'B', 25);
    assert.equal(L.calcRent(g.s, R, 5, 7), 100);
    own(g, 'B', 35);
    assert.equal(L.calcRent(g.s, R, 5, 7), 200);
    own(g, 'C', 12);
    assert.equal(L.calcRent(g.s, R, 12, 7), 28);
    own(g, 'C', 28);
    assert.equal(L.calcRent(g.s, R, 12, 7), 70);
  });

  test('Keine Miete auf Hypothek', () => {
    const g = makeGame();
    own(g, 'B', 3, { mortgaged: true });
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll');
    assert.equal(money(g, 'A'), 1500);
  });

  test('Steuern', () => {
    const g = makeGame();
    setDice(g, [1, 3]);
    ok(g, 'A', 'roll'); // Einkommensteuer
    assert.equal(money(g, 'A'), 1300);
  });
});

describe('Gefängnis', () => {
  test('„Gehe ins Gefängnis“-Feld', () => {
    const g = makeGame();
    place(g, 'A', 25);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').inJail, true);
    assert.equal(g.player('A').position, POS.JAIL);
    assert.equal(money(g, 'A'), 1500, 'kein LOS-Gehalt');
  });

  test('Pasch befreit, aber ohne weiteren Wurf', () => {
    const g = makeGame({ n: 2 });
    Object.assign(g.player('A'), { inJail: true, position: POS.JAIL });
    g.s.phase = 'jail';
    setDice(g, [3, 3]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').inJail, false);
    assert.equal(g.player('A').position, 16);
    if (g.s.phase === 'buy') ok(g, 'A', 'buy');
    assert.equal(g.s.phase, 'end');
  });

  test('Nach 3 Fehlversuchen: Kaution zahlen und ziehen', () => {
    const g = makeGame({ n: 2 });
    Object.assign(g.player('A'), { inJail: true, position: POS.JAIL });
    g.s.phase = 'jail';
    for (let i = 1; i <= 2; i++) {
      setDice(g, [1, 2]);
      ok(g, 'A', 'roll');
      assert.equal(g.player('A').inJail, true);
      assert.equal(g.player('A').jailTurns, i);
      ok(g, 'A', 'endTurn');
      // B würfelt
      setDice(g, [5, 6]);
      ok(g, 'B', 'roll');
      if (g.s.phase === 'buy') ok(g, 'B', 'decline');
      while (g.s.phase === 'auction') { g.clock.advance(20000); g.tick(); }
      ok(g, 'B', 'endTurn');
      assert.equal(g.s.phase, 'jail');
    }
    setDice(g, [1, 2]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').inJail, false);
    assert.equal(g.player('A').position, 13);
    assert.equal(money(g, 'A'), 1450);
  });

  test('Kaution zahlen und Freikarte nutzen', () => {
    const g = makeGame();
    Object.assign(g.player('A'), { inJail: true, position: POS.JAIL });
    g.s.phase = 'jail';
    bad(g, 'A', 'useCard', {}, /keine Freikarte/);
    ok(g, 'A', 'payBail');
    assert.equal(money(g, 'A'), 1450);
    assert.equal(g.s.phase, 'roll');

    const g2 = makeGame();
    Object.assign(g2.player('A'), { inJail: true, position: POS.JAIL });
    g2.s.phase = 'jail';
    g2.s.decks.chance = g2.s.decks.chance.filter((c) => c !== 'c10');
    g2.player('A').jailCards.push('c10');
    ok(g2, 'A', 'useCard');
    assert.equal(g2.player('A').inJail, false);
    assert.equal(g2.s.decks.chance.at(-1), 'c10', 'Karte liegt wieder unter dem Stapel');
    checkInvariants(g2);
  });
});

describe('Bauen, Verkaufen, Hypotheken', () => {
  test('Bauen nur mit kompletter Farbgruppe und gleichmäßig', () => {
    const g = makeGame();
    own(g, 'A', 1);
    bad(g, 'A', 'build', { idx: 1 }, /ganze Farbgruppe/);
    own(g, 'A', 3);
    ok(g, 'A', 'build', { idx: 1 });
    bad(g, 'A', 'build', { idx: 1 }, /Gleichmäßig/);
    ok(g, 'A', 'build', { idx: 3 });
    ok(g, 'A', 'build', { idx: 1 });
    assert.equal(g.s.props[1].houses, 2);
    assert.equal(money(g, 'A'), 1350);
    assert.equal(g.s.bank.houses, 29);
    checkInvariants(g);
  });

  test('Hotel: 4 Häuser zurück an die Bank, Verkauf zum halben Preis', () => {
    const g = makeGame();
    own(g, 'A', [1, 3]);
    for (let i = 0; i < 4; i++) { ok(g, 'A', 'build', { idx: 1 }); ok(g, 'A', 'build', { idx: 3 }); }
    assert.equal(g.s.bank.houses, 24);
    ok(g, 'A', 'build', { idx: 1 });
    assert.equal(g.s.props[1].houses, 5);
    assert.equal(g.s.bank.houses, 28);
    assert.equal(g.s.bank.hotels, 11);
    const before = money(g, 'A');
    ok(g, 'A', 'sell', { idx: 1 });
    assert.equal(money(g, 'A'), before + 25);
    assert.equal(g.s.props[1].houses, 4);
    assert.equal(g.s.bank.hotels, 12);
    checkInvariants(g);
  });

  test('Bankbestand begrenzt das Bauen', () => {
    const g = makeGame();
    own(g, 'A', [1, 3]);
    g.s.bank.houses = 1;
    ok(g, 'A', 'build', { idx: 1 });
    bad(g, 'A', 'build', { idx: 3 }, /keine Häuser mehr/);
  });

  test('Hypothek nur ohne Gebäude in der Gruppe; Rückzahlung mit 10 % Zinsen', () => {
    const g = makeGame();
    own(g, 'A', [1, 3]);
    ok(g, 'A', 'build', { idx: 1 });
    bad(g, 'A', 'mortgage', { idx: 3 }, /Gebäude/);
    ok(g, 'A', 'sell', { idx: 1 });
    ok(g, 'A', 'mortgage', { idx: 3 });
    assert.equal(money(g, 'A'), 1500 - 50 + 25 + 30);
    bad(g, 'A', 'build', { idx: 1 }, /Hypothek/);
    ok(g, 'A', 'unmortgage', { idx: 3 });
    assert.equal(money(g, 'A'), 1505 - 33);
  });

  test('Verwalten nur im eigenen Zug', () => {
    const g = makeGame();
    own(g, 'B', 5);
    bad(g, 'B', 'mortgage', { idx: 5 }, /deines Zuges/);
  });
});

describe('Schulden und Bankrott', () => {
  test('Zu wenig Geld: Schuldenphase, Hypothek aufnehmen, bezahlen', () => {
    const g = makeGame();
    own(g, 'B', [37, 39]);
    g.s.props[39].houses = 0;
    g.player('A').money = 50;
    own(g, 'A', 5);
    place(g, 'A', 33);
    setDice(g, [2, 4]); // 39 Schlossallee: 100 Miete (Gruppe)
    ok(g, 'A', 'roll');
    assert.equal(g.s.phase, 'debt');
    assert.equal(g.s.debts[0].amount, 100);
    bad(g, 'A', 'payDebt', {}, /fehlen/);
    bad(g, 'A', 'endTurn');
    ok(g, 'A', 'mortgage', { idx: 5 });
    ok(g, 'A', 'payDebt');
    assert.equal(money(g, 'A'), 50);
    assert.equal(money(g, 'B'), 1600);
    assert.equal(g.s.phase, 'end');
  });

  test('Bankrott an einen Spieler: Vermögen und Hypotheken gehen über', () => {
    const g = makeGame();
    own(g, 'B', [37, 39]);
    g.s.props[39].houses = 5;
    g.s.bank.hotels = 11;
    own(g, 'A', 5, { mortgaged: true });
    own(g, 'A', 6);
    g.player('A').money = 100;
    place(g, 'A', 33);
    setDice(g, [2, 4]);
    ok(g, 'A', 'roll');
    assert.equal(g.s.phase, 'debt');
    ok(g, 'A', 'bankrupt');
    assert.equal(g.player('A').bankrupt, true);
    assert.equal(g.s.props[5].owner, 'B');
    assert.equal(g.s.props[5].mortgaged, true);
    assert.equal(g.s.props[6].owner, 'B');
    // 100 € Bargeld − 10 € Zinsen für die übernommene Hypothek
    assert.equal(money(g, 'B'), 1500 + 100 - 10);
    assert.equal(g.current.id, 'B');
    checkInvariants(g);
  });

  test('Bankrott an die Bank: Felder werden versteigert', () => {
    const g = makeGame({ n: 3 });
    own(g, 'A', [1, 3]);
    g.s.props[1].houses = 1;
    g.s.bank.houses = 31;
    g.player('A').money = 10;
    place(g, 'A', 2);
    setDice(g, [1, 1]); // Einkommensteuer
    ok(g, 'A', 'roll');
    assert.equal(g.s.phase, 'debt');
    ok(g, 'A', 'bankrupt');
    assert.equal(g.s.phase, 'auction');
    assert.equal(g.s.auction.idx, 1);
    assert.equal(g.s.props[1].houses, 0);
    assert.equal(g.s.bank.houses, 32);
    ok(g, 'B', 'bid', { amount: 30 });
    ok(g, 'C', 'pass');
    assert.equal(g.s.props[1].owner, 'B');
    assert.equal(g.s.auction.idx, 3, 'nächste Versteigerung');
    ok(g, 'B', 'pass');
    ok(g, 'C', 'pass');
    assert.equal(g.s.props[3].owner, null);
    assert.equal(g.current.id, 'B');
    assert.equal(g.s.phase, 'roll');
    checkInvariants(g);
  });

  test('Letzter Überlebender gewinnt', () => {
    const g = makeGame({ n: 2 });
    own(g, 'B', 4 - 1);
    g.player('A').money = 0;
    setDice(g, [1, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'bankrupt');
    assert.equal(g.s.phase, 'over');
    assert.equal(g.s.winner, 'B');
    assert.deepEqual(g.s.ranking, ['B', 'A']);
  });
});

describe('Versteigerung', () => {
  test('Ablehnen startet Versteigerung; Gebote, Countdown, Zuschlag', () => {
    const g = makeGame();
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'decline');
    assert.equal(g.s.phase, 'auction');
    const a = g.s.auction;
    bad(g, 'B', 'bid', { amount: 0 }, /mindestens/);
    ok(g, 'B', 'bid', { amount: 50 });
    const end1 = g.s.auction.endsAt;
    g.clock.advance(3000);
    bad(g, 'C', 'bid', { amount: 50 }, /mindestens/);
    bad(g, 'C', 'bid', { amount: 5000 }, /Bargeld/);
    ok(g, 'C', 'bid', { amount: 80 });
    assert.ok(g.s.auction.endsAt > end1, 'Countdown wird zurückgesetzt');
    bad(g, 'C', 'pass', {}, /Höchstbietender/);
    ok(g, 'A', 'pass');
    g.clock.advance(g.rules.auctionResetMs - 1);
    assert.equal(g.tick(), false);
    g.clock.advance(2);
    assert.equal(g.tick(), true);
    assert.equal(g.s.props[a.idx].owner, 'C');
    assert.equal(money(g, 'C'), 1420);
    assert.equal(g.s.phase, 'end');
    assert.equal(g.current.id, 'A');
  });

  test('Alle steigen aus: Feld bleibt bei der Bank', () => {
    const g = makeGame();
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'decline');
    for (const pid of ['A', 'B', 'C']) ok(g, pid, 'pass');
    assert.equal(g.s.props[5].owner, null);
    assert.equal(g.s.phase, 'end');
  });

  test('Während der Versteigerung ist kein Handel möglich', () => {
    const g = makeGame();
    own(g, 'B', 6);
    setDice(g, [2, 3]);
    ok(g, 'A', 'roll');
    ok(g, 'A', 'decline');
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } }, /Versteigerung/);
  });
});

describe('Handel', () => {
  test('Angebot annehmen tauscht Felder, Geld und Freikarten', () => {
    const g = makeGame();
    own(g, 'A', 1);
    own(g, 'B', 3);
    g.s.decks.chance = g.s.decks.chance.filter((c) => c !== 'c10');
    g.player('B').jailCards.push('c10');
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { props: [1], money: 100 }, get: { props: [3], cards: 1 } });
    const t = g.s.trades[0];
    bad(g, 'C', 'tradeAccept', { id: t.id }, /nicht an dich/);
    ok(g, 'B', 'tradeAccept', { id: t.id });
    assert.equal(g.s.props[1].owner, 'B');
    assert.equal(g.s.props[3].owner, 'A');
    assert.equal(money(g, 'A'), 1400);
    assert.equal(money(g, 'B'), 1600);
    assert.deepEqual(g.player('A').jailCards, ['c10']);
    assert.equal(g.s.trades.length, 0);
    checkInvariants(g);
  });

  test('Ungültige Angebote werden abgelehnt', () => {
    const g = makeGame();
    own(g, 'A', [1, 3]);
    g.s.props[1].houses = 1;
    g.s.bank.houses = 31;
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { props: [3] } }, /Gebäude/);
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { props: [5] } }, /gehört nicht/);
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { money: 99999 } }, /Bargeld/);
    bad(g, 'A', 'tradeOffer', { to: 'B', give: {}, get: {} }, /leer/);
    bad(g, 'A', 'tradeOffer', { to: 'A', give: { money: 1 } }, /selbst/);
    bad(g, 'A', 'tradeOffer', { to: 'B', give: { money: -5 } }, /Ungültig/);
  });

  test('Ablehnen, Zurückziehen und Gegenangebot', () => {
    const g = makeGame();
    own(g, 'B', 6);
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 50 }, get: { props: [6] } });
    ok(g, 'B', 'tradeReject', { id: g.s.trades[0].id });
    assert.equal(g.s.trades.length, 0);
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 50 }, get: { props: [6] } });
    ok(g, 'A', 'tradeCancel', { id: g.s.trades[0].id });
    assert.equal(g.s.trades.length, 0);
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 50 }, get: { props: [6] } });
    const id = g.s.trades[0].id;
    ok(g, 'B', 'tradeCounter', { id, give: { props: [6] }, get: { money: 150 } });
    assert.equal(g.s.trades.length, 1);
    const c = g.s.trades[0];
    assert.equal(c.from, 'B');
    assert.equal(c.to, 'A');
    assert.equal(c.counterOf, id);
    ok(g, 'A', 'tradeAccept', { id: c.id });
    assert.equal(g.s.props[6].owner, 'A');
    assert.equal(money(g, 'A'), 1350);
  });

  test('Übernommene Hypothek kostet 10 % Zinsen', () => {
    const g = makeGame();
    own(g, 'B', 6, { mortgaged: true });
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } });
    ok(g, 'B', 'tradeAccept', { id: g.s.trades[0].id });
    assert.equal(money(g, 'A'), 1500 - 10 - 5);
    assert.equal(g.s.props[6].mortgaged, true);
  });

  test('Angebot verfällt, wenn sich der Besitz ändert', () => {
    const g = makeGame();
    own(g, 'B', 6);
    ok(g, 'A', 'tradeOffer', { to: 'B', give: { money: 10 }, get: { props: [6] } });
    own(g, 'C', 6);
    bad(g, 'B', 'tradeAccept', { id: g.s.trades[0].id }, /gehört nicht/);
    assert.equal(g.s.trades.length, 0);
  });
});

describe('Karten', () => {
  const drawChance = (g, cardId, from = 4) => {
    g.s.decks.chance = [cardId, ...g.s.decks.chance.filter((c) => c !== cardId)];
    place(g, 'A', from);
    setDice(g, [1, 2]); // from + 3 = 7 (Ereignisfeld)
    ok(g, 'A', 'roll');
  };
  const drawCommunity = (g, cardId) => {
    g.s.decks.community = [cardId, ...g.s.decks.community.filter((c) => c !== cardId)];
    place(g, 'A', 14);
    setDice(g, [1, 2]); // 17 (Gemeinschaftsfeld)
    ok(g, 'A', 'roll');
  };

  test('Rücke vor bis auf LOS', () => {
    const g = makeGame();
    drawChance(g, 'c1');
    assert.equal(g.player('A').position, 0);
    assert.equal(money(g, 'A'), 1700);
    assert.equal(g.s.decks.chance.at(-1), 'c1', 'Karte wandert unter den Stapel');
  });

  test('Schlossallee kaufen, nächster Bahnhof mit doppelter Miete', () => {
    const g = makeGame();
    drawChance(g, 'c2');
    assert.equal(g.player('A').position, 39);
    assert.equal(g.s.phase, 'buy');

    const g2 = makeGame();
    own(g2, 'B', 15);
    drawChance(g2, 'c5');
    assert.equal(g2.player('A').position, 15);
    assert.equal(money(g2, 'A'), 1500 - 50);
  });

  test('Nächstes Werk: neu würfeln, 10-fache Augenzahl', () => {
    const g = makeGame();
    own(g, 'B', 12);
    g.s.decks.chance = ['c7', ...g.s.decks.chance.filter((c) => c !== 'c7')];
    place(g, 'A', 4);
    setDice(g, [1, 2], [4, 5]);
    ok(g, 'A', 'roll');
    assert.equal(g.player('A').position, 12);
    assert.equal(money(g, 'A'), 1500 - 90);
  });

  test('Gehe 3 Felder zurück → Einkommensteuer', () => {
    const g = makeGame();
    drawChance(g, 'c11');
    assert.equal(g.player('A').position, 4);
    assert.equal(money(g, 'A'), 1300);
  });

  test('Gefängnis-Karte und Freikarte', () => {
    const g = makeGame();
    drawChance(g, 'c12');
    assert.equal(g.player('A').inJail, true);
    const g2 = makeGame();
    drawChance(g2, 'c10');
    assert.deepEqual(g2.player('A').jailCards, ['c10']);
    assert.ok(!g2.s.decks.chance.includes('c10'), 'Freikarte bleibt beim Spieler');
    checkInvariants(g2);
  });

  test('Geburtstag: alle zahlen; Vorstand: du zahlst allen', () => {
    const g = makeGame();
    drawCommunity(g, 'g9');
    assert.equal(money(g, 'A'), 1520);
    assert.equal(money(g, 'B'), 1490);
    const g2 = makeGame();
    drawChance(g2, 'c15');
    assert.equal(money(g2, 'A'), 1400);
    assert.equal(money(g2, 'C'), 1550);
  });

  test('Geburtstag: Mitspieler ohne Geld gerät in Schulden', () => {
    const g = makeGame();
    g.player('B').money = 5;
    own(g, 'B', 6);
    drawCommunity(g, 'g9');
    assert.equal(g.s.phase, 'debt');
    assert.equal(g.responsiblePid(), 'B');
    ok(g, 'B', 'mortgage', { idx: 6 });
    ok(g, 'B', 'payDebt');
    assert.equal(g.s.phase, 'end');
    assert.equal(g.current.id, 'A');
    assert.equal(money(g, 'A'), 1520);
  });

  test('Hausreparaturen pro Haus und Hotel', () => {
    const g = makeGame();
    own(g, 'A', [1, 3, 6, 8, 9]);
    g.s.props[1].houses = 2;
    g.s.props[3].houses = 5;
    g.s.bank.houses = 30;
    g.s.bank.hotels = 11;
    drawCommunity(g, 'g14');
    assert.equal(money(g, 'A'), 1500 - 2 * 40 - 115);
  });
});
