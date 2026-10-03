/**
 * Zentrale Regel-Konfiguration (Hausregeln).
 *
 * - RULE_DEFS beschreibt jede einstellbare Regel: Typ, Grenzen, Standardwert
 *   (= Originalregel), Beschriftung und Tooltip-Text.
 * - FIXED enthält unveränderliche Spielkonstanten. Auch sie liegen hier, damit
 *   die Spiellogik keine festverdrahteten Zahlen braucht.
 * - validateRules() prüft eine Konfiguration (Server: bei jeder Änderung und
 *   beim Spielstart). resolveRules() liefert das vollständige Objekt, das die
 *   Spiellogik liest.
 *
 * Das Modul läuft unverändert in Node und im Browser (ES-Modul ohne Abhängigkeiten).
 */

export const RULE_DEFS = {
  startMoney: {
    type: 'int', min: 500, max: 5000, step: 50, default: 1500, section: 'Geld',
    label: 'Startgeld', unit: '€',
    help: 'Bargeld, mit dem jeder Spieler beginnt. Original: 1500 €.',
  },
  goSalary: {
    type: 'int', min: 100, max: 500, step: 10, default: 200, section: 'Geld',
    label: 'LOS-Gehalt', unit: '€',
    help: 'Betrag, den man beim Überqueren oder Betreten von LOS erhält. Original: 200 €.',
  },
  doubleGoOnLand: {
    type: 'bool', default: false, section: 'Geld',
    label: 'Doppeltes Gehalt auf LOS',
    help: 'Wer genau auf LOS landet, erhält das doppelte Gehalt. Gilt nicht für Karten, die nur „bis auf LOS“ vorrücken lassen.',
  },
  freeParking: {
    type: 'enum', options: ['off', 'jackpot'], default: 'off', section: 'Geld',
    label: 'Frei Parken',
    optionLabels: { off: 'Aus (Original)', jackpot: 'Jackpot' },
    help: 'Jackpot: Steuern, Strafen und Kartenzahlungen an die Bank landen in der Mitte. Wer auf Frei Parken landet, erhält alles.',
  },
  auctions: {
    type: 'bool', default: true, section: 'Grundbesitz',
    label: 'Versteigerungen',
    help: 'Kauft ein Spieler ein Feld nicht, wird es an alle versteigert. Aus: Das Feld bleibt unverkauft.',
  },
  evenBuild: {
    type: 'bool', default: true, section: 'Grundbesitz',
    label: 'Gleichmäßig bauen',
    help: 'Innerhalb einer Farbgruppe darf ein Feld höchstens ein Haus mehr haben als die anderen (gilt auch beim Verkauf).',
  },
  monopolyDoubleRent: {
    type: 'bool', default: true, section: 'Grundbesitz',
    label: 'Doppelte Miete bei Farbgruppe',
    help: 'Besitzt jemand alle Straßen einer Farbe, verdoppelt sich die Grundmiete auf unbebauten Straßen.',
  },
  rentInJail: {
    type: 'bool', default: true, section: 'Grundbesitz',
    label: 'Miete im Gefängnis',
    help: 'Spieler im Gefängnis dürfen weiterhin Miete kassieren. Aus: Wer im Gefängnis sitzt, erhält keine Miete.',
  },
  mortgageInterest: {
    type: 'enum', options: [10, 0], default: 10, section: 'Grundbesitz',
    label: 'Hypothekenzinsen', unit: '%',
    optionLabels: { 10: '10 % (Original)', 0: '0 %' },
    help: 'Aufschlag beim Zurückzahlen einer Hypothek und beim Übernehmen belasteter Felder.',
  },
  buildingLimit: {
    type: 'enum', options: ['bank', 'unlimited'], default: 'bank', section: 'Grundbesitz',
    label: 'Gebäudelimit',
    optionLabels: { bank: 'Bankbestand 32 / 12', unlimited: 'Unbegrenzt' },
    help: 'Original: Die Bank hat nur 32 Häuser und 12 Hotels. Sind sie verbaut, kann niemand bauen.',
  },
  jailBail: {
    type: 'int', min: 50, max: 200, step: 10, default: 50, section: 'Gefängnis',
    label: 'Kaution', unit: '€',
    help: 'Betrag, um sich aus dem Gefängnis freizukaufen. Original: 50 €.',
  },
  maxJailTurns: {
    type: 'int', min: 1, max: 3, step: 1, default: 3, section: 'Gefängnis',
    label: 'Max. Gefängnisrunden',
    help: 'Nach so vielen erfolglosen Pasch-Versuchen muss man die Kaution zahlen und zieht weiter.',
  },
  turnTimer: {
    type: 'enum', options: [0, 30, 60, 90, 120], default: 0, section: 'Ablauf',
    label: 'Zug-Timer', unit: 's',
    optionLabels: { 0: 'Aus', 30: '30 s', 60: '60 s', 90: '90 s', 120: '120 s' },
    help: 'Zeit pro Entscheidung. Läuft sie ab, macht die KI einen sinnvollen Zug für den Spieler.',
  },
  trading: {
    type: 'bool', default: true, section: 'Ablauf',
    label: 'Handel erlaubt',
    help: 'Spieler dürfen Straßen, Geld und Freikarten untereinander handeln.',
  },
  noTradeRounds: {
    type: 'int', min: 0, max: 20, step: 1, default: 0, section: 'Ablauf',
    label: 'Kein Handel in den ersten Runden', unit: 'Runden', dependsOn: { trading: true },
    help: 'Handel ist erst ab der angegebenen Runde möglich. 0 = sofort.',
  },
  winCondition: {
    type: 'enum', options: ['lastStanding', 'rounds', 'time'], default: 'lastStanding', section: 'Ablauf',
    label: 'Siegbedingung',
    optionLabels: { lastStanding: 'Letzter Überlebender', rounds: 'Rundenlimit', time: 'Zeitlimit' },
    help: 'Bei Runden- oder Zeitlimit gewinnt am Ende das höchste Gesamtvermögen (Bargeld + Grundbesitz + Gebäude).',
  },
  roundLimit: {
    type: 'int', min: 5, max: 200, step: 1, default: 30, section: 'Ablauf',
    label: 'Rundenlimit', unit: 'Runden', dependsOn: { winCondition: 'rounds' },
    help: 'Nach dieser Runde endet das Spiel.',
  },
  timeLimit: {
    type: 'int', min: 10, max: 300, step: 5, default: 60, section: 'Ablauf',
    label: 'Zeitlimit', unit: 'Minuten', dependsOn: { winCondition: 'time' },
    help: 'Nach Ablauf wird die laufende Runde zu Ende gespielt, dann endet das Spiel.',
  },
  botHandicap: {
    type: 'int', min: 0, max: 1000, step: 50, default: 0, section: 'Fairness',
    label: 'Bot-Handicap', unit: '€',
    help: 'KI-Gegner starten mit so viel weniger Geld.',
  },
  playerBonus: {
    type: 'map', min: 0, max: 2000, step: 50, default: {}, section: 'Fairness',
    label: 'Startbonus für einzelne Spieler', unit: '€',
    help: 'Zusätzliches Startgeld für Neulinge. Der Host stellt es pro Spieler in der Spielerliste ein.',
  },
};

