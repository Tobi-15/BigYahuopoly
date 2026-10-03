/**
 * Spielbrett-Rendering (DOM + CSS-Grid, Größen über Container-Query-Einheiten).
 *
 * - Felder mit Farbband, Namen, Preis, Besitzer-Markierung, Häusern/Hotels,
 *   Hypotheken-Stempel und optionaler Heatmap-Ebene
 * - Spielfiguren in einer eigenen Ebene, die Feld für Feld hüpfen
 * - Mitte: Logo, Kartenstapel, 3D-Würfel, Statuszeile, gezogene Karte
 */
import { BOARD, GROUPS, POS, HOTEL_LEVEL } from '/shared/board.js';
import { el, eur, sleep, inkOn, hyphenate } from './util.js';
import { FIELD_ICONS, TOKEN_ICONS } from './icons.js';
import { sfx } from './sound.js';

const U = 12.2; // Brettbreite in Feld-Einheiten (2 Ecken à 1,6 + 9 Felder)

/** Grid-Position (1-basiert) eines Feldes */
export function gridPos(i) {
  if (i <= 10) return { col: 11 - i, row: 11 };
  if (i < 20) return { col: 1, row: 21 - i };
  if (i <= 30) return { col: i - 19, row: 1 };
  return { col: 11, row: i - 29 };
}

export function sideOf(i) {
  if (i % 10 === 0) return 'corner';
  if (i < 10) return 'bottom';
  if (i < 20) return 'left';
  if (i < 30) return 'top';
  return 'right';
}

/** Mittelpunkt einer Spalte/Zeile in Feld-Einheiten */
const lineCenter = (k) => (k === 1 ? 0.8 : k === 11 ? 11.4 : 1.6 + (k - 2) + 0.5);

/** Deed-Karte (Besitzurkunde) als DOM-Knoten – für Tooltip, Kaufdialog, Detailansicht */
export function deedCard(idx, state, rules, players = state?.players || []) {
  const f = BOARD[idx];
  const prop = state?.props?.[idx];
  const owner = prop?.owner ? players.find((p) => p.id === prop.owner) : null;
  const group = f.group ? GROUPS[f.group] : null;
  const headColor = f.type === 'street' ? group.color : f.type === 'railroad' ? '#3a3a3a' : f.type === 'utility' ? '#8a8f98' : '#5b6770';
  const head = el('div', { class: `deed-head ${inkOn(headColor) === 'light' ? 'light' : ''}`, style: { background: headColor } },
    el('small', { text: f.type === 'street' ? 'Besitzrechtkarte' : f.type === 'railroad' ? 'Bahnhof' : f.type === 'utility' ? 'Versorgungswerk' : 'Feld' }),
    el('strong', { text: f.name }));
  const body = el('div', { class: 'deed-body' });
  const rows = [];
  const cur = prop?.houses ?? 0;
  if (f.type === 'street') {
    const groupOwned = owner && state.props && Object.entries(state.props).filter(([i]) => BOARD[i].group === f.group).every(([, p]) => p.owner === owner.id);
    rows.push(['Miete', eur(f.rent[0]), cur === 0 && !groupOwned]);
    if (rules?.monopolyDoubleRent !== false) rows.push(['mit Farbgruppe', eur(f.rent[0] * 2), cur === 0 && groupOwned]);
    for (let h = 1; h <= 4; h++) rows.push([`mit ${h} ${h === 1 ? 'Haus' : 'Häusern'}`, eur(f.rent[h]), cur === h]);
    rows.push(['mit Hotel', eur(f.rent[5]), cur === HOTEL_LEVEL]);
  } else if (f.type === 'railroad') {
    f.rent.forEach((r, k) => rows.push([`${k + 1} Bahnh${k ? 'öfe' : 'of'}`, eur(r), false]));
  } else if (f.type === 'utility') {
    rows.push(['1 Werk', `${f.rent[0]}× Augen`, false], ['2 Werke', `${f.rent[1]}× Augen`, false]);
  } else if (f.type === 'tax') {
    body.append(el('p', { text: `Zahle ${eur(f.amount)} an die Bank.` }));
  } else {
    body.append(el('p', { text: fieldDescription(f, rules, state) }));
  }
  if (rows.length) {
    body.append(el('table', { class: 'deed-table' }, el('tbody', {}, rows.map(([a, b, c]) => el('tr', { class: c && owner ? 'cur' : '' }, el('td', { text: a }), el('td', { text: b }))))));
    const foot = el('div', { class: 'deed-foot' },
      el('div', { text: `Kaufpreis ${eur(f.price)} · Hypothek ${eur(f.mortgage)}` }),
      f.housePrice ? el('div', { text: `Haus/Hotel je ${eur(f.housePrice)}` }) : null);
    body.append(foot);
    if (owner) {
      body.append(el('div', { class: 'deed-owner' },
        el('span', { class: 'avatar sm', dataset: { token: owner.token }, svg: TOKEN_ICONS[owner.token] }),
        `Besitzer: ${owner.name}${prop.mortgaged ? ' (Hypothek)' : ''}`));
    } else if (state) {
      body.append(el('div', { class: 'deed-owner muted', text: 'Gehört der Bank' }));
    }
  }
  return el('div', {}, head, body);
}

