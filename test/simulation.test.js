/**
 * Fuzzing: viele komplette Spiele mit Bots unterschiedlicher Stärke und
 * verschiedenen Hausregeln. Nach jeder Aktion werden die Invarianten geprüft
 * (kein negatives Geld, Gebäudebestand, Karten vollständig, stabile Phase …).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runBotGame } from './helpers.js';
import { PRESETS } from '../shared/rules.js';

const variants = [
  { name: 'Klassisch', rules: PRESETS.classic.rules },
  { name: 'Party', rules: PRESETS.party.rules },
  { name: 'Schnell', rules: PRESETS.fast.rules },
  { name: 'Alles anders', rules: { evenBuild: false, rentInJail: false, monopolyDoubleRent: false, mortgageInterest: 0, buildingLimit: 'unlimited', jailBail: 200, maxJailTurns: 1, startMoney: 800 } },
  // Ohne Handel entstehen kaum Farbgruppen – daher mit Rundenlimit
  { name: 'Ohne Handel', rules: { trading: false, freeParking: 'jackpot', doubleGoOnLand: true, winCondition: 'rounds', roundLimit: 120 } },
];

for (const v of variants) {
  test(`Bot-Spiele bis zum Ende: ${v.name}`, () => {
    for (let seed = 1; seed <= 8; seed++) {
      const n = 2 + (seed % 5);
      const { game } = runBotGame({ n, seed: seed * 31, rules: v.rules, levels: ['easy', 'medium', 'hard'] });
      assert.equal(game.s.phase, 'over', `Spiel ${seed} (${n} Spieler) ist nicht beendet`);
      if (v.rules.winCondition === 'rounds') assert.ok(game.s.round <= v.rules.roundLimit);
    }
  });
}