/** Unveränderliche Konstanten (keine Hausregeln, aber zentral definiert) */
export const FIXED = Object.freeze({
  bankHouses: 32,
  bankHotels: 12,
  doublesToJail: 3,          // dreimal Pasch hintereinander = Gefängnis
  housesPerHotel: 4,         // ein Hotel ersetzt 4 Häuser
  buildingSellRatio: 0.5,    // Gebäude-Rückverkauf zum halben Preis
  auctionStartMs: 12000,     // Startdauer einer Versteigerung
  auctionResetMs: 8000,      // Countdown nach jedem Gebot
  auctionMinBid: 1,
  absenceTakeoverMs: 120000, // nach 2 Minuten Abwesenheit übernimmt die KI
  minStartMoney: 100,       // Untergrenze nach Bot-Handicap
  minPlayers: 2,
  maxPlayers: 6,
  diceSides: 6,
});

export const DEFAULT_RULES = Object.freeze(
  Object.fromEntries(Object.entries(RULE_DEFS).map(([k, d]) => [k, d.default])),
);

export const PRESETS = {
  classic: {
    name: 'Klassisch',
    description: 'Die Originalregeln.',
    rules: { ...DEFAULT_RULES },
  },
  fast: {
    name: 'Schnelles Spiel',
    description: 'Weniger Startgeld, 60-s-Zug-Timer, Ende nach 20 Runden.',
    rules: { ...DEFAULT_RULES, startMoney: 1000, turnTimer: 60, winCondition: 'rounds', roundLimit: 20 },
  },
  party: {
    name: 'Party-Modus',
    description: 'Frei-Parken-Jackpot, doppeltes LOS-Gehalt, keine Versteigerungen.',
    rules: { ...DEFAULT_RULES, freeParking: 'jackpot', doubleGoOnLand: true, auctions: false },
  },
};

