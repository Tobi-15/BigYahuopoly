/**
 * Raum-Logik ohne Netzwerk: Host-Rechte, Bereit-Status, Regel-Validierung
 * beim Spielstart, Bots, Entfernen im Spiel.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Room } from '../server/rooms.js';

const env = { botDelayMs: 1, absenceMs: 50 };
const fakeSocket = (id) => ({ id });

function lobby() {
  const room = new Room('TEST', env);
  const host = room.addMember({ name: 'Host', token: 'hat' });
  const guest = room.addMember({ name: 'Gast', token: 'car' });
  room.attach(fakeSocket('s1'), host.id);
  room.attach(fakeSocket('s2'), guest.id);
  return { room, host, guest };
}

describe('Räume', () => {
  test('Nur der Host darf Regeln ändern und starten', () => {
    const { room, host, guest } = lobby();
    assert.throws(() => room.updateRules(guest.id, { startMoney: 2000 }), /Host/);
    assert.throws(() => room.startGame(guest.id), /Host/);
    room.updateRules(host.id, { ...room.rules, startMoney: 2000 });
    assert.equal(room.rules.startMoney, 2000);
    room.destroy();
  });

  test('Start erst, wenn alle bereit sind', () => {
    const { room, host, guest } = lobby();
    assert.throws(() => room.startGame(host.id), /Noch nicht bereit: Gast/);
    room.setReady(guest.id, true);
    room.startGame(host.id);
    assert.equal(room.status, 'playing');
    assert.equal(room.game.s.players.length, 2);
    room.destroy();
  });

  test('Regeln werden beim Spielstart erneut validiert', () => {
    const { room, host, guest } = lobby();
    room.setReady(guest.id, true);
    // Manipulierte Regeln (z. B. aus einem alten Snapshot) werden beim Start abgelehnt
    room.rules = { ...room.rules, startMoney: 99999, turnTimer: 7 };
    assert.throws(() => room.startGame(host.id), /Ungültige Regeln/);
    assert.equal(room.status, 'lobby');
    room.destroy();
  });

  test('Regeländerung setzt den Bereit-Status zurück', () => {
    const { room, host, guest } = lobby();
    room.setReady(guest.id, true);
    room.updateRules(host.id, { ...room.rules, auctions: false });
    assert.equal(room.members.get(guest.id).ready, false);
    room.destroy();
  });

  test('Bots auffüllen, Figuren bleiben eindeutig, Spielerzahl begrenzt', () => {
    const { room, host } = lobby();
    room.updateSettings(host.id, { maxPlayers: 5 });
    assert.equal(room.fillBots(host.id, 'hard'), 3);
    const tokens = [...room.members.values()].map((m) => m.token);
    assert.equal(new Set(tokens).size, 5);
    assert.throws(() => room.addBot(host.id, 'easy'), /voll/);
    assert.throws(() => room.updateSettings(host.id, { maxPlayers: 3 }), /mehr Spieler/);
    room.destroy();
  });

  test('Im Spiel kann der Host nur abwesende Spieler entfernen', () => {
    const { room, host, guest } = lobby();
    room.addBot(host.id, 'easy');
    room.setReady(guest.id, true);
    room.startGame(host.id);
    assert.throws(() => room.kick(host.id, guest.id), /abwesende/);
    room.detach('s2', guest.id);
    room.kick(host.id, guest.id);
    assert.equal(room.game.player(guest.id).bankrupt, true);
    room.destroy();
  });

  test('Abwesenheit: KI übernimmt, Rückkehr beendet die Übernahme', async () => {
    const { room, host, guest } = lobby();
    room.setReady(guest.id, true);
    room.startGame(host.id);
    room.detach('s2', guest.id);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(room.members.get(guest.id).away, true);
    assert.equal(room.isBotControlled(guest.id), true);
    room.attach(fakeSocket('s3'), guest.id);
    assert.equal(room.members.get(guest.id).away, false);
    assert.equal(room.isBotControlled(guest.id), false);
    room.destroy();
  });
});
