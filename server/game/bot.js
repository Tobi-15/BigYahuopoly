/**
 * KI-Gegner in drei Stufen (easy / medium / hard).
 *
 * Bots erhalten keinen Sonderzugang: decide() liefert eine Aktion
 * { type, payload }, die wie eine Spieleraktion über game.act() geprüft und
 * ausgeführt wird. Damit halten sich Bots automatisch an alle Hausregeln.
 * Dieselbe Logik (Stufe „medium“) übernimmt bei abgelaufenem Zug-Timer und
 * für abwesende Spieler.
 */
import { BOARD, GROUP_MEMBERS, PROPERTY_INDICES } from '../../shared/board.js';
import * as L from '../../shared/logic.js';

export const BOT_LEVELS = ['easy', 'medium', 'hard'];
export const BOT_LEVEL_NAMES = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };

const BOT_NAMES = ['Ada', 'Bruno', 'Clara', 'Dieter', 'Erika', 'Fritz', 'Greta', 'Hugo', 'Ilse', 'Jonas', 'Karla', 'Lotte'];
export const botName = (taken) => {
  const free = BOT_NAMES.filter((n) => !taken.includes(`${n} (KI)`));
  return `${free[Math.floor(Math.random() * free.length)] || 'Robo'} (KI)`;
};

const roundTo = (v, step) => Math.max(step, Math.round(v / step) * step);

/** Wie viel Bargeld möchte der Bot mindestens behalten? */
function reserve(s, rules, pid, level) {
  if (level === 'easy') return 0;
  // Gefahr: höchste Miete, die auf dem Brett bei Gegnern fällig werden kann
  let danger = 0;
  for (const i of PROPERTY_INDICES) {
    const owner = s.props[i].owner;
    if (!owner || owner === pid) continue;
    if (BOARD[i].type === 'utility') continue;
    danger = Math.max(danger, L.calcRent(s, rules, i, 7));
  }
  if (level === 'medium') return Math.min(300, 100 + danger * 0.3);
  return Math.min(600, 120 + danger * 0.5);
}

/** Subjektiver Wert eines Feldes für einen Spieler */
export function valuation(s, rules, pid, idx, level) {
  const f = BOARD[idx];
  let v = f.price;
  if (level === 'easy') return v;
  if (f.type === 'street') {
    const members = GROUP_MEMBERS[f.group];
    const mine = members.filter((i) => s.props[i].owner === pid && i !== idx).length;
    const others = members.filter((i) => i !== idx);
    const completes = mine === others.length;
    const owners = new Set(others.map((i) => s.props[i].owner).filter(Boolean));
    const blocks = owners.size === 1 && !owners.has(pid) && others.every((i) => s.props[i].owner);
    if (completes) v *= level === 'hard' ? 2.4 : 1.8;
    else if (mine > 0) v *= 1.3;
    if (blocks) v *= level === 'hard' ? 1.7 : 1.4;
    // Orange und Rot sind statistisch besonders ertragreich
    if (level === 'hard' && (f.group === 'orange' || f.group === 'red')) v *= 1.15;
  } else if (f.type === 'railroad') {
    v *= 1 + 0.25 * L.countOwnedOfType(s, pid, 'railroad');
  } else if (f.type === 'utility') {
    v *= L.countOwnedOfType(s, pid, 'utility') ? 1.3 : 0.85;
  }
  return Math.round(v);
}

/** Nächste Aktion, um Geld zu beschaffen (Gebäude verkaufen, Hypotheken) */
function raiseMoneyAction(s, rules, pid) {
  const owned = L.ownedBy(s, pid);
  const groups = new Set(L.completedGroups(s, pid));
  // 1. Hypothek auf Felder, die zu keiner kompletten Gruppe gehören (billigste zuerst)
  const singles = owned
    .filter((i) => !groups.has(BOARD[i].group) && L.canMortgage(s, rules, pid, i).ok)
    .sort((a, b) => BOARD[a].mortgage - BOARD[b].mortgage);
  if (singles.length) return { type: 'mortgage', payload: { idx: singles[0] } };
  // 2. Gebäude verkaufen (günstigste Gruppe zuerst)
  const sellable = owned
    .filter((i) => L.canSellBuilding(s, rules, pid, i).ok)
    .sort((a, b) => BOARD[a].housePrice - BOARD[b].housePrice);
  if (sellable.length) return { type: 'sell', payload: { idx: sellable[0] } };
  // 3. Restliche Hypotheken
  const rest = owned.filter((i) => L.canMortgage(s, rules, pid, i).ok).sort((a, b) => BOARD[a].mortgage - BOARD[b].mortgage);
  if (rest.length) return { type: 'mortgage', payload: { idx: rest[0] } };
  return null;
}

