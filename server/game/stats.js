/**
 * Statistik-Sammler.
 *
 * Sammelt während des Spiels alle Kennzahlen in einer eigenen, rein
 * datenbasierten Struktur (Teil des Spiel-Snapshots, aber nicht des
 * öffentlichen Zustands). computeSummary() erzeugt daraus die Auswertung für
 * den Statistik-Screen: Rangliste, Vermögensverlauf, Heatmap, Finanzen,
 * Würfelverteilung, Handel/Auktionen und Auszeichnungen.
 */
import { BOARD, BOARD_SIZE, GROUPS } from '../../shared/board.js';
import * as L from '../../shared/logic.js';

/** Käufe ab diesem Betrag werden im Vermögensverlauf markiert */
const BIG_PURCHASE = 300;
/** Obergrenze für das gespeicherte Replay-Log */
const MAX_REPLAY = 8000;

const zeros = (n) => Array(n).fill(0);

function emptyPlayerStats() {
  return {
    rentPaid: 0,
    rentReceived: 0,
    goIncome: 0,
    taxesPaid: 0,      // Steuern, Strafen, Reparaturen, Kaution
    cardIncome: 0,
    cardPaid: 0,
    purchases: 0,      // Grundstückskäufe inkl. Versteigerungen
    buildingSpend: 0,
    buildingSales: 0,
    mortgageTaken: 0,
    mortgageRepaid: 0,
    interestPaid: 0,
    jackpotWon: 0,
    inherited: 0,
    jailVisits: 0,
    doubles: 0,
    rolls: 0,
    cardsDrawn: 0,
    housesBuilt: 0,
    hotelsBuilt: 0,
    propertiesBought: 0,
    auctionsWon: 0,
    tradesCount: 0,
    tradeValue: 0,
    bankruptRound: null,
    diceSums: zeros(13),
    landings: zeros(BOARD_SIZE),
    rentByField: zeros(BOARD_SIZE),
  };
}

export function createStats(players) {
  return {
    players: Object.fromEntries(players.map((p) => [p.id, emptyPlayerStats()])),
    landings: zeros(BOARD_SIZE),
    diceSums: zeros(13),
    history: [],
    markers: [],
    trades: [],
    auctions: [],
    replay: [],
  };
}

/** Schreibt in das übergebene Daten-Objekt (bleibt serialisierbar) */
export class StatsCollector {
  constructor(data) {
    this.d = data;
  }

  p(pid) {
    return pid ? this.d.players[pid] : null;
  }

  onDice(pid, a, b) {
    const ps = this.p(pid);
    ps.rolls++;
    ps.diceSums[a + b]++;
    this.d.diceSums[a + b]++;
    if (a === b) ps.doubles++;
  }

  onLand(pid, idx) {
    this.d.landings[idx]++;
    this.p(pid).landings[idx]++;
  }

  onPay(from, to, amount, kind, meta = {}) {
    const f = this.p(from);
    const t = this.p(to);
    switch (kind) {
      case 'rent':
        f.rentPaid += amount;
        t.rentReceived += amount;
        if (meta.idx !== undefined) t.rentByField[meta.idx] += amount;
        break;
      case 'go':
        t.goIncome += amount;
        break;
      case 'tax':
      case 'fine':
      case 'repairs':
      case 'bail':
        f.taxesPaid += amount;
        break;
      case 'card':
        if (f) f.cardPaid += amount;
        if (t) t.cardIncome += amount;
        break;
      case 'purchase':
        f.purchases += amount;
        break;
      case 'building':
        f.buildingSpend += amount;
        break;
      case 'buildingSale':
        t.buildingSales += amount;
        break;
      case 'mortgage':
        t.mortgageTaken += amount;
        break;
      case 'unmortgage':
        f.mortgageRepaid += amount;
        break;
      case 'interest':
        f.interestPaid += amount;
        break;
      case 'jackpot':
        t.jackpotWon += amount;
        break;
      case 'bankruptcy':
        if (t) t.inherited += amount;
        break;
      default:
        break; // trade: über onTrade
    }
  }

  onBuy(s, pid, idx, price, viaAuction) {
    const ps = this.p(pid);
    ps.propertiesBought++;
    if (viaAuction) {
      ps.auctionsWon++;
      this.d.auctions.push({ round: s.round, idx, pid, amount: price, listPrice: BOARD[idx].price });
    }
    if (price >= BIG_PURCHASE) this.marker(s, pid, 'buy', `${BOARD[idx].name} für ${price} €`);
  }