function fieldDescription(f, rules, state) {
  switch (f.type) {
    case 'go': return `Beim Überqueren gibt es ${eur(rules?.goSalary ?? 200)}${rules?.doubleGoOnLand ? ', genau darauf das Doppelte' : ''}.`;
    case 'jail': return `Nur zu Besuch – oder im Gefängnis. Kaution ${eur(rules?.jailBail ?? 50)}.`;
    case 'parking': return rules?.freeParking === 'jackpot' ? `Jackpot: ${eur(state?.pot ?? 0)} warten hier.` : 'Hier passiert nichts.';
    case 'gotojail': return 'Gehe direkt ins Gefängnis, ohne über LOS zu gehen.';
    case 'chance': return 'Ziehe eine Ereigniskarte.';
    case 'community': return 'Ziehe eine Gemeinschaftskarte.';
    default: return '';
  }
}

/* ====================================================================== */

export class Board {
  constructor(root) {
    this.root = root;
    this.fields = [];
    this.tokenEls = new Map();
    this.display = {}; // pid → { pos, inJail } (angezeigte Position)
    this.order = [];
    this.heatOn = false;
    this.build();
    this.resizeObs = new ResizeObserver(() => this.layoutTokens(false));
    this.resizeObs.observe(root);
  }

  build() {
    const root = this.root;
    root.replaceChildren();
    for (const f of BOARD) {
      const { col, row } = gridPos(f.index);
      const side = sideOf(f.index);
      const node = el('div', {
        class: `field side-${side} ${side === 'corner' ? 'corner' : ''} t-${f.type}`,
        style: { gridColumn: String(col), gridRow: String(row) },
        dataset: { idx: f.index },
        tabindex: 0,
        role: 'button',
        'aria-label': f.name,
      });
      node.append(this.fieldContent(f));
      root.append(node);
      this.fields[f.index] = node;
    }
    // Mitte
    this.center = el('div', { class: 'board-center' },
      el('div', { class: 'deck deck-chance' }, el('span', {}, el('span', { class: 'q', text: '?' }), 'Ereignis')),
      el('div', { class: 'deck deck-community' }, el('span', {}, el('span', { class: 'q', svg: '' }), 'Gemeinschaft')),
      el('div', { class: 'center-logo', text: 'MONOPOLY' }));
    this.diceTray = el('div', { class: 'dice-tray' });
    this.diceTotal = el('div', { class: 'dice-total' });
    this.status = el('div', { class: 'center-status' });
    this.center.append(this.diceTray, this.diceTotal, this.status);
    root.append(this.center);
    this.dice = [new Die(), new Die()];
    this.diceTray.append(this.dice[0].node, this.dice[1].node);
    // Figuren-Ebene
    this.tokenLayer = el('div', { class: 'tokens' });
    root.append(this.tokenLayer);
  }