/** Bauen / Hypotheken auslösen, wenn genug Geld da ist */
function manageAction(s, rules, pid, level, rng) {
  const p = L.getPlayer(s, pid);
  const res = reserve(s, rules, pid, level);
  const owned = L.ownedBy(s, pid);

  if (level !== 'easy') {
    // Hypotheken in kompletten Gruppen zuerst ablösen (damit man bauen kann)
    const groups = new Set(L.completedGroups(s, pid));
    const unm = owned
      .filter((i) => s.props[i].mortgaged)
      .sort((a, b) => Number(groups.has(BOARD[b].group)) - Number(groups.has(BOARD[a].group)));
    for (const i of unm) {
      const c = L.canUnmortgage(s, rules, pid, i);
      if (c.ok && p.money - c.cost >= res + (groups.has(BOARD[i].group) ? 0 : 150)) return { type: 'unmortgage', payload: { idx: i } };
    }
  }

  // Bauen: gleichmäßig, Ziel zuerst 3 Häuser (bester Ertrag), danach Hotels
  const buildable = owned.filter((i) => L.canBuild(s, rules, pid, i).ok);
  if (!buildable.length) return null;
  if (level === 'easy' && rng() < 0.5) return null;
  const score = (i) => {
    const h = s.props[i].houses;
    const target = level === 'hard' && h < 3 ? 0 : 1;
    return target * 10 + h + BOARD[i].housePrice / 1000;
  };
  buildable.sort((a, b) => score(a) - score(b));
  const i = buildable[0];
  const minKeep = level === 'easy' ? 50 : res;
  if (p.money - BOARD[i].housePrice >= minKeep) return { type: 'build', payload: { idx: i } };
  return null;
}

/**
 * Bots schlagen gelegentlich Handel vor, um eine Farbgruppe zu vervollständigen.
 * memory verhindert wiederholte Angebote.
 */
function tradeProposal(s, rules, pid, level, memory) {
  if (level === 'easy' || !L.tradingAllowed(s, rules).ok) return null;
  if (s.trades.some((t) => t.from === pid)) return null;
  const p = L.getPlayer(s, pid);
  const res = reserve(s, rules, pid, level);
  for (const [group, members] of Object.entries(GROUP_MEMBERS)) {
    if (group === 'railroad' || group === 'utility') continue;
    const mine = members.filter((i) => s.props[i].owner === pid);
    const missing = members.filter((i) => s.props[i].owner !== pid);
    if (mine.length === 0 || missing.length !== 1) continue;
    const idx = missing[0];
    const owner = s.props[idx].owner;
    if (!owner || !L.isTradeable(s, idx)) continue;
    const key = `${owner}:${idx}`;
    if ((memory.tried[key] || 0) > s.turnNo - 12) continue; // nicht öfter als alle paar Runden fragen
    // Würde der Partner dadurch selbst eine Gruppe verlieren? Dann nicht fragen.
    const theirGroup = L.ownsGroup(s, owner, BOARD[idx].group);
    if (theirGroup) continue;
    const offer = roundTo(BOARD[idx].price * (level === 'hard' ? 1.6 : 1.3), 10);
    if (p.money - offer < res) continue;
    memory.tried[key] = s.turnNo;
    return { type: 'tradeOffer', payload: { to: owner, give: { money: offer }, get: { props: [idx] } } };
  }
  return null;
}

/**
 * Hauptentscheidung für den Spieler pid.
 * @returns {{type: string, payload?: object} | null}
 */