  onBuild(pid, idx, cost, isHotel) {
    const ps = this.p(pid);
    if (isHotel) ps.hotelsBuilt++;
    else ps.housesBuilt++;
  }

  onJail(pid) {
    this.p(pid).jailVisits++;
  }

  onCard(pid) {
    this.p(pid).cardsDrawn++;
  }

  onTrade(s, t) {
    const side = (sd) => sd.money + sd.props.reduce((sum, i) => sum + BOARD[i].price, 0);
    const value = side(t.give) + side(t.get);
    for (const pid of [t.from, t.to]) {
      this.p(pid).tradesCount++;
      this.p(pid).tradeValue += value;
    }
    this.d.trades.push({ round: s.round, from: t.from, to: t.to, value });
  }

  onBankrupt(s, pid) {
    this.p(pid).bankruptRound = s.round;
    this.marker(s, pid, 'bankrupt', 'Bankrott');
  }

  marker(s, pid, kind, text) {
    if (kind === 'monopoly' && this.d.markers.some((m) => m.pid === pid && m.text === text)) return;
    this.d.markers.push({ round: s.round, pid, kind, text });
  }

  /** Vermögens-Schnappschuss (am Spielstart, nach jeder Runde und am Ende) */
  snapshot(s, round, final = false) {
    const values = {};
    for (const p of s.players) {
      values[p.id] = p.bankrupt ? { cash: 0, property: 0, buildings: 0, total: 0 } : L.netWorth(s, p.id);
    }
    const h = this.d.history;
    const entry = { round, final, values };
    if (h.length && h[h.length - 1].round === round) h[h.length - 1] = entry;
    else h.push(entry);
  }

  replay(entry) {
    if (this.d.replay.length < MAX_REPLAY) this.d.replay.push(entry);
  }
}

/* ---------------------------------------------------------------------- */
/* Auswertung                                                              */
/* ---------------------------------------------------------------------- */

/** Auszeichnungen: [id, Name, Symbol, Beschreibung, Wert-Funktion, Richtung] */
const BADGES = [
  ['shark', 'Immobilienhai', '🦈', 'Die meisten Häuser gebaut', (ps) => ps.housesBuilt + ps.hotelsBuilt * 5, 'max'],
  ['landlord', 'Mietkönig', '👑', 'Die meisten Mieteinnahmen', (ps) => ps.rentReceived, 'max'],
  ['unlucky', 'Pechvogel', '🐦', 'Die meiste Miete gezahlt', (ps) => ps.rentPaid, 'max'],
  ['jailbird', 'Stammgast im Gefängnis', '🔒', 'Die meisten Gefängnisbesuche', (ps) => ps.jailVisits, 'max'],
  ['trader', 'Großer Handelsmann', '🤝', 'Die meisten Handel abgeschlossen', (ps) => ps.tradesCount * 1e6 + ps.tradeValue, 'max'],
  ['doubles', 'Pasch-Profi', '🎲', 'Die meisten Pasche gewürfelt', (ps) => ps.doubles, 'max'],
  ['taxpayer', 'Fleißiger Steuerzahler', '🧾', 'Die meisten Steuern und Strafen gezahlt', (ps) => ps.taxesPaid, 'max'],
  ['lucky', 'Glückspilz', '🍀', 'Den größten Frei-Parken-Jackpot geknackt', (ps) => ps.jackpotWon, 'max'],
];

/**
 * Erzeugt die Statistik-Auswertung für alle Clients.
 * Funktioniert während des Spiels (Live-Statistik) und danach.
 */
