/**
 * Spielbrett: 40 Felder der klassischen deutschen Ausgabe (Euro-Werte).
 *
 * Dieses Modul ist reine Daten-Definition und wird von Server (Spiellogik) und
 * Browser (Darstellung, Tooltips) gemeinsam genutzt.
 *
 * Feldtypen:
 *   go | street | railroad | utility | tax | chance | community | jail | parking | gotojail
 *
 * Straßen: rent = [Grundmiete, 1 Haus, 2 Häuser, 3 Häuser, 4 Häuser, Hotel]
 * Bahnhöfe: rent = [1, 2, 3, 4 Bahnhöfe im Besitz]
 * Werke:    rent = [Faktor bei 1 Werk, Faktor bei 2 Werken] (× Augensumme)
 */

/** Farbgruppen mit Anzeige-Farbe und Hauspreis */
export const GROUPS = {
  brown:     { name: 'Lila',       color: '#8e4fa3', housePrice: 50 },
  lightblue: { name: 'Hellblau',   color: '#7fc6ea', housePrice: 50 },
  pink:      { name: 'Violett',    color: '#d6338a', housePrice: 100 },
  orange:    { name: 'Orange',     color: '#f08c1d', housePrice: 100 },
  red:       { name: 'Rot',        color: '#e0302b', housePrice: 150 },
  yellow:    { name: 'Gelb',       color: '#f5d10f', housePrice: 150 },
  green:     { name: 'Grün',       color: '#1f9d55', housePrice: 200 },
  darkblue:  { name: 'Dunkelblau', color: '#2449a8', housePrice: 200 },
  railroad:  { name: 'Bahnhöfe',   color: '#3a3a3a', housePrice: 0 },
  utility:   { name: 'Werke',      color: '#8a8f98', housePrice: 0 },
};

const street = (name, group, price, rent, mortgage) =>
  ({ type: 'street', name, group, price, rent, mortgage, housePrice: GROUPS[group].housePrice });
const railroad = (name) =>
  ({ type: 'railroad', name, group: 'railroad', price: 200, rent: [25, 50, 100, 200], mortgage: 100 });
const utility = (name, icon) =>
  ({ type: 'utility', name, group: 'utility', price: 150, rent: [4, 10], mortgage: 75, icon });

/** Die 40 Felder in Spielreihenfolge, beginnend bei LOS */
export const BOARD = [
  { type: 'go', name: 'LOS' },
  street('Badstraße', 'brown', 60, [2, 10, 30, 90, 160, 250], 30),
  { type: 'community', name: 'Gemeinschaftsfeld' },
  street('Turmstraße', 'brown', 60, [4, 20, 60, 180, 320, 450], 30),
  { type: 'tax', name: 'Einkommensteuer', amount: 200 },
  railroad('Südbahnhof'),
  street('Chausseestraße', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  { type: 'chance', name: 'Ereignisfeld' },
  street('Elisenstraße', 'lightblue', 100, [6, 30, 90, 270, 400, 550], 50),
  street('Poststraße', 'lightblue', 120, [8, 40, 100, 300, 450, 600], 60),
  { type: 'jail', name: 'Gefängnis' },
  street('Seestraße', 'pink', 140, [10, 50, 150, 450, 625, 750], 70),
  utility('Elektrizitätswerk', 'bulb'),
  street('Hafenstraße', 'pink', 140, [10, 50, 150, 450, 625, 750], 70),
  street('Neue Straße', 'pink', 160, [12, 60, 180, 500, 700, 900], 80),
  railroad('Westbahnhof'),
  street('Münchener Straße', 'orange', 180, [14, 70, 200, 550, 750, 950], 90),
  { type: 'community', name: 'Gemeinschaftsfeld' },
  street('Wiener Straße', 'orange', 180, [14, 70, 200, 550, 750, 950], 90),
  street('Berliner Straße', 'orange', 200, [16, 80, 220, 600, 800, 1000], 100),
  { type: 'parking', name: 'Frei Parken' },
  street('Theaterstraße', 'red', 220, [18, 90, 250, 700, 875, 1050], 110),
  { type: 'chance', name: 'Ereignisfeld' },
  street('Museumstraße', 'red', 220, [18, 90, 250, 700, 875, 1050], 110),
  street('Opernplatz', 'red', 240, [20, 100, 300, 750, 925, 1100], 120),
  railroad('Nordbahnhof'),
  street('Lessingstraße', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 130),
  street('Schillerstraße', 'yellow', 260, [22, 110, 330, 800, 975, 1150], 130),
  utility('Wasserwerk', 'drop'),
  street('Goethestraße', 'yellow', 280, [24, 120, 360, 850, 1025, 1200], 140),
  { type: 'gotojail', name: 'Gehe ins Gefängnis' },
  street('Rathausplatz', 'green', 300, [26, 130, 390, 900, 1100, 1275], 150),
  street('Hauptstraße', 'green', 300, [26, 130, 390, 900, 1100, 1275], 150),
  { type: 'community', name: 'Gemeinschaftsfeld' },
  street('Bahnhofstraße', 'green', 320, [28, 150, 450, 1000, 1200, 1400], 160),
  railroad('Hauptbahnhof'),
  { type: 'chance', name: 'Ereignisfeld' },
  street('Parkstraße', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500], 175),
  { type: 'tax', name: 'Zusatzsteuer', amount: 100 },
  street('Schlossallee', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000], 200),
].map((f, index) => Object.freeze({ index, ...f }));

/** Wichtige Positionen */
export const POS = Object.freeze({
  GO: 0,
  JAIL: BOARD.findIndex((f) => f.type === 'jail'),
  PARKING: BOARD.findIndex((f) => f.type === 'parking'),
  GOTO_JAIL: BOARD.findIndex((f) => f.type === 'gotojail'),
});

export const BOARD_SIZE = BOARD.length;

/** Anzahl Häuser, ab der ein Feld ein Hotel hat (Stufe 5 = Hotel) */
export const HOTEL_LEVEL = 5;

/** Alle kaufbaren Felder (Straßen, Bahnhöfe, Werke) */
export const PROPERTY_INDICES = BOARD.filter((f) => f.price).map((f) => f.index);

/** Feld-Indizes einer Gruppe */
export const GROUP_MEMBERS = Object.fromEntries(
  Object.keys(GROUPS).map((g) => [g, BOARD.filter((f) => f.group === g).map((f) => f.index)]),
);

export const isProperty = (i) => Boolean(BOARD[i] && BOARD[i].price);
export const isStreet = (i) => BOARD[i] && BOARD[i].type === 'street';
