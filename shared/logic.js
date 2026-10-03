/**
 * Gemeinsame, reine Regel-Funktionen.
 *
 * Der Server nutzt sie für die verbindliche Spiellogik, der Client nur zur
 * Anzeige und Vorabprüfung (z. B. Bau-Button aktivieren). Alle Funktionen
 * arbeiten auf dem öffentlichen Spielzustand und der aufgelösten
 * Regel-Konfiguration (shared/rules.js → resolveRules) und verändern nichts.
 *
 * Zustand (Auszug):
 *   state.players[i] = { id, money, position, inJail, bankrupt, jailCards: [] ... }
 *   state.props[idx] = { owner: playerId | null, houses: 0..5 (5 = Hotel), mortgaged }
 *   state.bank       = { houses, hotels }
 */
import { BOARD, GROUPS, GROUP_MEMBERS, HOTEL_LEVEL, PROPERTY_INDICES } from './board.js';

export const getPlayer = (state, pid) => state.players.find((p) => p.id === pid);
export const ownerOf = (state, idx) => state.props[idx]?.owner ?? null;
export const ownedBy = (state, pid) => PROPERTY_INDICES.filter((i) => state.props[i].owner === pid);

/** Besitzt pid alle Felder der Gruppe? */
export function ownsGroup(state, pid, group) {
  return GROUP_MEMBERS[group].every((i) => state.props[i].owner === pid);
}

/** Anzahl Felder eines Typs (railroad/utility), die pid besitzt */
export function countOwnedOfType(state, pid, type) {
  return PROPERTY_INDICES.filter((i) => BOARD[i].type === type && state.props[i].owner === pid).length;
}

/** Gebäude einer Gruppe (Summe der Stufen) */
export const groupHasBuildings = (state, group) => GROUP_MEMBERS[group].some((i) => state.props[i].houses > 0);

/**
 * Miete für ein Feld.
 * @param {number} diceSum            Augensumme (für Werke)
 * @param {object} [mod]              Karten-Modifikatoren
 * @param {number} [mod.rentMultiplier]  z. B. 2 beim „nächsten Bahnhof“
 * @param {number} [mod.diceMultiplier]  z. B. 10 beim „nächsten Werk“
 * @returns {number} 0, wenn keine Miete fällig ist
 */
export function calcRent(state, rules, idx, diceSum, mod = {}) {
  const field = BOARD[idx];
  const prop = state.props[idx];
  if (!field?.price || !prop || prop.owner === null || prop.mortgaged) return 0;
  const owner = getPlayer(state, prop.owner);
  if (!owner || owner.bankrupt) return 0;
  if (!rules.rentInJail && owner.inJail) return 0;

  let rent = 0;
  if (field.type === 'street') {
    if (prop.houses > 0) rent = field.rent[prop.houses];
    else {
      rent = field.rent[0];
      if (rules.monopolyDoubleRent && ownsGroup(state, owner.id, field.group)) rent *= 2;
    }
  } else if (field.type === 'railroad') {
    const n = countOwnedOfType(state, owner.id, 'railroad');
    rent = field.rent[n - 1] || 0;
  } else if (field.type === 'utility') {
    const n = countOwnedOfType(state, owner.id, 'utility');
    const factor = mod.diceMultiplier || field.rent[n - 1] || 0;
    rent = factor * diceSum;
  }
  if (mod.rentMultiplier) rent *= mod.rentMultiplier;
  return rent;
}

/** Wie viele Gebäude kann die Bank noch abgeben? */
function bankHas(state, rules, kind) {
  if (rules.buildingLimit === 'unlimited') return true;
  return kind === 'hotel' ? state.bank.hotels > 0 : state.bank.houses > 0;
}

/**
 * Darf pid auf idx ein Haus (bzw. Hotel) bauen?
 * @returns {{ ok: boolean, reason?: string, cost?: number }}
 */
export function canBuild(state, rules, pid, idx) {
  const field = BOARD[idx];
  const prop = state.props[idx];
  if (!field || field.type !== 'street') return { ok: false, reason: 'Auf diesem Feld kann man nicht bauen.' };
  if (prop.owner !== pid) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (!ownsGroup(state, pid, field.group)) return { ok: false, reason: 'Du brauchst die ganze Farbgruppe.' };
  const members = GROUP_MEMBERS[field.group];
  if (members.some((i) => state.props[i].mortgaged)) return { ok: false, reason: 'Ein Feld der Gruppe ist mit einer Hypothek belastet.' };
  if (prop.houses >= HOTEL_LEVEL) return { ok: false, reason: 'Hier steht bereits ein Hotel.' };
  if (rules.evenBuild) {
    const min = Math.min(...members.map((i) => state.props[i].houses));
    if (prop.houses > min) return { ok: false, reason: 'Gleichmäßig bauen: Erst die anderen Straßen der Gruppe bebauen.' };
  }
  const nextIsHotel = prop.houses === HOTEL_LEVEL - 1;
  if (!bankHas(state, rules, nextIsHotel ? 'hotel' : 'house')) {
    return { ok: false, reason: nextIsHotel ? 'Die Bank hat keine Hotels mehr.' : 'Die Bank hat keine Häuser mehr.' };
  }
  const player = getPlayer(state, pid);
  if (player.money < field.housePrice) return { ok: false, reason: 'Nicht genug Geld.', cost: field.housePrice };
  return { ok: true, cost: field.housePrice };
}

/**
 * Darf pid auf idx ein Gebäude verkaufen (halber Preis)?
 * Ein Hotel wird zu 4 Häusern zurückgebaut. Hat die Bank nicht genug Häuser,
 * ist das nicht möglich (Original-Regel) – dann müsste man die ganze Gruppe räumen.
 */