  fieldContent(f) {
    const inner = el('div', { class: 'inner' });
    if (f.type === 'street') {
      inner.append(
        el('div', { class: 'band', style: { background: GROUPS[f.group].color } }),
        el('div', { class: 'fname', text: hyphenate(f.name) }),
        el('div', { class: 'ficon' }),
        el('div', { class: 'fprice', text: eur(f.price) }));
    } else if (f.type === 'railroad' || f.type === 'utility') {
      inner.append(
        el('div', { class: 'fname', text: hyphenate(f.name) }),
        el('div', { class: 'ficon', svg: FIELD_ICONS[f.type === 'railroad' ? 'railroad' : f.icon] }),
        el('div', { class: 'fprice', text: eur(f.price) }));
    } else if (f.type === 'tax') {
      inner.append(
        el('div', { class: 'fname', text: hyphenate(f.name) }),
        el('div', { class: 'ficon', svg: f.amount > 150 ? FIELD_ICONS.tax : FIELD_ICONS.luxury }),
        el('div', { class: 'fprice', text: `Zahle ${eur(f.amount)}` }));
    } else if (f.type === 'chance' || f.type === 'community') {
      inner.append(
        el('div', { class: 'fname', text: f.type === 'chance' ? 'Ereignis' : hyphenate('Gemeinschaft') }),
        el('div', { class: 'ficon', svg: FIELD_ICONS[f.type] }));
    } else if (f.type === 'go') {
      inner.append(el('div', { class: 'csub', text: 'Ziehe Gehalt ein' }), el('div', { class: 'ctitle', text: 'LOS' }), el('div', { svg: FIELD_ICONS.go, style: { width: '60%' } }));
      return el('div', { class: 'corner-go' }, inner);
    } else if (f.type === 'jail') {
      const cell = el('div', { class: 'jail-cell', svg: FIELD_ICONS.jail });
      const wrap = el('div', { class: 'corner-jail' }, cell, el('div', { class: 'visit', text: 'Nur zu' }), el('div', { class: 'visit2', text: 'Besuch' }));
      return wrap;
    } else if (f.type === 'parking') {
      this.potEl = el('div', { class: 'pot', hidden: true });
      inner.append(el('div', { class: 'ctitle', text: 'Frei' }), el('div', { svg: FIELD_ICONS.parking }), el('div', { class: 'ctitle', text: 'Parken' }), this.potEl);
      return el('div', { class: 'corner-parking' }, inner);
    } else if (f.type === 'gotojail') {
      inner.append(el('div', { class: 'csub', text: 'Gehe in das' }), el('div', { svg: FIELD_ICONS.gotojail }), el('div', { class: 'ctitle', text: 'Gefängnis' }));
    }
    return inner;
  }

  /** Besitz, Gebäude, Hypotheken, Jackpot darstellen */
  render(state) {
    for (const [idxStr, prop] of Object.entries(state.props)) {
      const idx = Number(idxStr);
      const node = this.fields[idx];
      const owner = prop.owner ? state.players.find((p) => p.id === prop.owner) : null;
      const key = `${prop.owner}|${prop.houses}|${prop.mortgaged}`;
      if (node.dataset.key === key) continue;
      node.dataset.key = key;
      const inner = node.querySelector('.inner');
      node.classList.toggle('owned', Boolean(owner));
      node.classList.toggle('mortgaged', prop.mortgaged);
      inner.querySelector('.owner-tag')?.remove();
      if (owner) inner.append(el('div', { class: 'owner-tag', dataset: { token: owner.token } }));
      inner.querySelector('.stamp')?.remove();
      if (prop.mortgaged) inner.append(el('div', { class: 'stamp', text: 'Hypothek' }));
      const band = inner.querySelector('.band');
      if (band) {
        const have = band.childElementCount;
        const want = prop.houses === HOTEL_LEVEL ? -1 : prop.houses;
        if ((want === -1 && !band.querySelector('.hotel')) || (want >= 0 && (have !== want || band.querySelector('.hotel')))) {
          band.replaceChildren(...(want === -1 ? [el('div', { class: 'hotel' })] : Array.from({ length: want }, () => el('div', { class: 'house' }))));
        }
      }
    }
    if (this.potEl) {
      const jackpot = state.rules?.freeParking === 'jackpot';
      this.potEl.hidden = !jackpot;
      this.potEl.textContent = eur(state.pot);
    }
  }