/**
 * Prüft eine (Teil-)Konfiguration.
 * @param {object} input            vom Client gesendete Regeln
 * @param {object} [opts]
 * @param {string[]} [opts.playerIds] erlaubte Spieler-IDs für playerBonus
 * @returns {{ ok: boolean, rules: object, errors: string[] }} rules = vollständige,
 *          bereinigte Konfiguration (ungültige Werte fallen auf den Standard zurück)
 */
export function validateRules(input, opts = {}) {
  const errors = [];
  const rules = {};
  const src = input && typeof input === 'object' ? input : {};

  for (const [key, def] of Object.entries(RULE_DEFS)) {
    const has = Object.prototype.hasOwnProperty.call(src, key);
    const v = has ? src[key] : def.default;
    switch (def.type) {
      case 'int': {
        if (!Number.isInteger(v) || v < def.min || v > def.max) {
          errors.push(`${def.label}: ${def.min}–${def.max} erwartet`);
          rules[key] = def.default;
        } else rules[key] = v;
        break;
      }
      case 'bool': {
        if (typeof v !== 'boolean') {
          errors.push(`${def.label}: ja/nein erwartet`);
          rules[key] = def.default;
        } else rules[key] = v;
        break;
      }
      case 'enum': {
        if (!def.options.includes(v)) {
          errors.push(`${def.label}: ungültiger Wert`);
          rules[key] = def.default;
        } else rules[key] = v;
        break;
      }
      case 'map': {
        const out = {};
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          for (const [pid, amount] of Object.entries(v)) {
            if (opts.playerIds && !opts.playerIds.includes(pid)) continue; // Spieler nicht (mehr) im Raum
            if (!Number.isInteger(amount) || amount < def.min || amount > def.max) {
              errors.push(`${def.label}: ${def.min}–${def.max} erwartet`);
              continue;
            }
            if (amount > 0) out[pid] = amount;
          }
        } else if (has) errors.push(`${def.label}: ungültiger Wert`);
        rules[key] = out;
        break;
      }
      default:
        rules[key] = def.default;
    }
  }
  return { ok: errors.length === 0, rules, errors };
}

/** Vollständige Regeln für die Spiellogik: Hausregeln + feste Konstanten */
export function resolveRules(rules) {
  const { rules: valid } = validateRules(rules);
  return Object.freeze({ ...FIXED, ...valid });
}

/** Ist eine Regel in der aktuellen Konfiguration relevant (dependsOn erfüllt)? */
export function isRuleActive(key, rules) {
  const dep = RULE_DEFS[key]?.dependsOn;
  if (!dep) return true;
  return Object.entries(dep).every(([k, v]) => rules[k] === v);
}

/** Lesbarer Wert einer Regel, z. B. für die Regel-Übersicht */
export function formatRuleValue(key, value) {
  const def = RULE_DEFS[key];
  if (!def) return String(value);
  if (def.type === 'bool') return value ? 'An' : 'Aus';
  if (def.optionLabels && def.optionLabels[value] !== undefined) return def.optionLabels[value];
  if (def.type === 'map') {
    const n = Object.keys(value || {}).length;
    return n ? `${n} Spieler` : 'Keiner';
  }
  return def.unit ? `${value} ${def.unit}` : String(value);
}

/** Regel-Übersicht: Liste mit Label, Wert, Hilfetext und ob vom Original abweichend */
export function describeRules(rules) {
  return Object.entries(RULE_DEFS)
    .filter(([key]) => isRuleActive(key, rules))
    .map(([key, def]) => ({
      key,
      section: def.section,
      label: def.label,
      value: formatRuleValue(key, rules[key]),
      help: def.help,
      changed: JSON.stringify(rules[key]) !== JSON.stringify(def.default),
    }));
}

/** Welches Preset entspricht der Konfiguration (oder null)? */
export function matchPreset(rules) {
  // Startboni pro Spieler gehören nicht zum Preset
  const keys = Object.keys(RULE_DEFS).filter((k) => RULE_DEFS[k].type !== 'map');
  const cmp = (a) => keys.every((k) => JSON.stringify(a[k]) === JSON.stringify(rules[k]));
  for (const [id, p] of Object.entries(PRESETS)) if (cmp(p.rules)) return id;
  return null;
}
