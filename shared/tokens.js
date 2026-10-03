/**
 * Spielfiguren. Jede Figur hat eine feste Farbe (Farbe folgt der Figur, nicht
 * dem Platz in der Rangliste), damit Spieler in Brett, Spielerleiste und
 * Diagrammen immer gleich aussehen.
 *
 * Die Farben stammen aus einer farbfehlsichtigkeits-geprüften Palette in fester
 * Reihenfolge, je eine Variante für helles und dunkles Theme.
 */
export const TOKENS = [
  { id: 'hat',         name: 'Zylinderhut', color: '#2a78d6', colorDark: '#3987e5' },
  { id: 'car',         name: 'Auto',        color: '#eb6834', colorDark: '#d95926' },
  { id: 'ship',        name: 'Schiff',      color: '#1baf7a', colorDark: '#199e70' },
  { id: 'dog',         name: 'Hund',        color: '#eda100', colorDark: '#c98500' },
  { id: 'shoe',        name: 'Schuh',       color: '#e87ba4', colorDark: '#d55181' },
  { id: 'thimble',     name: 'Fingerhut',   color: '#008300', colorDark: '#008300' },
  { id: 'iron',        name: 'Bügeleisen',  color: '#4a3aa7', colorDark: '#9085e9' },
  { id: 'wheelbarrow', name: 'Schubkarre',  color: '#e34948', colorDark: '#e66767' },
];

export const TOKEN_IDS = TOKENS.map((t) => t.id);
export const getToken = (id) => TOKENS.find((t) => t.id === id);