  flash(idx, token) {
    const node = this.fields[idx];
    if (!node) return;
    if (token) node.dataset.token = token;
    node.classList.remove('flash');
    void node.offsetWidth;
    node.classList.add('flash');
  }

  /* --- Figuren ------------------------------------------------------- */

  /** Figuren an die Spieler des Zustands anpassen (ohne Animation) */
  syncTokens(state, { animate = false } = {}) {
    this.order = state.players.map((p) => p.id);
    for (const p of state.players) {
      let node = this.tokenEls.get(p.id);
      if (!node) {
        node = el('div', { class: 'token', dataset: { token: p.token, pid: p.id } }, el('div', { class: 'tbody', svg: TOKEN_ICONS[p.token] }));
        node.title = p.name;
        this.tokenLayer.append(node);
        this.tokenEls.set(p.id, node);
      }
      node.classList.toggle('bankrupt', p.bankrupt);
      node.classList.toggle('active', p.id === state.currentPid && state.phase !== 'over');
      this.display[p.id] = { pos: p.position, inJail: p.inJail };
    }
    for (const [pid, node] of this.tokenEls) {
      if (!this.order.includes(pid)) { node.remove(); this.tokenEls.delete(pid); }
    }
    this.layoutTokens(animate);
  }

  setActive(pid) {
    for (const [id, node] of this.tokenEls) node.classList.toggle('active', id === pid);
  }

  /** Pixel-Koordinaten (Mittelpunkt) für eine Figur */
  tokenXY(pid, pos, inJail, slot = 0, count = 1) {
    const size = this.root.clientWidth;
    const k = size / U;
    const { col, row } = gridPos(pos);
    let x = lineCenter(col);
    let y = lineCenter(row);
    const side = sideOf(pos);
    if (pos === POS.JAIL) {
      if (inJail) {
        const spots = [[1.07, 11.13], [0.86, 10.92], [1.28, 10.92], [0.86, 11.34], [1.28, 11.34], [1.07, 10.8]];
        [x, y] = spots[slot % spots.length];
      } else {
        const spots = [[0.27, 11.1], [0.65, 11.93], [0.27, 10.75], [1.05, 11.93], [0.27, 11.55], [1.42, 11.93]];
        [x, y] = spots[slot % spots.length];
      }
      return { x: x * k, y: y * k };
    }
    const layouts = {
      1: [[0, 0.22]],
      2: [[-0.2, 0.22], [0.2, 0.22]],
      3: [[-0.2, 0.05], [0.2, 0.05], [0, 0.45]],
      4: [[-0.2, 0.05], [0.2, 0.05], [-0.2, 0.45], [0.2, 0.45]],
      5: [[-0.2, -0.1], [0.2, -0.1], [-0.2, 0.25], [0.2, 0.25], [0, 0.58]],
      6: [[-0.2, -0.1], [0.2, -0.1], [-0.2, 0.25], [0.2, 0.25], [-0.2, 0.58], [0.2, 0.58]],
    };
    const [a, p] = layouts[Math.min(6, Math.max(1, count))][slot] || [0, 0];
    if (side === 'corner') { x += a * 1.4; y += (p - 0.2) * 1.2; }
    else if (side === 'bottom') { x -= a; y += p; }
    else if (side === 'left') { x -= p; y -= a; }
    else if (side === 'top') { x += a; y -= p; }
    else { x += p; y += a; }
    return { x: x * k, y: y * k };
  }