export function canSellBuilding(state, rules, pid, idx) {
  const field = BOARD[idx];
  const prop = state.props[idx];
  if (!field || field.type !== 'street') return { ok: false, reason: 'Hier stehen keine Gebäude.' };
  if (prop.owner !== pid) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (prop.houses <= 0) return { ok: false, reason: 'Hier stehen keine Gebäude.' };
  if (rules.evenBuild) {
    const max = Math.max(...GROUP_MEMBERS[field.group].map((i) => state.props[i].houses));
    if (prop.houses < max) return { ok: false, reason: 'Gleichmäßig verkaufen: Erst die Straßen mit mehr Gebäuden räumen.' };
  }
  if (prop.houses === HOTEL_LEVEL && rules.buildingLimit !== 'unlimited' && state.bank.houses < rules.housesPerHotel) {
    return { ok: false, reason: `Die Bank hat keine ${rules.housesPerHotel} Häuser, um das Hotel zu ersetzen.` };
  }
  return { ok: true, refund: Math.floor(field.housePrice * rules.buildingSellRatio) };
}

/** Darf pid idx mit einer Hypothek belasten? */
export function canMortgage(state, rules, pid, idx) {
  const field = BOARD[idx];
  const prop = state.props[idx];
  if (!field?.price) return { ok: false, reason: 'Kein Grundstück.' };
  if (prop.owner !== pid) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (prop.mortgaged) return { ok: false, reason: 'Bereits mit einer Hypothek belastet.' };
  if (field.type === 'street' && groupHasBuildings(state, field.group)) {
    return { ok: false, reason: 'Erst alle Gebäude der Farbgruppe verkaufen.' };
  }
  return { ok: true, amount: field.mortgage };
}

/** Rückzahlungsbetrag einer Hypothek inkl. Zinsen */
export const unmortgageCost = (rules, idx) =>
  BOARD[idx].mortgage + Math.ceil((BOARD[idx].mortgage * rules.mortgageInterest) / 100);

/** Nur die Zinsen (fällig, wenn man ein belastetes Feld übernimmt) */
export const mortgageInterestFee = (rules, idx) => Math.ceil((BOARD[idx].mortgage * rules.mortgageInterest) / 100);

export function canUnmortgage(state, rules, pid, idx) {
  const prop = state.props[idx];
  if (!BOARD[idx]?.price) return { ok: false, reason: 'Kein Grundstück.' };
  if (prop.owner !== pid) return { ok: false, reason: 'Das Feld gehört dir nicht.' };
  if (!prop.mortgaged) return { ok: false, reason: 'Keine Hypothek vorhanden.' };
  const cost = unmortgageCost(rules, idx);
  if (getPlayer(state, pid).money < cost) return { ok: false, reason: 'Nicht genug Geld.', cost };
  return { ok: true, cost };
}

/** Darf ein Feld gehandelt werden? (keine Gebäude in der Farbgruppe) */
export function isTradeable(state, idx) {
  const field = BOARD[idx];
  if (!field?.price) return false;
  if (field.type === 'street' && groupHasBuildings(state, field.group)) return false;
  return true;
}

/** Wert der Gebäude auf einem Feld zum Kaufpreis */
export function buildingValue(idx, houses) {
  return houses * (BOARD[idx].housePrice || 0);
}

/**
 * Vermögen: Bargeld + Grundbesitz (Kaufpreis, bei Hypothek Kaufpreis − Hypothek)
 * + Gebäude (Kaufpreis).
 */
export function netWorth(state, pid) {
  const p = getPlayer(state, pid);
  if (!p) return { cash: 0, property: 0, buildings: 0, total: 0 };
  let property = 0;
  let buildings = 0;
  for (const i of ownedBy(state, pid)) {
    const prop = state.props[i];
    property += prop.mortgaged ? BOARD[i].price - BOARD[i].mortgage : BOARD[i].price;
    buildings += buildingValue(i, prop.houses);
  }
  const cash = p.money;
  return { cash, property, buildings, total: cash + property + buildings };
}

/**
 * Wie viel Geld könnte pid sofort flüssig machen?
 * Bargeld + halber Gebäudewert + Hypothekenwert aller unbelasteten Felder.
 */
export function liquidationValue(state, rules, pid) {
  const p = getPlayer(state, pid);
  let total = p.money;
  for (const i of ownedBy(state, pid)) {
    const prop = state.props[i];
    total += Math.floor(buildingValue(i, prop.houses) * rules.buildingSellRatio);
    if (!prop.mortgaged) total += BOARD[i].mortgage;
  }
  return total;
}

/** Anzahl Häuser und Hotels eines Spielers */
export function buildingCount(state, pid) {
  let houses = 0;
  let hotels = 0;
  for (const i of ownedBy(state, pid)) {
    const h = state.props[i].houses;
    if (h === HOTEL_LEVEL) hotels++;
    else houses += h;
  }
  return { houses, hotels };
}

/** Gruppen, die ein Spieler komplett besitzt */
export function completedGroups(state, pid) {
  return Object.keys(GROUPS).filter((g) => GROUP_MEMBERS[g].length && ownsGroup(state, pid, g));
}

/** Ist Handel gerade erlaubt (Hausregel + Sperrrunden)? */
export function tradingAllowed(state, rules) {
  if (!rules.trading) return { ok: false, reason: 'Handel ist in diesem Spiel deaktiviert.' };
  if (state.round <= rules.noTradeRounds) {
    return { ok: false, reason: `Handel ist erst ab Runde ${rules.noTradeRounds + 1} erlaubt.` };
  }
  return { ok: true };
}