export function computeSummary(s) {
  const d = s.stats;
  const players = s.players;
  const now = s.endedAt || Date.now();

  // Rangliste: am Ende die festgelegte Reihenfolge, live nach Vermögen
  const worth = Object.fromEntries(players.map((p) => [p.id, p.bankrupt ? 0 : L.netWorth(s, p.id).total]));
  const ranking = s.ranking
    ? s.ranking.slice()
    : [
        ...players.filter((p) => !p.bankrupt).sort((a, b) => worth[b.id] - worth[a.id]).map((p) => p.id),
        ...s.bankruptOrder.slice().reverse(),
      ];

  // Besitz und Gebäude
  const ownership = {};
  for (const p of players) {
    const fields = L.ownedBy(s, p.id);
    const { houses, hotels } = L.buildingCount(s, p.id);
    const ps = d.players[p.id];
    let bestIdx = null;
    ps.rentByField.forEach((v, i) => { if (v > 0 && (bestIdx === null || v > ps.rentByField[bestIdx])) bestIdx = i; });
    ownership[p.id] = {
      fields,
      groups: L.completedGroups(s, p.id).filter((g) => GROUPS[g] && !['railroad', 'utility'].includes(g)),
      railroads: L.countOwnedOfType(s, p.id, 'railroad'),
      utilities: L.countOwnedOfType(s, p.id, 'utility'),
      houses,
      hotels,
      bestField: bestIdx === null ? null : { idx: bestIdx, rent: ps.rentByField[bestIdx] },
    };
  }

  // Ertragreichstes Feld insgesamt
  const rentByField = zeros(BOARD_SIZE);
  for (const p of players) d.players[p.id].rentByField.forEach((v, i) => { rentByField[i] += v; });
  let bestField = null;
  rentByField.forEach((v, i) => { if (v > 0 && (!bestField || v > bestField.rent)) bestField = { idx: i, rent: v }; });

  // Meistbesuchte Felder
  const topFields = d.landings
    .map((count, idx) => ({ idx, count }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.idx - b.idx)
    .slice(0, 10);

  // Versteigerungen
  const auctions = d.auctions;
  const highest = auctions.reduce((m, a) => (!m || a.amount > m.amount ? a : m), null);
  const cheapest = auctions.reduce((m, a) => (!m || a.amount / a.listPrice < m.amount / m.listPrice ? a : m), null);

  // Auszeichnungen (Gleichstand: besser platzierter Spieler gewinnt)
  const rankOf = (pid) => ranking.indexOf(pid);
  const badges = [];
  for (const [id, name, icon, description, fn] of BADGES) {
    let best = null;
    for (const p of players) {
      const v = fn(d.players[p.id]);
      if (v <= 0) continue;
      if (!best || v > best.v || (v === best.v && rankOf(p.id) < rankOf(best.pid))) best = { pid: p.id, v };
    }
    if (best) badges.push({ id, name, icon, description, pid: best.pid });
  }
  if (cheapest) {
    badges.push({
      id: 'bargain',
      name: 'Schnäppchenjäger',
      icon: '🏷️',
      description: `${BOARD[cheapest.idx].name} für ${cheapest.amount} € ersteigert (Listenpreis ${cheapest.listPrice} €)`,
      pid: cheapest.pid,
    });
  }
  if (s.winner) {
    badges.unshift({ id: 'winner', name: 'Champion', icon: '🏆', description: 'Hat das Spiel gewonnen', pid: s.winner });
  }

  return {
    finished: s.phase === 'over',
    winner: s.winner,
    endReason: s.endReason,
    startedAt: s.startedAt,
    durationMs: now - s.startedAt,
    rounds: s.round,
    ranking: ranking.map((pid, i) => {
      const p = players.find((x) => x.id === pid);
      return {
        pid,
        rank: i + 1,
        name: p.name,
        token: p.token,
        bankrupt: p.bankrupt,
        bankruptRound: d.players[pid].bankruptRound,
        netWorth: worth[pid],
      };
    }),
    players: Object.fromEntries(players.map((p) => {
      const { landings, diceSums, rentByField: _r, ...rest } = d.players[p.id];
      return [p.id, { ...rest, landings, diceSums, name: p.name, token: p.token }];
    })),
    history: d.history,
    markers: d.markers,
    landings: d.landings,
    topFields,
    diceSums: d.diceSums,
    doublesTotal: players.reduce((sum, p) => sum + d.players[p.id].doubles, 0),
    ownership,
    bestField,
    rentByField,
    trades: {
      count: d.trades.length,
      totalValue: d.trades.reduce((sum, t) => sum + t.value, 0),
      list: d.trades,
    },
    auctions: {
      count: auctions.length,
      highest,
      cheapest,
      list: auctions,
    },
    badges,
  };
}

/** Vollständiges Spielprotokoll für die Replay-Ansicht */
export function replayLog(s) {
  return s.stats.replay;
}

