/**
 * Ereignis- und Gemeinschaftskarten im Stil der klassischen Ausgabe.
 *
 * Jede Karte hat eine stabile id, einen Text und eine Aktion. Die Spiellogik
 * (server/game/Game.js) interpretiert die Aktion. Beträge stehen hier als Daten,
 * damit die Logik keine festen Zahlen enthält.
 *
 * Aktionen:
 *   advance        { to, collectGo }          zu Feld vorrücken
 *   advanceNearest { target, rentMultiplier?, diceMultiplier? }
 *   back           { steps }                  Felder zurückgehen
 *   money          { amount }                 + erhalten / − an die Bank zahlen
 *   eachPlayer     { amount }                 + jeder zahlt dir / − du zahlst jedem
 *   repairs        { house, hotel }           pro Haus / Hotel an die Bank
 *   jailFree       {}                         Gefängnis-Freikarte (wird behalten)
 *   gotoJail       {}
 */

export const CHANCE = [
  { id: 'c1', text: 'Rücke vor bis auf LOS.', action: { kind: 'advance', to: 0, collectGo: true } },
  { id: 'c2', text: 'Rücke vor bis zur Schlossallee.', action: { kind: 'advance', to: 39, collectGo: true } },
  { id: 'c3', text: 'Rücke vor bis zum Opernplatz. Wenn du über LOS kommst, ziehe das Gehalt ein.', action: { kind: 'advance', to: 24, collectGo: true } },
  { id: 'c4', text: 'Rücke vor bis zur Seestraße. Wenn du über LOS kommst, ziehe das Gehalt ein.', action: { kind: 'advance', to: 11, collectGo: true } },
  { id: 'c5', text: 'Rücke vor bis zum nächsten Bahnhof. Gehört er einem Mitspieler, zahle ihm das Doppelte der Miete.', action: { kind: 'advanceNearest', target: 'railroad', rentMultiplier: 2 } },
  { id: 'c6', text: 'Rücke vor bis zum nächsten Bahnhof. Gehört er einem Mitspieler, zahle ihm das Doppelte der Miete.', action: { kind: 'advanceNearest', target: 'railroad', rentMultiplier: 2 } },
  { id: 'c7', text: 'Rücke vor bis zum nächsten Werk. Gehört es einem Mitspieler, würfle und zahle das Zehnfache der Augenzahl.', action: { kind: 'advanceNearest', target: 'utility', diceMultiplier: 10 } },
  { id: 'c8', text: 'Mache einen Ausflug zum Südbahnhof. Wenn du über LOS kommst, ziehe das Gehalt ein.', action: { kind: 'advance', to: 5, collectGo: true } },
  { id: 'c9', text: 'Die Bank zahlt dir eine Dividende von 50 €.', action: { kind: 'money', amount: 50 } },
  { id: 'c10', text: 'Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie brauchst oder verkaufst.', action: { kind: 'jailFree' } },
  { id: 'c11', text: 'Gehe 3 Felder zurück.', action: { kind: 'back', steps: 3 } },
  { id: 'c12', text: 'Gehe in das Gefängnis! Begib dich direkt dorthin. Gehe nicht über LOS. Ziehe kein Gehalt ein.', action: { kind: 'gotoJail' } },
  { id: 'c13', text: 'Lass alle deine Häuser renovieren! Zahle an die Bank für jedes Haus 25 € und für jedes Hotel 100 €.', action: { kind: 'repairs', house: 25, hotel: 100 } },
  { id: 'c14', text: 'Strafzettel wegen zu schnellen Fahrens: Zahle 15 €.', action: { kind: 'money', amount: -15 } },
  { id: 'c15', text: 'Du wurdest zum Vorstand gewählt. Zahle jedem Spieler 50 €.', action: { kind: 'eachPlayer', amount: -50 } },
  { id: 'c16', text: 'Dein Bausparvertrag wird fällig. Ziehe 150 € ein.', action: { kind: 'money', amount: 150 } },
];

export const COMMUNITY = [
  { id: 'g1', text: 'Rücke vor bis auf LOS.', action: { kind: 'advance', to: 0, collectGo: true } },
  { id: 'g2', text: 'Bankirrtum zu deinen Gunsten. Ziehe 200 € ein.', action: { kind: 'money', amount: 200 } },
  { id: 'g3', text: 'Arztkosten. Zahle 50 €.', action: { kind: 'money', amount: -50 } },
  { id: 'g4', text: 'Aus Lagerverkäufen erhältst du 50 €.', action: { kind: 'money', amount: 50 } },
  { id: 'g5', text: 'Du kommst aus dem Gefängnis frei. Behalte diese Karte, bis du sie brauchst oder verkaufst.', action: { kind: 'jailFree' } },
  { id: 'g6', text: 'Gehe in das Gefängnis! Begib dich direkt dorthin. Gehe nicht über LOS. Ziehe kein Gehalt ein.', action: { kind: 'gotoJail' } },
  { id: 'g7', text: 'Urlaubsgeld! Du erhältst 100 €.', action: { kind: 'money', amount: 100 } },
  { id: 'g8', text: 'Einkommensteuer-Rückerstattung. Ziehe 20 € ein.', action: { kind: 'money', amount: 20 } },
  { id: 'g9', text: 'Du hast Geburtstag! Jeder Spieler schenkt dir 10 €.', action: { kind: 'eachPlayer', amount: 10 } },
  { id: 'g10', text: 'Deine Lebensversicherung wird fällig. Ziehe 100 € ein.', action: { kind: 'money', amount: 100 } },
  { id: 'g11', text: 'Krankenhausgebühren. Zahle 100 €.', action: { kind: 'money', amount: -100 } },
  { id: 'g12', text: 'Schulgeld. Zahle 50 €.', action: { kind: 'money', amount: -50 } },
  { id: 'g13', text: 'Beratungshonorar. Ziehe 25 € ein.', action: { kind: 'money', amount: 25 } },
  { id: 'g14', text: 'Du wirst zu Straßenausbesserungsarbeiten herangezogen. Zahle 40 € je Haus und 115 € je Hotel.', action: { kind: 'repairs', house: 40, hotel: 115 } },
  { id: 'g15', text: 'Zweiter Preis im Schönheitswettbewerb! Ziehe 10 € ein.', action: { kind: 'money', amount: 10 } },
  { id: 'g16', text: 'Du erbst 100 €.', action: { kind: 'money', amount: 100 } },
];

export const DECKS = {
  chance: { name: 'Ereigniskarte', cards: CHANCE },
  community: { name: 'Gemeinschaftskarte', cards: COMMUNITY },
};

const ALL = new Map([...CHANCE, ...COMMUNITY].map((c) => [c.id, c]));
export const getCard = (id) => ALL.get(id);
export const deckOfCard = (id) => (id.startsWith('c') ? 'chance' : 'community');
