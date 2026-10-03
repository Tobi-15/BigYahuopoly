/**
 * Monopoly-Spiellogik als server-autoritativer Zustandsautomat.
 *
 * - Der gesamte Spielzustand liegt als reines JSON-Objekt in `this.s`
 *   (serialisierbar für Snapshots/Reconnect).
 * - Clients schicken nur Aktionen: game.act(playerId, type, payload).
 *   Jede Aktion wird gegen Phase, Spieler und Regeln geprüft.
 * - Alle Zahlen kommen aus der Regel-Konfiguration (this.rules) bzw. den
 *   Brett- und Kartendaten, nicht aus dem Code.
 *
 * Phasen (s.phase):
 *   roll    aktiver Spieler muss würfeln
 *   jail    aktiver Spieler sitzt im Gefängnis: Kaution / Freikarte / Pasch würfeln
 *   buy     aktiver Spieler entscheidet: kaufen oder ablehnen (→ Versteigerung)
 *   auction Versteigerung läuft, alle Spieler dürfen bieten
 *   debt    ein Spieler schuldet Geld: Geld beschaffen und zahlen oder Bankrott
 *   end     aktiver Spieler kann verwalten/handeln und beendet den Zug
 *   over    Spiel vorbei
 *
 * Ablaufsteuerung: Spielschritte (Ziehen, Landen, Zugende, Versteigerung …)
 * stehen in der Warteschlange s.queue. proceed() arbeitet sie ab, bis eine
 * Entscheidung eines Spielers nötig ist (buy/auction/debt) oder die Schlange
 * leer ist. Dadurch lassen sich Kettenreaktionen (Karte → Bewegung → Miete →
 * Schulden → weiter im Zug) sauber und ohne Rekursion abbilden.
 */
import crypto from 'node:crypto';
import { BOARD, POS, BOARD_SIZE, HOTEL_LEVEL, PROPERTY_INDICES, GROUP_MEMBERS, GROUPS } from '../../shared/board.js';
import { DECKS, getCard, deckOfCard } from '../../shared/cards.js';
import { resolveRules } from '../../shared/rules.js';
import * as L from '../../shared/logic.js';
import { createStats, StatsCollector } from './stats.js';

export class GameError extends Error {}

const fail = (msg) => { throw new GameError(msg); };
export const eur = (n) => `${Number(n).toLocaleString('de-DE')} €`;
const isInt = (v) => Number.isInteger(v);

const cryptoRandom = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

/** Anzahl angezeigter Log-Zeilen im öffentlichen Zustand (vollständiges Log in der Statistik) */
const PUBLIC_LOG = 60;
/** Maximal gleichzeitig offene Handelsangebote pro Spieler (Spam-Schutz) */
const MAX_OPEN_TRADES = 5;

export class Game {
  /**
   * @param {object} [opts]
   * @param {() => number} [opts.rng]  Zufallszahl [0,1), standardmäßig kryptografisch
   * @param {() => number} [opts.now]  Uhr (für Tests ersetzbar)
   */
  constructor(opts = {}) {
    this.rng = opts.rng || cryptoRandom;
    this.now = opts.now || Date.now;
    /** Nur für Tests: vorgegebene Würfe [[a,b], …] */
    this.diceQueue = [];
    /** Ereignisse der letzten Aktion (für Animationen beim Client) */
    this.events = [];
    this.s = null;
    this.rules = null;
    this.stats = null;
  }

  /* ------------------------------------------------------------------ */
  /* Erzeugen / Laden                                                    */
  /* ------------------------------------------------------------------ */

  /**
   * Neues Spiel.
   * @param {object} o
   * @param {{id,name,token,isBot?,botLevel?}[]} o.players
   * @param {object} o.rules            Hausregeln (werden validiert)
   * @param {boolean} [o.shuffleOrder]  Reihenfolge auslosen (Standard: ja)
   */
  static create({ players, rules = {}, rng, now, shuffleOrder = true }) {
    const g = new Game({ rng, now });
    const R = resolveRules(rules);
    g.rules = R;
    if (players.length < R.minPlayers || players.length > R.maxPlayers) {
      fail(`Es werden ${R.minPlayers}–${R.maxPlayers} Spieler benötigt.`);
    }
    const order = players.slice();
    if (shuffleOrder) g.shuffle(order);

    const startMoney = (p) => {
      let m = R.startMoney + (R.playerBonus[p.id] || 0);
      if (p.isBot) m -= R.botHandicap;
      return Math.max(R.minStartMoney ?? 0, m);
    };

    g.s = {
      version: 1,
      rules: R,
      players: order.map((p) => ({
        id: p.id,
        name: p.name,
        token: p.token,
        isBot: Boolean(p.isBot),
        botLevel: p.botLevel || null,
        money: startMoney(p),
        position: POS.GO,
        inJail: false,
        jailTurns: 0,
        jailCards: [],
        bankrupt: false,
        online: true,
        away: false,
      })),
      props: Object.fromEntries(PROPERTY_INDICES.map((i) => [i, { owner: null, houses: 0, mortgaged: false }])),
      bank: { houses: R.bankHouses, hotels: R.bankHotels },
      current: 0,
      round: 1,
      turnNo: 1,
      phase: 'roll',
      phaseSeq: 1,
      turn: { pid: order[0].id, dice: null, doubles: 0, rollAgain: false },
      queue: [],
      debts: [],
      debtCounter: 0,
      debtShown: 0,
      auction: null,
      pendingBuy: null,
      trades: [],
      nextTradeId: 1,
      decks: {
        chance: g.shuffle(DECKS.chance.cards.map((c) => c.id)),
        community: g.shuffle(DECKS.community.cards.map((c) => c.id)),
      },
      pot: 0,
      lastCard: null,
      log: [],
      logSeq: 0,
      startedAt: g.now(),
      endedAt: null,
      deadline: null,
      deadlineSeq: 0,
      winner: null,
      endReason: null,
      bankruptOrder: [],
      ranking: null,
      stats: createStats(order),
    };
    g.stats = new StatsCollector(g.s.stats);
    g.log(`Das Spiel beginnt. Reihenfolge: ${g.s.players.map((p) => p.name).join(', ')}.`, 'info');
    g.stats.snapshot(g.s, 0);
    g.updateDeadline();
    return g;
  }

  /** Spiel aus einem Snapshot wiederherstellen */
  static fromJSON(data, opts = {}) {
    const g = new Game(opts);
    g.s = data;
    g.rules = resolveRules(data.rules);
    g.stats = new StatsCollector(data.stats);
    return g;
  }

  toJSON() {
    return this.s;
  }

  /* ------------------------------------------------------------------ */
  /* Hilfsfunktionen                                                     */
  /* ------------------------------------------------------------------ */

  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  rollDie() {
    return 1 + Math.floor(this.rng() * this.rules.diceSides);
  }

  rollDice() {
    if (this.diceQueue.length) return this.diceQueue.shift();
    return [this.rollDie(), this.rollDie()];
  }