  /** Alle Figuren gemäß angezeigter Position anordnen (mehrere pro Feld) */
  layoutTokens(animate = true) {
    const groups = {};
    for (const pid of this.order) {
      const d = this.display[pid];
      if (!d) continue;
      const key = d.pos === POS.JAIL ? `j${d.inJail ? 1 : 0}` : String(d.pos);
      (groups[key] ||= []).push(pid);
    }
    for (const pids of Object.values(groups)) {
      pids.forEach((pid, slot) => {
        const node = this.tokenEls.get(pid);
        if (!node || node._moving) return;
        const d = this.display[pid];
        const { x, y } = this.tokenXY(pid, d.pos, d.inJail, slot, pids.length);
        const to = `translate(${x}px, ${y}px)`;
        if (animate && node.style.transform && node.style.transform !== to) {
          node.animate([{ transform: node.style.transform }, { transform: to }], { duration: 220, easing: 'ease-out' });
        }
        node.style.transform = to;
      });
    }
  }

  /**
   * Figur animiert bewegen.
   * @param {number} steps  positive Zahl vorwärts, negative rückwärts; direct = gleiten (Gefängnis)
   */
  async moveToken(pid, from, to, steps, { direct = false, inJail = false, fast = false } = {}) {
    const node = this.tokenEls.get(pid);
    if (!node) return;
    node._moving = true;
    node.style.zIndex = '5';
    const body = node.querySelector('.tbody');
    const hop = (x, y, dur) => {
      const target = `translate(${x}px, ${y}px)`;
      const a = node.animate([{ transform: node.style.transform || target }, { transform: target }], { duration: dur, easing: 'ease-in-out' });
      body.animate([{ transform: 'none' }, { transform: 'translateY(-45%) scale(1.18)', offset: 0.45 }, { transform: 'none' }], { duration: dur, easing: 'ease-out' });
      node.style.transform = target;
      return a.finished.catch(() => {});
    };
    if (fast) {
      // Im Hintergrund-Tab laufen keine Animationen: direkt ans Ziel
      const { x, y } = this.tokenXY(pid, to, inJail, 0, 1);
      node.style.transform = `translate(${x}px, ${y}px)`;
    } else if (direct || steps === 0) {
      const { x, y } = this.tokenXY(pid, to, inJail, 0, 1);
      await hop(x, y, 650);
    } else {
      const n = Math.abs(steps);
      const dir = Math.sign(steps);
      const per = Math.max(75, Math.min(170, 2000 / n));
      let pos = from;
      for (let i = 0; i < n; i++) {
        pos = (pos + dir + 40) % 40;
        const { x, y } = this.tokenXY(pid, pos, false, 0, 1);
        sfx.step();
        await hop(x, y, per);
      }
    }
    node._moving = false;
    node.style.zIndex = '';
    this.display[pid] = { pos: to, inJail };
    this.layoutTokens(!fast);
  }

  /* --- Würfel und Mitte ------------------------------------------------ */

  async rollDice(dice, fast = false) {
    this.diceTotal.textContent = '';
    if (!fast) sfx.dice();
    await Promise.all(this.dice.map((d, i) => d.roll(dice[i], fast)));
    this.diceTotal.textContent = `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}${dice[0] === dice[1] ? ' · Pasch!' : ''}`;
    this.diceTotal.classList.remove('pop');
    void this.diceTotal.offsetWidth;
    this.diceTotal.classList.add('pop');
  }

  setDice(dice) {
    if (!dice) return;
    this.dice.forEach((d, i) => d.set(dice[i]));
    this.diceTotal.textContent = `${dice[0]} + ${dice[1]} = ${dice[0] + dice[1]}`;
  }

  setStatus(nodes) {
    this.status.replaceChildren(...nodes);
  }

