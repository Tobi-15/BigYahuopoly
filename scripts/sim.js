// Schnelltest: viele komplette Bot-Spiele simulieren
import { runBotGame } from '../test/helpers.js';
const N = Number(process.argv[2] || 50);
let rounds = 0, unfinished = 0;
const t0 = Date.now();
for (let seed = 1; seed <= N; seed++) {
  const { game, steps } = runBotGame({ n: 2 + (seed % 5), seed, levels: ['easy', 'medium', 'hard'], maxSteps: 40000 });
  if (game.s.phase !== 'over') unfinished++;
  rounds += game.s.round;
}
console.log(`${N} Spiele, Ø ${(rounds / N).toFixed(1)} Runden, ${unfinished} unbeendet, ${Date.now() - t0} ms`);