export function decide(game, pid, level = 'medium', memory = { tried: {} }) {
  const s = game.s;
  const rules = game.rules;
  const rng = game.rng;
  const p = L.getPlayer(s, pid);
  if (!p || p.bankrupt || s.phase === 'over') return null;

  if (s.phase === 'auction') return auctionAction(game, pid, level);

  if (s.phase === 'debt') {
    const d = s.debts[0];
    if (!d || d.debtor !== pid) return null;
    if (p.money >= d.amount) return { type: 'payDebt' };
    return raiseMoneyAction(s, rules, pid) || { type: 'bankrupt' };
  }

  if (game.current.id !== pid) return null;

  switch (s.phase) {
    case 'jail': {
      const unowned = PROPERTY_INDICES.filter((i) => !s.props[i].owner).length;
      const lateGame = unowned < 6;
      if (level === 'hard' && lateGame && p.jailTurns < rules.maxJailTurns - 1) return { type: 'roll' };
      if (p.jailCards.length) return { type: 'useCard' };
      if (level === 'easy') return rng() < 0.5 && p.money > rules.jailBail + 100 ? { type: 'payBail' } : { type: 'roll' };
      if (!lateGame && p.money >= rules.jailBail + reserve(s, rules, pid, level)) return { type: 'payBail' };
      return { type: 'roll' };
    }
    case 'roll': {
      const m = level === 'easy' ? null : manageAction(s, rules, pid, level, rng);
      return m || { type: 'roll' };
    }
    case 'buy': {
      const idx = s.pendingBuy;
      const price = BOARD[idx].price;
      const res = reserve(s, rules, pid, level);
      if (level === 'easy') {
        return p.money >= price && rng() < 0.8 ? { type: 'buy' } : { type: 'decline' };
      }
      const value = valuation(s, rules, pid, idx, level);
      const worthIt = value >= price * 1.5;
      if (p.money - price >= res || (p.money >= price && worthIt)) return { type: 'buy' };
      // Schwere Bots beschaffen Geld, um wichtige Felder zu kaufen
      if (level === 'hard' && worthIt && L.liquidationValue(s, rules, pid) - price >= 50) {
        if (p.money < price) {
          const raise = raiseMoneyAction(s, rules, pid);
          if (raise && raise.type === 'mortgage') return raise;
        }
      }
      return { type: 'decline' };
    }
    case 'end': {
      const m = manageAction(s, rules, pid, level, rng);
      if (m) return m;
      const t = tradeProposal(s, rules, pid, level, memory);
      if (t) return t;
      return { type: 'endTurn' };
    }
    default:
      return null;
  }
}

/** Gebot oder Ausstieg in einer Versteigerung */
export function auctionAction(game, pid, level = 'medium') {
  const s = game.s;
  const a = s.auction;
  const p = L.getPlayer(s, pid);
  if (!a || a.passed.includes(pid) || a.bidder === pid || p.bankrupt) return null;
  const rules = game.rules;
  const value = valuation(s, rules, pid, a.idx, level);
  const factor = { easy: 0.7 + game.rng() * 0.5, medium: 1.0, hard: 1.1 }[level] ?? 1;
  const res = level === 'easy' ? 0 : reserve(s, rules, pid, level) * 0.6;
  const max = Math.floor(Math.min(value * factor, p.money - res));
  const minBid = Math.max(rules.auctionMinBid, a.bid + 1);
  if (max < minBid) return { type: 'pass' };
  const inc = a.bid < BOARD[a.idx].price * 0.5 ? roundTo(BOARD[a.idx].price * 0.1, 5) : 5 + Math.floor(game.rng() * 3) * 5;
  const amount = Math.min(max, Math.max(minBid, a.bid + inc));
  return { type: 'bid', payload: { amount } };
}

/** Antwort auf ein Handelsangebot an einen Bot: 'tradeAccept' oder 'tradeReject' */
export function tradeResponse(game, pid, trade, level = 'medium') {
  const s = game.s;
  const rules = game.rules;
  const value = (props, owner) => props.reduce((sum, i) => sum + valuation(s, rules, owner, i, level), 0);
  // Was der Bot bekommt (aus Sicht des Bots bewertet) und was er abgibt
  const gain = trade.give.money + value(trade.give.props, pid) + trade.give.cards * rules.jailBail;
  // Abgegebene Felder: Wert für den Partner, wenn es ihm eine Gruppe vervollständigt
  const lose = trade.get.money
    + trade.get.props.reduce((sum, i) => sum + Math.max(valuation(s, rules, pid, i, level), valuation(s, rules, trade.from, i, level) * (level === 'hard' ? 1 : 0.8)), 0)
    + trade.get.cards * rules.jailBail;
  const margin = { easy: -40, medium: 0, hard: 60 }[level] ?? 0;
  const ok = gain - lose > margin && L.getPlayer(s, pid).money - trade.get.money >= (level === 'easy' ? 0 : 50);
  return ok ? 'tradeAccept' : 'tradeReject';
}