  /** Gezogene Karte groß anzeigen (Flip-Animation) */
  async showCard({ deck, text }, fast = false) {
    this.center.querySelector('.card-show')?.remove();
    const color = deck === 'chance' ? '#f08c1d' : '#2f7fc1';
    const title = deck === 'chance' ? 'Ereigniskarte' : 'Gemeinschaftskarte';
    const card = el('div', { class: 'card-show', style: { '--deck-c': color }, title: 'Klicken zum Schließen' },
      el('div', { class: 'flip' },
        el('div', { class: 'cface back', style: { background: color }, text: deck === 'chance' ? '?' : title }),
        el('div', { class: 'cface front' }, el('h4', { text: title }), el('p', { text }), el('small', { text: 'Klicken zum Schließen' }))));
    const remove = () => {
      if (!card.isConnected) return;
      card.classList.add('out');
      setTimeout(() => card.remove(), 350);
    };
    card.onclick = remove;
    this.center.append(card);
    if (!fast) sfx.card();
    setTimeout(remove, fast ? 2500 : 4200);
    await sleep(fast ? 100 : 1500);
  }

  /* --- Heatmap ----------------------------------------------------------- */

  setHeatmap(counts) {
    for (const n of this.fields) n.querySelector('.heat')?.remove();
    this.center.querySelector('.heat-legend')?.remove();
    this.heatOn = Boolean(counts);
    if (!counts) return;
    const max = Math.max(1, ...counts);
    counts.forEach((c, i) => {
      if (!c) return;
      const step = Math.max(1, Math.ceil((c / max) * 7));
      this.fields[i].append(el('div', { class: 'heat', style: { background: `color-mix(in srgb, var(--heat-${step}) 78%, transparent)` } }, el('span', { text: String(c) })));
    });
    this.center.append(el('div', { class: 'heat-legend' }, 'Landungen: selten', el('span', { class: 'ramp' }, [1, 2, 3, 4, 5, 6, 7].map((k) => el('i', { style: { background: `var(--heat-${k})` } }))), 'oft'));
  }
}

/* ====================================================================== */
/* 3D-Würfel                                                              */
/* ====================================================================== */

const PIPS = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };
const FACE_ROT = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };

class Die {
  constructor() {
    this.rx = -20;
    this.ry = 20;
    this.node = el('div', { class: 'die' });
    for (let f = 1; f <= 6; f++) {
      const face = el('div', { class: `face f${f}` });
      for (const p of PIPS[f]) {
        face.append(el('span', { class: 'pip', style: { gridRow: String(Math.ceil(p / 3)), gridColumn: String(((p - 1) % 3) + 1) } }));
      }
      this.node.append(face);
    }
    this.set(1 + Math.floor(Math.random() * 6));
  }

  angles(value, spins) {
    const [bx, by] = FACE_ROT[value];
    const tilt = [-14, 16];
    const nx = bx + tilt[0] + 360 * (Math.ceil((this.rx - bx) / 360) + spins);
    const ny = by + tilt[1] + 360 * (Math.ceil((this.ry - by) / 360) + spins);
    return [nx, ny];
  }

  set(value) {
    const [bx, by] = FACE_ROT[value];
    this.rx = bx - 14;
    this.ry = by + 16;
    this.node.style.transition = 'none';
    this.apply();
    void this.node.offsetWidth;
    this.node.style.transition = '';
  }

  apply() {
    this.node.style.setProperty('--rx', `${this.rx}deg`);
    this.node.style.setProperty('--ry', `${this.ry}deg`);
  }

  async roll(value, fast) {
    if (fast) return this.set(value);
    const [nx, ny] = this.angles(value, 2 + Math.floor(Math.random() * 2));
    this.rx = nx;
    this.ry = ny;
    this.node.classList.remove('rolling');
    void this.node.offsetWidth;
    this.node.classList.add('rolling');
    this.apply();
    await sleep(1050);
  }
}