  player(pid) {
    return this.s.players.find((p) => p.id === pid);
  }

  get current() {
    return this.s.players[this.s.current];
  }

  alivePlayers() {
    return this.s.players.filter((p) => !p.bankrupt);
  }

  emit(ev) {
    this.events.push(ev);
  }

  /** Eintrag ins Spielprotokoll (öffentlich) */
  log(text, kind = 'info', pid = null) {
    const entry = { id: ++this.s.logSeq, round: this.s.round, t: this.now(), text, kind, pid };
    this.s.log.push(entry);
    if (this.s.log.length > PUBLIC_LOG) this.s.log.splice(0, this.s.log.length - PUBLIC_LOG);
    this.stats.replay(entry);
  }

  flushEvents() {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  enterPhase(phase) {
    this.s.phase = phase;
    this.s.phaseSeq++;
  }

  /** Wer muss gerade handeln? (für Zug-Timer und Bots) */
  responsiblePid() {
    const s = this.s;
    if (s.phase === 'debt' && s.debts.length) return s.debts[0].debtor;
    if (['roll', 'jail', 'buy', 'end'].includes(s.phase)) return this.current.id;
    return null;
  }

  /** Zug-Timer: neue Frist, sobald eine neue Entscheidung ansteht */
  updateDeadline() {
    const s = this.s;
    if (!this.rules.turnTimer || s.phase === 'over' || s.phase === 'auction' || !this.responsiblePid()) {
      s.deadline = null;
      s.deadlineSeq = s.phaseSeq;
      return;
    }
    if (s.deadlineSeq !== s.phaseSeq || !s.deadline) {
      s.deadline = this.now() + this.rules.turnTimer * 1000;
      s.deadlineSeq = s.phaseSeq;
    }
  }

  /* ------------------------------------------------------------------ */
  /* Aktionen (einziger Einstiegspunkt für Clients und Bots)             */
  /* ------------------------------------------------------------------ */

  /**
   * Führt eine Spieler-Aktion aus.
   * @returns {{ ok: true } | { ok: false, error: string }}
   */
  act(pid, type, payload = {}) {
    const handler = ACTIONS[type];
    if (!handler) return { ok: false, error: 'Unbekannte Aktion.' };
    const p = this.player(pid);
    if (!p) return { ok: false, error: 'Du spielst in diesem Spiel nicht mit.' };
    if (this.s.phase === 'over') return { ok: false, error: 'Das Spiel ist vorbei.' };
    if (p.bankrupt) return { ok: false, error: 'Du bist bankrott.' };
    try {
      handler.call(this, p, payload && typeof payload === 'object' ? payload : {});
      this.updateDeadline();
      return { ok: true };
    } catch (err) {
      if (err instanceof GameError) return { ok: false, error: err.message };
      throw err;
    }
  }

  requireTurn(p, ...phases) {
    if (this.current.id !== p.id) fail('Du bist nicht am Zug.');
    if (!phases.includes(this.s.phase)) fail('Das ist gerade nicht möglich.');
  }

  /** Verwalten (Bauen/Hypothek …): aktiver Spieler in seinen Zugphasen, Schuldner in der Schuldenphase */
  requireManage(p, raisingMoney) {
    const s = this.s;
    if (s.phase === 'debt' && s.debts[0]?.debtor === p.id) {
      if (!raisingMoney) fail('Zahle zuerst deine Schulden.');
      return;
    }
    if (this.current.id !== p.id) fail('Du kannst nur während deines Zuges verwalten.');
    const allowed = raisingMoney ? ['roll', 'jail', 'buy', 'end'] : ['roll', 'jail', 'end'];
    if (!allowed.includes(s.phase)) fail('Das ist gerade nicht möglich.');
  }

  /* --- Würfeln ------------------------------------------------------ */

  doRoll(p) {
    const s = this.s;
    if (s.phase === 'jail') return this.rollInJail(p);
    this.requireTurn(p, 'roll');
    const [a, b] = this.rollDice();
    const isDouble = a === b;
    s.turn.dice = [a, b];
    this.stats.onDice(p.id, a, b);
    this.emit({ t: 'dice', pid: p.id, dice: [a, b] });
    this.log(`${p.name} würfelt ${a} + ${b} = ${a + b}${isDouble ? ' (Pasch!)' : ''}.`, 'dice', p.id);

    if (isDouble) {
      s.turn.doubles++;
      if (s.turn.doubles >= this.rules.doublesToJail) {
        this.log(`${p.name} hat ${this.rules.doublesToJail}× hintereinander einen Pasch und muss ins Gefängnis.`, 'jail', p.id);
        this.sendToJail(p);
        s.queue.push({ type: 'finishMove' });
        return this.proceed();
      }
    }
    s.turn.rollAgain = isDouble;
    s.queue.push({ type: 'move', steps: a + b, byDice: true }, { type: 'land', diceSum: a + b }, { type: 'finishMove' });
    this.enterPhase('moving');
    this.proceed();
  }

  rollInJail(p) {
    const s = this.s;
    this.requireTurn(p, 'jail');
    const [a, b] = this.rollDice();
    s.turn.dice = [a, b];
    s.turn.rollAgain = false; // Pasch im Gefängnis erlaubt keinen weiteren Wurf
    this.stats.onDice(p.id, a, b);
    this.emit({ t: 'dice', pid: p.id, dice: [a, b] });
    this.enterPhase('moving');

    if (a === b) {
      this.log(`${p.name} würfelt einen Pasch (${a} + ${b}) und kommt aus dem Gefängnis frei.`, 'jail', p.id);
      this.release(p);
      s.queue.push({ type: 'move', steps: a + b, byDice: true }, { type: 'land', diceSum: a + b }, { type: 'finishMove' });
      return this.proceed();
    }

    p.jailTurns++;
    if (p.jailTurns >= this.rules.maxJailTurns) {
      this.log(`${p.name} würfelt ${a} + ${b}: kein Pasch nach ${p.jailTurns} Versuchen. Kaution ${eur(this.rules.jailBail)} ist fällig.`, 'jail', p.id);
      this.charge(p.id, this.rules.jailBail, null, 'bail', { text: 'Gefängniskaution' });
      s.queue.push(
        { type: 'release', pid: p.id },
        { type: 'move', steps: a + b, byDice: true },
        { type: 'land', diceSum: a + b },
        { type: 'finishMove' },
      );
      return this.proceed();
    }
    this.log(`${p.name} würfelt ${a} + ${b}: kein Pasch. Versuch ${p.jailTurns} von ${this.rules.maxJailTurns}.`, 'jail', p.id);
    s.queue.push({ type: 'finishMove' });
    this.proceed();
  }

  doPayBail(p) {
    this.requireTurn(p, 'jail');
    const bail = this.rules.jailBail;
    if (p.money < bail) fail(`Du brauchst ${eur(bail)} für die Kaution.`);
    this.transfer(p.id, null, bail, 'bail', { text: 'Gefängniskaution' });
    this.log(`${p.name} zahlt ${eur(bail)} Kaution und ist frei.`, 'jail', p.id);
    this.release(p);
    this.enterPhase('roll');
  }

  doUseCard(p) {
    this.requireTurn(p, 'jail');
    if (!p.jailCards.length) fail('Du hast keine Freikarte.');
    const cardId = p.jailCards.shift();
    this.s.decks[deckOfCard(cardId)].push(cardId); // zurück unter den Stapel
    this.log(`${p.name} nutzt die Gefängnis-Freikarte.`, 'jail', p.id);
    this.emit({ t: 'jailCard', pid: p.id });
    this.release(p);
    this.enterPhase('roll');
  }

  release(p) {
    p.inJail = false;
    p.jailTurns = 0;
    this.emit({ t: 'release', pid: p.id });
  }

  /* --- Kaufen / Ablehnen ------------------------------------------- */

  doBuy(p) {
    this.requireTurn(p, 'buy');
    const idx = this.s.pendingBuy;
    const field = BOARD[idx];
    if (p.money < field.price) fail(`Nicht genug Geld: ${field.name} kostet ${eur(field.price)}.`);
    this.transfer(p.id, null, field.price, 'purchase', { idx });
    this.giveProperty(p.id, idx);
    this.stats.onBuy(this.s, p.id, idx, field.price, false);
    this.log(`${p.name} kauft ${field.name} für ${eur(field.price)}.`, 'buy', p.id);
    this.emit({ t: 'buy', pid: p.id, idx, price: field.price });
    this.s.pendingBuy = null;
    this.enterPhase('moving');
    this.proceed();
  }

  doDecline(p) {
    this.requireTurn(p, 'buy');
    const idx = this.s.pendingBuy;
    this.s.pendingBuy = null;
    if (this.rules.auctions) {
      this.log(`${p.name} kauft ${BOARD[idx].name} nicht. Das Feld wird versteigert.`, 'auction', p.id);
      this.s.queue.unshift({ type: 'auction', idx });
    } else {
      this.log(`${p.name} kauft ${BOARD[idx].name} nicht. Das Feld bleibt bei der Bank.`, 'info', p.id);
    }
    this.enterPhase('moving');
    this.proceed();
  }

  giveProperty(pid, idx) {
    this.s.props[idx].owner = pid;
    const field = BOARD[idx];
    if (field.type === 'street' && L.ownsGroup(this.s, pid, field.group)) {
      const p = this.player(pid);
      this.log(`${p.name} besitzt jetzt alle Straßen der Farbe ${GROUPS[field.group].name}!`, 'buy', pid);
      this.stats.marker(this.s, pid, 'monopoly', `Farbgruppe ${GROUPS[field.group].name}`);
    }
  }

  /* --- Zug beenden -------------------------------------------------- */

  doEndTurn(p) {
    this.requireTurn(p, 'end');
    this.nextTurn();
  }

  /* --- Bauen, Verkaufen, Hypotheken -------------------------------- */

  doBuild(p, { idx }) {
    if (!isInt(idx)) fail('Ungültiges Feld.');
    this.requireManage(p, false);
    const check = L.canBuild(this.s, this.rules, p.id, idx);
    if (!check.ok) fail(check.reason);
    const prop = this.s.props[idx];
    const field = BOARD[idx];
    this.transfer(p.id, null, check.cost, 'building', { idx });
    const limited = this.rules.buildingLimit !== 'unlimited';
    if (prop.houses === HOTEL_LEVEL - 1) {
      if (limited) {
        this.s.bank.hotels--;
        this.s.bank.houses += this.rules.housesPerHotel;
      }
      prop.houses = HOTEL_LEVEL;
      this.log(`${p.name} baut ein Hotel auf ${field.name}.`, 'build', p.id);
      this.stats.marker(this.s, p.id, 'hotel', `Hotel ${field.name}`);
    } else {
      if (limited) this.s.bank.houses--;
      prop.houses++;
      this.log(`${p.name} baut ein Haus auf ${field.name} (${prop.houses}).`, 'build', p.id);
    }
    this.stats.onBuild(p.id, idx, check.cost, prop.houses === HOTEL_LEVEL);
    this.emit({ t: 'build', pid: p.id, idx, houses: prop.houses });
  }

  doSell(p, { idx }) {
    if (!isInt(idx)) fail('Ungültiges Feld.');
    this.requireManage(p, true);
    const check = L.canSellBuilding(this.s, this.rules, p.id, idx);
    if (!check.ok) fail(check.reason);
    const prop = this.s.props[idx];
    const limited = this.rules.buildingLimit !== 'unlimited';
    if (prop.houses === HOTEL_LEVEL) {
      if (limited) {
        this.s.bank.hotels++;
        this.s.bank.houses -= this.rules.housesPerHotel;
      }
    } else if (limited) this.s.bank.houses++;
    prop.houses--;
    this.transfer(null, p.id, check.refund, 'buildingSale', { idx });
    this.log(`${p.name} verkauft ein Gebäude auf ${BOARD[idx].name} für ${eur(check.refund)}.`, 'build', p.id);
    this.emit({ t: 'build', pid: p.id, idx, houses: prop.houses });
  }

  doMortgage(p, { idx }) {
    if (!isInt(idx)) fail('Ungültiges Feld.');
    this.requireManage(p, true);
    const check = L.canMortgage(this.s, this.rules, p.id, idx);
    if (!check.ok) fail(check.reason);
    this.s.props[idx].mortgaged = true;
    this.transfer(null, p.id, check.amount, 'mortgage', { idx });
    this.log(`${p.name} nimmt eine Hypothek auf ${BOARD[idx].name} auf (+${eur(check.amount)}).`, 'mortgage', p.id);
    this.emit({ t: 'mortgage', pid: p.id, idx, mortgaged: true });
  }

  doUnmortgage(p, { idx }) {
    if (!isInt(idx)) fail('Ungültiges Feld.');
    this.requireManage(p, false);
    const check = L.canUnmortgage(this.s, this.rules, p.id, idx);
    if (!check.ok) fail(check.reason);
    const interest = check.cost - BOARD[idx].mortgage;
    this.transfer(p.id, null, BOARD[idx].mortgage, 'unmortgage', { idx });
    if (interest > 0) this.transfer(p.id, null, interest, 'interest', { idx });
    this.s.props[idx].mortgaged = false;
    this.log(`${p.name} zahlt die Hypothek auf ${BOARD[idx].name} zurück (${eur(check.cost)}).`, 'mortgage', p.id);
    this.emit({ t: 'mortgage', pid: p.id, idx, mortgaged: false });
  }

  /* --- Versteigerung ------------------------------------------------ */

  startAuction(idx) {
    const s = this.s;
    const now = this.now();
    s.auction = {
      idx,
      bid: 0,
      bidder: null,
      startedAt: now,
      endsAt: now + this.rules.auctionStartMs,
      passed: [],
      bids: 0,
    };
    this.enterPhase('auction');
    this.log(`Versteigerung: ${BOARD[idx].name} (Listenpreis ${eur(BOARD[idx].price)}).`, 'auction');
    this.emit({ t: 'auctionStart', idx });
  }

  /** Spieler, die noch bieten dürfen */
  auctionBidders() {
    const a = this.s.auction;
    return this.alivePlayers().filter((p) => !a.passed.includes(p.id));
  }

  doBid(p, { amount }) {
    const a = this.s.auction;
    if (this.s.phase !== 'auction' || !a) fail('Es läuft keine Versteigerung.');
    if (a.passed.includes(p.id)) fail('Du bist bereits ausgestiegen.');
    if (!isInt(amount)) fail('Ungültiges Gebot.');
    const min = Math.max(this.rules.auctionMinBid, a.bid + 1);
    if (amount < min) fail(`Das Gebot muss mindestens ${eur(min)} betragen.`);
    if (amount > p.money) fail('So viel Bargeld hast du nicht.');
    if (a.bidder === p.id) fail('Du bist bereits Höchstbietender.');
    a.bid = amount;
    a.bidder = p.id;
    a.bids++;
    a.endsAt = this.now() + this.rules.auctionResetMs;
    this.log(`${p.name} bietet ${eur(amount)}.`, 'auction', p.id);
    this.emit({ t: 'bid', pid: p.id, amount });
    this.checkAuctionDone();
  }

  doPass(p) {
    const a = this.s.auction;
    if (this.s.phase !== 'auction' || !a) fail('Es läuft keine Versteigerung.');
    if (a.passed.includes(p.id)) fail('Du bist bereits ausgestiegen.');
    if (a.bidder === p.id) fail('Als Höchstbietender kannst du nicht aussteigen.');
    a.passed.push(p.id);
    this.log(`${p.name} steigt aus der Versteigerung aus.`, 'auction', p.id);
    this.emit({ t: 'pass', pid: p.id });
    this.checkAuctionDone();
  }

  /** Versteigerung vorzeitig beenden, wenn nur noch der Höchstbietende übrig ist */
  checkAuctionDone() {
    const a = this.s.auction;
    const remaining = this.auctionBidders();
    if (remaining.length === 0 || (remaining.length === 1 && remaining[0].id === a.bidder)) this.endAuction();
  }

  endAuction() {
    const s = this.s;
    const a = s.auction;
    if (!a) return;
    const field = BOARD[a.idx];
    if (a.bidder) {
      const w = this.player(a.bidder);
      this.transfer(w.id, null, a.bid, 'purchase', { idx: a.idx, auction: true });
      this.giveProperty(w.id, a.idx);
      this.stats.onBuy(s, w.id, a.idx, a.bid, true);
      this.log(`${w.name} ersteigert ${field.name} für ${eur(a.bid)}.`, 'auction', w.id);
      this.emit({ t: 'auctionEnd', idx: a.idx, pid: w.id, amount: a.bid });
    } else {
      this.log(`Niemand bietet für ${field.name}. Das Feld bleibt bei der Bank.`, 'auction');
      this.emit({ t: 'auctionEnd', idx: a.idx, pid: null, amount: 0 });
    }
    s.auction = null;
    this.enterPhase('moving');
    this.proceed();
  }

  /** Zeitgesteuerte Vorgänge (vom Raum aufgerufen): Versteigerungsende */
  tick() {
    const a = this.s.auction;
    if (a && this.s.phase === 'auction' && this.now() >= a.endsAt) {
      this.endAuction();
      this.updateDeadline();
      return true;
    }
    return false;
  }

  /** Nächster Zeitpunkt, zu dem tick() etwas tun könnte */
  nextWakeup() {
    return this.s.auction ? this.s.auction.endsAt : null;
  }

  /* --- Schulden und Bankrott --------------------------------------- */

  doPayDebt(p) {
    const d = this.s.debts[0];
    if (this.s.phase !== 'debt' || !d || d.debtor !== p.id) fail('Du hast keine offenen Schulden.');
    if (p.money < d.amount) fail(`Dir fehlen noch ${eur(d.amount - p.money)}. Verkaufe Gebäude oder nimm Hypotheken auf.`);
    this.s.debts.shift();
    this.transfer(p.id, d.creditor, d.amount, d.kind, d.meta);
    const to = d.creditor ? this.player(d.creditor).name : 'die Bank';
    this.log(`${p.name} begleicht die Schulden: ${eur(d.amount)} an ${to}.`, 'pay', p.id);
    this.enterPhase('moving');
    this.proceed();
  }

  doBankrupt(p) {
    const d = this.s.debts[0];
    if (this.s.phase !== 'debt' || !d || d.debtor !== p.id) fail('Bankrott kannst du nur erklären, wenn du Schulden hast.');
    this.declareBankrupt(p, d.creditor);
    if (this.s.phase === 'over') return;
    this.enterPhase('moving');
    this.proceed();
  }

  /**
   * Bankrott: Vermögen geht an den Gläubiger (Spieler) oder an die Bank.
   * Gebäude gehen zum halben Preis an die Bank, der Erlös an den Gläubiger.
   */
  declareBankrupt(p, creditorId) {
    const s = this.s;
    const creditor = creditorId ? this.player(creditorId) : null;
    const owned = L.ownedBy(s, p.id);
    const limited = this.rules.buildingLimit !== 'unlimited';

    // Gebäude an die Bank zurück
    let buildingCash = 0;
    for (const i of owned) {
      const prop = s.props[i];
      if (prop.houses > 0) {
        buildingCash += Math.floor(L.buildingValue(i, prop.houses) * this.rules.buildingSellRatio);
        if (limited) {
          if (prop.houses === HOTEL_LEVEL) s.bank.hotels++;
          else s.bank.houses += prop.houses;
        }
        prop.houses = 0;
      }
    }
    const cash = p.money + buildingCash;
    p.money = 0;

    // Offene Schulden des Spielers (und an ihn) verfallen; die aktuelle wird hier beglichen
    s.debts = s.debts.filter((d) => d.debtor !== p.id && d.creditor !== p.id);
    // Offene Handelsangebote mit diesem Spieler verfallen
    s.trades = s.trades.filter((t) => t.from !== p.id && t.to !== p.id);

    if (creditor) {
      creditor.money += cash;
      this.stats.onPay(p.id, creditor.id, cash, 'bankruptcy', {});
      for (const i of owned) {
        s.props[i].owner = creditor.id;
        if (s.props[i].mortgaged) {
          // Übernommene Hypotheken: Zinsen sofort fällig
          const fee = L.mortgageInterestFee(this.rules, i);
          if (fee > 0) this.charge(creditor.id, fee, null, 'interest', { idx: i, text: `Zinsen für ${BOARD[i].name}` });
        }
      }
      creditor.jailCards.push(...p.jailCards);
      this.log(`${p.name} ist bankrott! Das gesamte Vermögen (${eur(cash)} und ${owned.length} Grundstücke) geht an ${creditor.name}.`, 'bankrupt', p.id);
    } else {
      for (const i of owned) {
        s.props[i] = { owner: null, houses: 0, mortgaged: false };
      }
      for (const c of p.jailCards) s.decks[deckOfCard(c)].push(c);
      this.log(`${p.name} ist bankrott! Alle Grundstücke gehen an die Bank zurück.`, 'bankrupt', p.id);
      if (this.rules.auctions && this.alivePlayers().length > 2) {
        // Die Bank versteigert die zurückgegebenen Grundstücke
        s.queue.unshift(...owned.map((idx) => ({ type: 'auction', idx })));
      }
    }
    p.jailCards = [];
    p.bankrupt = true;
    p.inJail = false;
    s.bankruptOrder.push(p.id);
    this.stats.onBankrupt(s, p.id);
    this.emit({ t: 'bankrupt', pid: p.id, creditor: creditorId });

    // War der bankrotte Spieler am Zug, endet sein Zug
    if (this.current.id === p.id) {
      s.pendingBuy = null;
      s.queue = s.queue.filter((st) => st.type === 'auction');
      s.queue.push({ type: 'nextTurn' });
    }
    if (this.alivePlayers().length <= 1) this.endGame('lastStanding');
  }

  /**
   * Spieler aus dem laufenden Spiel entfernen (Host-Entscheidung bei
   * Abwesenheit). Wirkt wie ein Bankrott gegenüber der Bank.
   */
  removePlayer(pid) {
    const s = this.s;
    const p = this.player(pid);
    if (!p || p.bankrupt || s.phase === 'over') return false;
    const wasPhase = s.phase;
    const wasDebtor = s.phase === 'debt' && s.debts[0]?.debtor === pid;
    const wasCurrent = this.current.id === pid;
    // In einer laufenden Versteigerung steigt der Spieler aus (sein Gebot verfällt)
    const a = s.auction;
    if (a && !a.passed.includes(pid)) {
      if (a.bidder === pid) { a.bidder = null; a.bid = 0; }
      a.passed.push(pid);
    }
    this.log(`${p.name} wurde aus dem Spiel entfernt.`, 'bankrupt', pid);
    this.declareBankrupt(p, null);
    if (s.phase !== 'over') {
      if (s.auction) {
        this.checkAuctionDone();
      } else if (wasDebtor || wasCurrent) {
        this.enterPhase('moving');
        this.proceed();
      } else if (['roll', 'jail', 'end'].includes(wasPhase) && s.queue.length) {
        // Versteigerungen der zurückgegebenen Felder jetzt abhalten, dann weiter wie zuvor
        s.queue.push({ type: 'resume', phase: wasPhase });
        this.enterPhase('moving');
        this.proceed();
      }
    }
    this.updateDeadline();
    return true;
  }

  /* --- Handel ------------------------------------------------------- */

  normalizeSide(side) {
    const src = side && typeof side === 'object' ? side : {};
    const money = src.money === undefined ? 0 : src.money;
    if (!isInt(money) || money < 0) fail('Ungültiger Geldbetrag.');
    const props = Array.isArray(src.props) ? src.props : [];
    if (!props.every(isInt) || new Set(props).size !== props.length) fail('Ungültige Grundstücke.');
    const cards = src.cards === undefined ? 0 : src.cards;
    if (!isInt(cards) || cards < 0) fail('Ungültige Anzahl Freikarten.');
    return { money, props: props.slice().sort((a, b) => a - b), cards };
  }

  /** Prüft, ob ein Spieler eine Handelsseite erfüllen kann */
  checkSide(p, side) {
    if (side.money > p.money) fail(`${p.name} hat nicht genug Bargeld.`);
    if (side.cards > p.jailCards.length) fail(`${p.name} hat nicht genug Freikarten.`);
    for (const i of side.props) {
      if (this.s.props[i]?.owner !== p.id) fail(`${BOARD[i]?.name ?? 'Feld'} gehört nicht ${p.name}.`);
      if (!L.isTradeable(this.s, i)) fail(`${BOARD[i].name}: Erst alle Gebäude der Farbgruppe verkaufen.`);
    }
  }

  validateTrade(t) {
    const from = this.player(t.from);
    const to = this.player(t.to);
    if (!from || !to || from.bankrupt || to.bankrupt) fail('Handelspartner ist nicht mehr im Spiel.');
    if (from.id === to.id) fail('Du kannst nicht mit dir selbst handeln.');
    const allowed = L.tradingAllowed(this.s, this.rules);
    if (!allowed.ok) fail(allowed.reason);
    const empty = (sd) => !sd.money && !sd.props.length && !sd.cards;
    if (empty(t.give) && empty(t.get)) fail('Das Angebot ist leer.');
    this.checkSide(from, t.give);
    this.checkSide(to, t.get);
    // Zinsen für übernommene Hypotheken müssen bezahlbar sein
    const fee = (props) => props.filter((i) => this.s.props[i].mortgaged).reduce((sum, i) => sum + L.mortgageInterestFee(this.rules, i), 0);
    if (from.money - t.give.money + t.get.money < fee(t.get.props)) fail(`${from.name} kann die Hypothekenzinsen nicht bezahlen.`);
    if (to.money - t.get.money + t.give.money < fee(t.give.props)) fail(`${to.name} kann die Hypothekenzinsen nicht bezahlen.`);
  }

  doTradeOffer(p, payload) {
    if (this.s.phase === 'auction') fail('Während einer Versteigerung kann nicht gehandelt werden.');
    const to = this.player(payload.to);
    if (!to) fail('Unbekannter Handelspartner.');
    if (this.s.trades.filter((t) => t.from === p.id).length >= MAX_OPEN_TRADES) fail('Du hast zu viele offene Angebote.');
    const trade = {
      id: this.s.nextTradeId++,
      from: p.id,
      to: to.id,
      give: this.normalizeSide(payload.give),
      get: this.normalizeSide(payload.get),
      createdAt: this.now(),
      round: this.s.round,
      counterOf: payload.counterOf || null,
    };
    this.validateTrade(trade);
    this.s.trades.push(trade);
    this.log(`${p.name} bietet ${to.name} einen Handel an.`, 'trade', p.id);
    this.emit({ t: 'tradeOffer', id: trade.id, from: p.id, to: to.id });
    return trade;
  }

  findTrade(id) {
    const t = this.s.trades.find((x) => x.id === id);
    if (!t) fail('Dieses Angebot gibt es nicht mehr.');
    return t;
  }

  doTradeAccept(p, { id }) {
    const t = this.findTrade(id);
    if (t.to !== p.id) fail('Dieses Angebot ist nicht an dich gerichtet.');
    if (this.s.phase === 'auction') fail('Während einer Versteigerung kann nicht gehandelt werden.');
    try {
      this.validateTrade(t);
    } catch (err) {
      // Angebot ist ungültig geworden (z. B. Feld inzwischen verkauft)
      this.s.trades = this.s.trades.filter((x) => x.id !== id);
      throw err;
    }
    const from = this.player(t.from);
    const to = p;
    const move = (giver, receiver, side) => {
      if (side.money) this.transfer(giver.id, receiver.id, side.money, 'trade', {});
      for (const i of side.props) {
        this.s.props[i].owner = receiver.id;
        if (this.s.props[i].mortgaged) {
          const fee = L.mortgageInterestFee(this.rules, i);
          if (fee > 0) this.transfer(receiver.id, null, fee, 'interest', { idx: i });
        }
      }
      for (let k = 0; k < side.cards; k++) receiver.jailCards.push(giver.jailCards.shift());
    };
    move(from, to, t.give);
    move(to, from, t.get);
    for (const i of [...t.give.props, ...t.get.props]) {
      const f = BOARD[i];
      const owner = this.s.props[i].owner;
      if (f.type === 'street' && L.ownsGroup(this.s, owner, f.group)) {
        this.stats.marker(this.s, owner, 'monopoly', `Farbgruppe ${GROUPS[f.group].name}`);
      }
    }
    this.s.trades = this.s.trades.filter((x) => x.id !== id);
    this.stats.onTrade(this.s, t);
    const describe = (sd) => [
      ...sd.props.map((i) => BOARD[i].name),
      sd.money ? eur(sd.money) : null,
      sd.cards ? `${sd.cards} Freikarte${sd.cards > 1 ? 'n' : ''}` : null,
    ].filter(Boolean).join(', ') || 'nichts';
    this.log(`Handel: ${from.name} gibt ${describe(t.give)} und erhält von ${to.name} ${describe(t.get)}.`, 'trade', from.id);
    this.emit({ t: 'tradeDone', id, from: from.id, to: to.id });
  }

  doTradeReject(p, { id }) {
    const t = this.findTrade(id);
    if (t.to !== p.id) fail('Dieses Angebot ist nicht an dich gerichtet.');
    this.s.trades = this.s.trades.filter((x) => x.id !== id);
    this.log(`${p.name} lehnt den Handel von ${this.player(t.from).name} ab.`, 'trade', p.id);
    this.emit({ t: 'tradeRejected', id, from: t.from, to: t.to });
  }

  doTradeCancel(p, { id }) {
    const t = this.findTrade(id);
    if (t.from !== p.id) fail('Das ist nicht dein Angebot.');
    this.s.trades = this.s.trades.filter((x) => x.id !== id);
    this.log(`${p.name} zieht ein Handelsangebot zurück.`, 'trade', p.id);
  }

  /** Gegenangebot: altes Angebot ablehnen, neues an den ursprünglichen Absender */
  doTradeCounter(p, { id, give, get }) {
    const t = this.findTrade(id);
    if (t.to !== p.id) fail('Dieses Angebot ist nicht an dich gerichtet.');
    const counter = { to: t.from, give, get, counterOf: id };
    // Erst das neue Angebot prüfen, dann das alte entfernen
    const before = this.s.trades;
    this.s.trades = this.s.trades.filter((x) => x.id !== id);
    try {
      this.doTradeOffer(p, counter);
    } catch (err) {
      this.s.trades = before;
      throw err;
    }
    this.log(`${p.name} macht ${this.player(t.from).name} ein Gegenangebot.`, 'trade', p.id);
  }

  /* ------------------------------------------------------------------ */
  /* Ablaufsteuerung                                                     */
  /* ------------------------------------------------------------------ */

  /** Arbeitet die Warteschlange ab, bis eine Entscheidung nötig ist */
  proceed() {
    const s = this.s;
    for (let guard = 0; guard < 500; guard++) {
      if (s.phase === 'over') return;
      if (s.debts.length) {
        const d = s.debts[0];
        if (s.phase !== 'debt' || s.debtShown !== d.id) {
          s.debtShown = d.id;
          this.enterPhase('debt');
          const p = this.player(d.debtor);
          this.emit({ t: 'debt', pid: d.debtor, amount: d.amount });
          this.log(`${p.name} muss ${eur(d.amount)} zahlen, hat aber nur ${eur(p.money)}. Geld beschaffen oder Bankrott erklären.`, 'debt', p.id);
        }
        return;
      }
      if (s.phase === 'buy' || s.phase === 'auction') return;
      const step = s.queue.shift();
      if (!step) return;
      this.runStep(step);
    }
    throw new Error('proceed(): Endlosschleife erkannt');
  }

  runStep(step) {
    const s = this.s;
    const p = this.current;
    switch (step.type) {
      case 'move':
        this.moveBy(p, step.steps, { byDice: step.byDice });
        break;
      case 'moveTo':
        this.moveTo(p, step.to, { collectGo: step.collectGo });
        break;
      case 'land':
        this.land(p, step.diceSum, step.mod || {});
        break;
      case 'release': {
        const rp = this.player(step.pid);
        if (rp && !rp.bankrupt) this.release(rp);
        break;
      }
      case 'auction':
        if (s.props[step.idx].owner === null) this.startAuction(step.idx);
        break;
      case 'finishMove':
        this.finishMove();
        break;
      case 'nextTurn':
        this.nextTurn();
        break;
      case 'resume':
        this.enterPhase(step.phase);
        break;
      default:
        throw new Error(`Unbekannter Schritt ${step.type}`);
    }
  }

  /** Nach der Bewegung: erneut würfeln (Pasch) oder Zug beenden */
  finishMove() {
    const p = this.current;
    if (p.bankrupt) return this.nextTurn();
    if (!p.inJail && this.s.turn.rollAgain) {
      this.s.turn.rollAgain = false;
      this.log(`${p.name} hat einen Pasch und darf noch einmal würfeln.`, 'dice', p.id);
      this.enterPhase('roll');
    } else {
      this.enterPhase('end');
    }
  }

  nextTurn() {
    const s = this.s;
    if (s.phase === 'over') return;
    if (this.alivePlayers().length <= 1) return this.endGame('lastStanding');
    const n = s.players.length;
    let idx = s.current;
    let wrapped = false;
    do {
      idx = (idx + 1) % n;
      if (idx === 0) wrapped = true;
    } while (s.players[idx].bankrupt);
    if (idx <= s.current) wrapped = true;

    if (wrapped) {
      this.stats.snapshot(s, s.round);
      if (this.rules.winCondition === 'rounds' && s.round >= this.rules.roundLimit) {
        return this.endGame('rounds');
      }
      if (this.rules.winCondition === 'time' && this.now() - s.startedAt >= this.rules.timeLimit * 60000) {
        return this.endGame('time');
      }
      s.round++;
      this.log(`Runde ${s.round} beginnt.`, 'round');
    }
    s.current = idx;
    s.turnNo++;
    const p = this.current;
    s.turn = { pid: p.id, dice: null, doubles: 0, rollAgain: false };
    s.queue = [];
    s.pendingBuy = null;
    this.enterPhase(p.inJail ? 'jail' : 'roll');
    this.emit({ t: 'turn', pid: p.id });
  }

  /* --- Bewegung ----------------------------------------------------- */

  /** Schritte vorwärts (oder rückwärts bei negativer Zahl) */
  moveBy(p, steps, { byDice = false } = {}) {
    const from = p.position;
    const to = (((from + steps) % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
    p.position = to;
    this.emit({ t: 'move', pid: p.id, from, to, steps });
    if (steps > 0 && from + steps >= BOARD_SIZE) {
      const exact = to === POS.GO && byDice && this.rules.doubleGoOnLand;
      this.paySalary(p, exact);
    }
  }

  /** Direkt vorwärts zu einem Feld ziehen (Karten), mit LOS-Gehalt beim Überqueren */
  moveTo(p, target, { collectGo = true } = {}) {
    const steps = (target - p.position + BOARD_SIZE) % BOARD_SIZE;
    const from = p.position;
    p.position = target;
    this.emit({ t: 'move', pid: p.id, from, to: target, steps });
    if (collectGo && steps > 0 && from + steps >= BOARD_SIZE) this.paySalary(p, false);
  }

  paySalary(p, double) {
    const amount = this.rules.goSalary * (double ? 2 : 1);
    this.transfer(null, p.id, amount, 'go', {});
    this.log(`${p.name} kommt über LOS und erhält ${eur(amount)}${double ? ' (doppelt, genau auf LOS!)' : ''}.`, 'go', p.id);
  }

  sendToJail(p) {
    const from = p.position;
    p.position = POS.JAIL;
    p.inJail = true;
    p.jailTurns = 0;
    this.s.turn.rollAgain = false;
    this.stats.onJail(p.id);
    this.stats.onLand(p.id, POS.JAIL);
    this.emit({ t: 'move', pid: p.id, from, to: POS.JAIL, steps: 0, direct: true });
    this.emit({ t: 'jail', pid: p.id });
  }

  /* --- Landen ------------------------------------------------------- */

  land(p, diceSum, mod) {
    const s = this.s;
    const idx = p.position;
    const field = BOARD[idx];
    this.stats.onLand(p.id, idx);

    switch (field.type) {
      case 'street':
      case 'railroad':
      case 'utility':
        return this.landOnProperty(p, idx, diceSum, mod);
      case 'tax':
        this.log(`${p.name} landet auf ${field.name} und zahlt ${eur(field.amount)}.`, 'tax', p.id);
        this.charge(p.id, field.amount, null, 'tax', { idx, text: field.name });
        return;
      case 'chance':
      case 'community':
        return this.drawCard(p, field.type);
      case 'gotojail':
        this.log(`${p.name} muss ins Gefängnis!`, 'jail', p.id);
        this.sendToJail(p);
        return;
      case 'parking':
        if (this.rules.freeParking === 'jackpot' && s.pot > 0) {
          const pot = s.pot;
          s.pot = 0;
          this.transfer(null, p.id, pot, 'jackpot', {});
          this.log(`${p.name} knackt den Frei-Parken-Jackpot: ${eur(pot)}!`, 'jackpot', p.id);
          this.emit({ t: 'jackpot', pid: p.id, amount: pot });
        } else {
          this.log(`${p.name} parkt frei.`, 'info', p.id);
        }
        return;
      case 'jail':
        this.log(`${p.name} ist nur zu Besuch im Gefängnis.`, 'info', p.id);
        return;
      case 'go':
      default:
        return;
    }
  }

  landOnProperty(p, idx, diceSum, mod) {
    const s = this.s;
    const field = BOARD[idx];
    const prop = s.props[idx];
    if (prop.owner === null) {
      s.pendingBuy = idx;
      this.enterPhase('buy');
      this.log(`${p.name} landet auf ${field.name} (${eur(field.price)}).`, 'info', p.id);
      return;
    }
    if (prop.owner === p.id) {
      this.log(`${p.name} landet auf dem eigenen Feld ${field.name}.`, 'info', p.id);
      return;
    }
    const owner = this.player(prop.owner);
    if (prop.mortgaged) {
      this.log(`${field.name} ist mit einer Hypothek belastet: keine Miete.`, 'info', p.id);
      return;
    }
    if (!this.rules.rentInJail && owner.inJail) {
      this.log(`${owner.name} sitzt im Gefängnis und kassiert keine Miete.`, 'info', p.id);
      return;
    }
    let sum = diceSum;
    if (field.type === 'utility' && mod.diceMultiplier) {
      // Karte „nächstes Werk“: neu würfeln
      const [a, b] = this.rollDice();
      sum = a + b;
      this.emit({ t: 'dice', pid: p.id, dice: [a, b], forRent: true });
      this.log(`${p.name} würfelt für die Miete: ${a} + ${b} = ${sum}.`, 'dice', p.id);
    }
    const rent = L.calcRent(s, this.rules, idx, sum, mod);
    if (rent <= 0) return;
    this.log(`${p.name} zahlt ${eur(rent)} Miete an ${owner.name} für ${field.name}.`, 'rent', p.id);
    this.charge(p.id, rent, owner.id, 'rent', { idx, text: `Miete ${field.name}` });
  }

  /* --- Karten ------------------------------------------------------- */

  drawCard(p, deckName) {
    const s = this.s;
    const deck = s.decks[deckName];
    const id = deck.shift();
    const card = getCard(id);
    if (card.action.kind !== 'jailFree') deck.push(id); // sofort wieder unter den Stapel
    this.stats.onCard(p.id, deckName);
    s.lastCard = { deck: deckName, id, text: card.text, pid: p.id, seq: s.logSeq + 1 };
    this.emit({ t: 'card', pid: p.id, deck: deckName, id, text: card.text });
    this.log(`${p.name} zieht eine ${DECKS[deckName].name}: „${card.text}“`, 'card', p.id);
    this.applyCard(p, card);
  }

  applyCard(p, card) {
    const s = this.s;
    const a = card.action;
    switch (a.kind) {
      case 'advance':
        s.queue.unshift({ type: 'moveTo', to: a.to, collectGo: a.collectGo }, { type: 'land', diceSum: this.diceSum() });
        break;
      case 'advanceNearest': {
        let i = p.position;
        do i = (i + 1) % BOARD_SIZE; while (BOARD[i].type !== a.target);
        const mod = {};
        if (a.rentMultiplier) mod.rentMultiplier = a.rentMultiplier;
        if (a.diceMultiplier) mod.diceMultiplier = a.diceMultiplier;
        s.queue.unshift({ type: 'moveTo', to: i, collectGo: true }, { type: 'land', diceSum: this.diceSum(), mod });
        break;
      }
      case 'back':
        s.queue.unshift({ type: 'move', steps: -a.steps }, { type: 'land', diceSum: this.diceSum() });
        break;
      case 'money':
        if (a.amount >= 0) this.transfer(null, p.id, a.amount, 'card', {});
        else this.charge(p.id, -a.amount, null, 'fine', { text: 'Kartenzahlung' });
        break;
      case 'eachPlayer': {
        const others = this.alivePlayers().filter((o) => o.id !== p.id);
        for (const o of others) {
          if (a.amount > 0) this.charge(o.id, a.amount, p.id, 'card', { text: 'Karte' });
          else this.charge(p.id, -a.amount, o.id, 'card', { text: 'Karte' });
        }
        break;
      }
      case 'repairs': {
        const { houses, hotels } = L.buildingCount(s, p.id);
        const cost = houses * a.house + hotels * a.hotel;
        if (cost > 0) {
          this.log(`${p.name} zahlt ${eur(cost)} für ${houses} Häuser und ${hotels} Hotels.`, 'tax', p.id);
          this.charge(p.id, cost, null, 'repairs', { text: 'Reparaturen' });
        } else {
          this.log(`${p.name} besitzt keine Gebäude und zahlt nichts.`, 'info', p.id);
        }
        break;
      }
      case 'jailFree':
        p.jailCards.push(card.id);
        break;
      case 'gotoJail':
        this.sendToJail(p);
        break;
      default:
        throw new Error(`Unbekannte Kartenaktion ${a.kind}`);
    }
  }

  diceSum() {
    const d = this.s.turn.dice;
    return d ? d[0] + d[1] : 0;
  }

  /* --- Geld --------------------------------------------------------- */

  /**
   * Geldbewegung ohne Prüfung (Bank = null). Zahlungen an die Bank aus
   * Steuern/Strafen landen beim Frei-Parken-Jackpot im Topf.
   */
  transfer(fromPid, toPid, amount, kind, meta = {}) {
    if (amount <= 0) return;
    const s = this.s;
    if (fromPid) {
      const f = this.player(fromPid);
      f.money -= amount;
      if (f.money < 0) throw new Error(`Negativer Kontostand bei ${f.name}`);
      this.emit({ t: 'money', pid: fromPid, delta: -amount, kind });
    }
    if (toPid) {
      this.player(toPid).money += amount;
      this.emit({ t: 'money', pid: toPid, delta: amount, kind });
    } else if (fromPid && this.rules.freeParking === 'jackpot' && JACKPOT_KINDS.has(kind)) {
      s.pot += amount;
    }
    this.stats.onPay(fromPid, toPid, amount, kind, meta);
  }

  /**
   * Forderung: sofort zahlen, wenn genug Bargeld da ist, sonst Schuld vormerken
   * (Phase „debt“).
   * @returns {boolean} true, wenn sofort bezahlt
   */
  charge(debtorPid, amount, creditorPid, kind, meta = {}) {
    if (amount <= 0) return true;
    const p = this.player(debtorPid);
    if (p.bankrupt) return true;
    if (creditorPid && this.player(creditorPid).bankrupt) return true;
    if (p.money >= amount && !this.s.debts.some((d) => d.debtor === debtorPid)) {
      this.transfer(debtorPid, creditorPid, amount, kind, meta);
      return true;
    }
    this.s.debts.push({ id: ++this.s.debtCounter, debtor: debtorPid, creditor: creditorPid, amount, kind, meta });
    return false;
  }

  /* --- Spielende ---------------------------------------------------- */

  endGame(reason) {
    const s = this.s;
    if (s.phase === 'over') return;
    s.endReason = reason;
    s.endedAt = this.now();
    s.auction = null;
    s.debts = [];
    s.queue = [];
    s.trades = [];
    s.pendingBuy = null;

    const alive = this.alivePlayers()
      .map((p) => ({ p, worth: L.netWorth(s, p.id).total }))
      .sort((a, b) => b.worth - a.worth);
    const ranking = [...alive.map((x) => x.p.id), ...s.bankruptOrder.slice().reverse()];
    s.ranking = ranking;
    s.winner = ranking[0];
    this.stats.snapshot(s, s.round, true);
    this.enterPhase('over');
    s.deadline = null;
    const w = this.player(s.winner);
    const why = { lastStanding: 'Alle anderen sind bankrott.', rounds: 'Das Rundenlimit ist erreicht.', time: 'Das Zeitlimit ist abgelaufen.' }[reason];
    this.log(`Spielende! ${why} ${w.name} gewinnt.`, 'win', w.id);
    this.emit({ t: 'gameOver', winner: s.winner, reason });
  }

  /* ------------------------------------------------------------------ */
  /* Anwesenheit (vom Raum gesetzt, nur Anzeige / Bot-Steuerung)          */
  /* ------------------------------------------------------------------ */

  setPresence(pid, { online, away }) {
    const p = this.player(pid);
    if (!p) return;
    if (online !== undefined) p.online = online;
    if (away !== undefined) p.away = away;
  }

  /* ------------------------------------------------------------------ */
  /* Öffentlicher Zustand (an alle Clients)                              */
  /* ------------------------------------------------------------------ */

  publicState() {
    const s = this.s;
    return {
      players: s.players,
      props: s.props,
      bank: s.bank,
      current: s.current,
      currentPid: this.current.id,
      round: s.round,
      turnNo: s.turnNo,
      phase: s.phase,
      turn: s.turn,
      debt: s.debts[0] || null,
      debtsOpen: s.debts.length,
      auction: s.auction,
      pendingBuy: s.pendingBuy,
      trades: s.trades,
      deckSizes: { chance: s.decks.chance.length, community: s.decks.community.length },
      pot: s.pot,
      lastCard: s.lastCard,
      log: s.log,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      deadline: s.deadline,
      winner: s.winner,
      endReason: s.endReason,
      ranking: s.ranking,
      bankruptOrder: s.bankruptOrder,
      rules: this.rules,
      responsible: this.responsiblePid(),
    };
  }
}

/** Zahlungen an die Bank, die beim Jackpot in die Mitte wandern */
const JACKPOT_KINDS = new Set(['tax', 'fine', 'repairs', 'bail']);

/** Aktionsname → Methode */
const ACTIONS = {
  roll: Game.prototype.doRoll,
  payBail: Game.prototype.doPayBail,
  useCard: Game.prototype.doUseCard,
  buy: Game.prototype.doBuy,
  decline: Game.prototype.doDecline,
  endTurn: Game.prototype.doEndTurn,
  build: Game.prototype.doBuild,
  sell: Game.prototype.doSell,
  mortgage: Game.prototype.doMortgage,
  unmortgage: Game.prototype.doUnmortgage,
  bid: Game.prototype.doBid,
  pass: Game.prototype.doPass,
  payDebt: Game.prototype.doPayDebt,
  bankrupt: Game.prototype.doBankrupt,
  tradeOffer: Game.prototype.doTradeOffer,
  tradeAccept: Game.prototype.doTradeAccept,
  tradeReject: Game.prototype.doTradeReject,
  tradeCancel: Game.prototype.doTradeCancel,
  tradeCounter: Game.prototype.doTradeCounter,
};

export const ACTION_TYPES = Object.keys(ACTIONS);
