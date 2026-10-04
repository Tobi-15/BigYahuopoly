/**
 * Spielansicht: verarbeitet Zustands-Updates des Servers, spielt die
 * Ereignisse (Würfel, Bewegung, Karten, Geld) als Animation ab und rendert
 * Spielerleiste, Aktionsbereich, Versteigerung, Besitz, Handel und Verlauf.
 *
 * Wichtig: Der Client entscheidet nichts. Buttons schicken nur Aktionen an
 * den Server; die Vorabprüfung (shared/logic.js) dient nur der Anzeige.
 */
import { BOARD, GROUPS, GROUP_MEMBERS, HOTEL_LEVEL, POS } from '/shared/board.js';
import * as L from '/shared/logic.js';
import { describeRules } from '/shared/rules.js';
import { el, $, $$, eur, toast, animateNumber, confirmDialog, modal, popupMenu, inkOn } from './util.js';
import { send } from './net.js';
import { store, serverNow, isHost, member } from './store.js';
import { Board, deedCard } from './board.js';
import { avatar, copyInvite } from './lobby.js';
import { sfx } from './sound.js';
import { openTradeModal, renderTrades } from './trade.js';
import { openStats, refreshStatsIfOpen } from './stats.js';

let board = null;
let view = null; // aktuell angezeigter Zustand
const queue = [];
let processing = false;
let busy = false; // Aktion gesendet, Antwort steht aus
const money = {}; // angezeigte Kontostände
let lastLogId = 0;
let tickTimer = null;
let heatOn = false;
let titleFlash = null;
let gameOverShown = false;
let lastHeatTurn = null;

export function initGame() {
  board = new Board($('#board'));
  // Tabs
  for (const tab of $$('.side-tabs .tab')) {
    tab.onclick = () => selectTab(tab.dataset.tab);
  }
  $('#btn-trade').onclick = () => openTradeModal();
  $('#btn-stats').onclick = () => openStats();
  $('#btn-rules').onclick = () => openRulesOverview(view?.rules || store.room?.rules);
  $('#btn-heat').onclick = toggleHeat;
  $('#btn-menu').onclick = (e) => openMenu(e.currentTarget);
  $('#game-code').onclick = copyInvite;

  // Felder: Tooltip und Detailansicht
  const tip = $('#tooltip');
  $('#board').addEventListener('pointerover', (e) => {
    const f = e.target.closest('.field');
    // Auf Touch-Geräten öffnet ein Tipp die Detailansicht statt eines Tooltips
    if (!f || !view || e.pointerType !== 'mouse') return;
    const idx = Number(f.dataset.idx);
    tip.replaceChildren(deedCard(idx, view, view.rules));
    tip.hidden = false;
    const r = f.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 8) left = r.left - w - 10;
    if (left < 8) left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left));
    const top = Math.min(window.innerHeight - h - 8, Math.max(8, r.top + r.height / 2 - h / 2));
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  });
  $('#board').addEventListener('pointerout', (e) => {
    if (!e.relatedTarget || !e.relatedTarget.closest?.('.field')) tip.hidden = true;
  });
  $('#board').addEventListener('click', (e) => {
    const f = e.target.closest('.field');
    if (f && view) { tip.hidden = true; openFieldModal(Number(f.dataset.idx)); }
  });
  $('#board').addEventListener('keydown', (e) => {
    const f = e.target.closest('.field');
    if (f && view && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openFieldModal(Number(f.dataset.idx)); }
  });
  window.addEventListener('resize', positionAuction);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) stopTitleFlash(); });
}

export function resetGame() {
  view = null;
  queue.length = 0;
  lastLogId = 0;
  gameOverShown = false;
  $('#log').replaceChildren();
  board?.setHeatmap(null);
  heatOn = false;
  $('#btn-heat').setAttribute('aria-pressed', 'false');
  document.querySelector('.auction-panel')?.remove();
}

function selectTab(name) {
  for (const t of $$('.side-tabs .tab')) t.classList.toggle('active', t.dataset.tab === name);
  for (const p of $$('.side-tabs .tab-panel')) p.hidden = p.dataset.panel !== name;
  if (name === 'chat') $('#chat-dot').hidden = true;
}

/* ====================================================================== */
/* Zustands-Updates und Animationen                                       */
/* ====================================================================== */

export function onStateUpdate(msg) {
  if (!msg.state) return;
  queue.push(msg);
  if (!processing) processQueue();
}

async function processQueue() {
  processing = true;
  while (queue.length) {
    const msg = queue.shift();
    // Rückstand (z. B. Tab im Hintergrund): Animationen überspringen
    const fast = queue.length > 2 || document.hidden || msg.full;
    if (!view || msg.full) {
      initialSync(msg.state);
    } else {
      try {
        for (const ev of msg.events || []) await playEvent(ev, msg.state, fast);
      } catch (err) {
        console.error(err);
      }
      view = msg.state;
    }
    busy = false;
    render();
  }
  processing = false;
}

function initialSync(state) {
  view = state;
  for (const p of state.players) money[p.id] = p.money;
  board.syncTokens(state);
  board.setDice(state.turn?.dice);
  board.render(state);
  lastLogId = 0;
  $('#log').replaceChildren();
}

const nameOf = (pid) => view?.players.find((p) => p.id === pid)?.name ?? '?';

async function playEvent(ev, next, fast) {
  switch (ev.t) {
    case 'dice':
      await board.rollDice(ev.dice, fast);
      break;
    case 'move': {
      const inJail = Boolean(ev.direct && ev.to === POS.JAIL);
      await board.moveToken(ev.pid, ev.from, ev.to, ev.steps, { direct: ev.direct, inJail, fast });
      break;
    }
    case 'card':
      await board.showCard(ev, fast);
      break;
    case 'money':
      bumpMoney(ev.pid, ev.delta, fast);
      break;
    case 'buy':
    case 'auctionEnd':
      if (ev.pid) {
        if (!fast) sfx.buy();
        board.flash(ev.idx, view.players.find((p) => p.id === ev.pid)?.token);
        // Besitz sofort sichtbar machen
        board.render({ ...view, props: { ...view.props, [ev.idx]: next.props[ev.idx] }, pot: view.pot });
      }
      break;
    case 'build':
      if (!fast) sfx.build();
      board.render({ ...view, props: { ...view.props, [ev.idx]: next.props[ev.idx] } });
      break;
    case 'jail':
      if (!fast) sfx.jail();
      if (ev.pid === store.me) toast('Ab ins Gefängnis!', 'warn');
      break;
    case 'bid':
      if (!fast) sfx.bid();
      break;
    case 'debt':
      if (ev.pid === store.me) {
        sfx.error();
        toast(`Du musst ${eur(ev.amount)} zahlen. Beschaffe Geld oder erkläre Bankrott.`, 'warn', 6000);
      }
      break;
    case 'bankrupt':
      if (!fast) sfx.bankrupt();
      toast(`${nameOf(ev.pid)} ist bankrott.`, 'error');
      break;
    case 'jackpot':
      if (!fast) sfx.win();
      toast(`${nameOf(ev.pid)} knackt den Jackpot: ${eur(ev.amount)}!`);
      break;
    case 'tradeOffer':
      if (ev.to === store.me) {
        sfx.turn();
        toast(`${nameOf(ev.from)} bietet dir einen Handel an.`, 'info', 6000);
        flashTitle('Neues Handelsangebot');
      }
      break;
    case 'tradeDone':
      if (!fast) sfx.coin();
      if (ev.from === store.me || ev.to === store.me) toast('Handel abgeschlossen.');
      break;
    case 'tradeRejected':
      if (ev.from === store.me) toast(`${nameOf(ev.to)} lehnt deinen Handel ab.`, 'warn');
      break;
    case 'turn':
      board.setActive(ev.pid);
      if (ev.pid === store.me) {
        sfx.turn();
        toast('Du bist am Zug!');
        flashTitle('Du bist am Zug!');
      }
      break;
    case 'gameOver':
      sfx.win();
      break;
    default:
      break;
  }
}

/** Kontostand-Änderung: schwebende Zahl und Zähler */
function bumpMoney(pid, delta, fast) {
  const from = money[pid] ?? 0;
  money[pid] = from + delta;
  const card = document.querySelector(`.player[data-pid="${pid}"]`);
  if (!card) return;
  const node = card.querySelector('.money');
  animateNumber(node, from, money[pid], fast ? 1 : 650);
  node.classList.remove('up', 'down');
  node.classList.add(delta > 0 ? 'up' : 'down');
  setTimeout(() => node.classList.remove('up', 'down'), 900);
  if (!fast) {
    card.append(el('span', { class: `money-float ${delta > 0 ? 'plus' : 'minus'}`, text: `${delta > 0 ? '+' : '−'}${eur(Math.abs(delta))}` }));
    setTimeout(() => card.querySelector('.money-float')?.remove(), 1500);
    if (pid === store.me) (delta > 0 ? sfx.coin : sfx.pay)();
  }
}

function flashTitle(text) {
  if (!document.hidden) return;
  stopTitleFlash();
  const orig = 'BigYahuopoly';
  let on = false;
  titleFlash = setInterval(() => { document.title = (on = !on) ? `🎲 ${text}` : orig; }, 1000);
}
function stopTitleFlash() {
  clearInterval(titleFlash);
  titleFlash = null;
  document.title = 'BigYahuopoly';
}

/* ====================================================================== */
/* Rendering                                                              */
/* ====================================================================== */

function me() {
  return view?.players.find((p) => p.id === store.me) || null;
}

export function render() {
  if (!view) return;
  const s = view;
  $('#game-round').textContent = s.phase === 'over' ? 'Spielende' : `Runde ${s.round}`;
  $('#game-code').textContent = store.code;
  $('#spectator-badge').hidden = !store.spectator;
  const tradeOk = L.tradingAllowed(s, s.rules);
  $('#btn-trade').disabled = !tradeOk.ok || !me() || me().bankrupt || s.phase === 'over';
  $('#btn-trade').title = tradeOk.ok ? 'Handel anbieten' : tradeOk.reason;

  board.render(s);
  board.syncTokens(s, { animate: true });
  renderPlayers(s);
  renderAction(s);
  renderCenter(s);
  renderLog(s);
  renderMyProps(s);
  renderTrades(s);
  renderAuction(s);
  ensureTick();
  if (heatOn && s.turnNo !== lastHeatTurn) { lastHeatTurn = s.turnNo; refreshHeat(); }
  refreshStatsIfOpen();
  if (s.phase === 'over' && !gameOverShown) {
    gameOverShown = true;
    setTimeout(() => openStats(), 1200);
  }
}

/* --- Spielerleiste -------------------------------------------------------- */

function renderPlayers(s) {
  const box = $('#players');
  const ids = s.players.map((p) => p.id).join();
  if (box.dataset.ids !== ids) {
    box.dataset.ids = ids;
    box.replaceChildren(...s.players.map((p) => {
      const card = el('div', { class: 'player', dataset: { pid: p.id, token: p.token }, tabindex: 0, role: 'button' },
        avatar(p.token),
        el('div', { class: 'pinfo' }, el('div', { class: 'pname' }), el('div', { class: 'psub' })),
        el('div', { class: 'money num', text: eur(p.money) }));
      card.onclick = () => openPlayerModal(p.id);
      return card;
    }));
  }
  for (const p of s.players) {
    const card = box.querySelector(`[data-pid="${p.id}"]`);
    card.classList.toggle('active', p.id === s.currentPid && s.phase !== 'over');
    card.classList.toggle('bankrupt', p.bankrupt);
    const mem = member(p.id);
    card.querySelector('.pname').replaceChildren(
      el('span', { text: p.name }),
      p.id === store.me ? el('span', { class: 'badge badge-accent', text: 'Du' }) : null,
      p.id === store.room?.hostId ? el('span', { title: 'Host', text: '👑' }) : null);
    const groups = L.completedGroups(s, p.id).filter((g) => GROUPS[g].housePrice);
    const { houses, hotels } = L.buildingCount(s, p.id);
    const sub = card.querySelector('.psub');
    sub.replaceChildren(
      el('span', { class: `dot ${p.away ? 'away' : p.online || p.isBot ? 'on' : ''}`, title: p.away ? 'abwesend – KI spielt' : p.online || p.isBot ? 'online' : 'offline' }),
      p.isBot ? el('span', { text: 'KI' }) : null,
      p.away ? el('span', { class: 'badge badge-warn', text: 'KI übernimmt' }) : null,
      p.bankrupt ? el('span', { text: 'bankrott' }) : el('span', { text: `${L.ownedBy(s, p.id).length} ${L.ownedBy(s, p.id).length === 1 ? 'Feld' : 'Felder'}` }),
      houses || hotels ? el('span', { text: `🏠${houses}${hotels ? ` 🏨${hotels}` : ''}` }) : null,
      p.inJail ? el('span', { title: 'Im Gefängnis', text: '🔒' }) : null,
      p.jailCards.length ? el('span', { title: 'Gefängnis-Freikarte', text: `🎫${p.jailCards.length > 1 ? `×${p.jailCards.length}` : ''}` }) : null,
      groups.length ? el('span', { class: 'groups' }, groups.map((g) => el('i', { style: { background: GROUPS[g].color }, title: GROUPS[g].name }))) : null,
      isHost() && !p.isBot && !p.bankrupt && p.id !== store.me && (p.away || (!p.online && mem)) && s.phase !== 'over'
        ? el('button', { class: 'btn btn-danger btn-sm', text: 'Entfernen', title: 'Abwesenden Spieler aus dem Spiel nehmen', onclick: (e) => { e.stopPropagation(); kickAway(p); } })
        : null,
    );
    // Geld: während der Ereignisse animiert (bumpMoney), hier nur Abweichungen ausgleichen
    const mnode = card.querySelector('.money');
    if (money[p.id] === undefined) mnode.textContent = eur(p.money);
    else if (money[p.id] !== p.money) animateNumber(mnode, money[p.id], p.money, 500);
    money[p.id] = p.money;
  }
}

async function kickAway(p) {
  if (!(await confirmDialog(`${p.name} ist abwesend. Aus dem Spiel entfernen? Alle Grundstücke gehen an die Bank.`, 'Entfernen', true))) return;
  const r = await send('room:kick', { playerId: p.id });
  if (!r.ok) toast(r.error, 'error');
}

/* --- Aktionsbereich -------------------------------------------------------- */

async function act(event, data = {}) {
  if (busy) return;
  busy = true;
  renderAction(view);
  const r = await send(event, data);
  if (!r.ok) {
    busy = false;
    sfx.error();
    toast(r.error, 'error');
    renderAction(view);
  } else {
    // Falls kein Zustand mehr kommt (z. B. reine Verwaltung ohne Änderung)
    setTimeout(() => { if (busy && !processing) { busy = false; renderAction(view); } }, 1500);
  }
  return r;
}

function btn(label, event, opts = {}) {
  return el('button', {
    class: `btn ${opts.cls || 'btn-secondary'} ${opts.lg ? 'btn-lg' : ''}`,
    disabled: busy || opts.disabled,
    title: opts.title,
    onclick: opts.onclick || (() => act(event, opts.data)),
  }, label);
}

function timerBar(s) {
  if (!s.deadline) return null;
  return el('div', { class: 'timer-bar', dataset: { deadline: s.deadline, total: (s.rules.turnTimer || 60) * 1000 } }, el('div'));
}

function renderAction(s) {
  const panel = $('#action-panel');
  if (!s) return;
  const cur = s.players.find((p) => p.id === s.currentPid);
  const mine = me();
  const nodes = [];

  if (s.phase === 'over') {
    const w = s.players.find((p) => p.id === s.winner);
    nodes.push(el('div', { class: 'action-title' }, '🏆 ', `${w?.name ?? '?'} gewinnt!`));
    nodes.push(el('div', { class: 'action-row' },
      btn('Statistik ansehen', null, { cls: 'btn-primary', onclick: () => openStats() }),
      isHost() ? btn('Revanche', null, { onclick: () => rematch() }) : null));
    if (isHost()) nodes.push(el('div', { class: 'action-row' }, btn('Zurück zur Lobby', null, { cls: 'btn-ghost', onclick: () => backToLobby() })));
    else nodes.push(el('div', { class: 'action-sub', text: 'Der Host kann eine Revanche starten.' }));
    panel.replaceChildren(...nodes);
    return;
  }

  const myTurn = mine && !mine.bankrupt && s.currentPid === store.me;
  const debt = s.debt;

  if (s.phase === 'debt' && debt?.debtor === store.me) {
    const to = debt.creditor ? nameOf(debt.creditor) : 'die Bank';
    const liquid = L.liquidationValue(s, s.rules, store.me);
    nodes.push(el('div', { class: 'action-title' }, '⚠️ Zahlung fällig'));
    nodes.push(el('div', { class: 'action-sub', text: `Du schuldest ${to} ${eur(debt.amount)}${debt.meta?.text ? ` (${debt.meta.text})` : ''}. Bargeld: ${eur(mine.money)}.` }));
    nodes.push(el('div', { class: 'action-sub', text: mine.money >= debt.amount ? 'Du hast genug Geld.' : `Verkaufe Gebäude oder nimm Hypotheken auf (Tab „Besitz“). Maximal möglich: ${eur(liquid)}.` }));
    nodes.push(el('div', { class: 'action-row' },
      btn(`Bezahlen (${eur(debt.amount)})`, 'game:debt:pay', { cls: 'btn-primary', disabled: mine.money < debt.amount }),
      btn('Besitz verwalten', null, { onclick: () => selectTab('mine') })));
    nodes.push(el('div', { class: 'action-row' }, btn('Bankrott erklären', null, { cls: 'btn-danger', onclick: async () => {
      if (await confirmDialog(`Wirklich Bankrott erklären? Dein Vermögen geht an ${to}.`, 'Bankrott erklären', true)) act('game:bankrupt');
    } })));
    nodes.push(timerBar(s));
  } else if (myTurn && s.phase === 'roll') {
    nodes.push(el('div', { class: 'action-title' }, s.turn.doubles > 0 ? '🎲 Pasch! Nochmal würfeln' : '🎲 Du bist am Zug'));
    const b = btn('Würfeln', 'game:roll', { cls: 'btn-primary', lg: true });
    b.classList.add('pulse');
    nodes.push(el('div', { class: 'action-row' }, b));
    nodes.push(el('div', { class: 'action-sub', text: 'Vor dem Würfeln kannst du bauen, handeln und Hypotheken verwalten.' }));
    nodes.push(timerBar(s));
  } else if (myTurn && s.phase === 'jail') {
    nodes.push(el('div', { class: 'action-title' }, '🔒 Du sitzt im Gefängnis'));
    nodes.push(el('div', { class: 'action-sub', text: `Versuch ${mine.jailTurns + 1} von ${s.rules.maxJailTurns}: Würfle einen Pasch, zahle ${eur(s.rules.jailBail)} oder nutze eine Freikarte.` }));
    nodes.push(el('div', { class: 'action-row' },
      btn('Pasch würfeln', 'game:roll', { cls: 'btn-primary' }),
      btn(`Kaution ${eur(s.rules.jailBail)}`, 'game:jail:pay', { disabled: mine.money < s.rules.jailBail })));
    if (mine.jailCards.length) nodes.push(el('div', { class: 'action-row' }, btn('🎫 Freikarte nutzen', 'game:jail:card')));
    nodes.push(timerBar(s));
  } else if (myTurn && s.phase === 'buy') {
    const idx = s.pendingBuy;
    const f = BOARD[idx];
    nodes.push(el('div', { class: 'action-title' }, `${f.name} kaufen?`));
    nodes.push(el('div', { class: 'buy-card' }, miniDeed(idx), el('div', { class: 'action-sub' },
      el('div', { text: `Preis ${eur(f.price)} · dein Bargeld ${eur(mine.money)}` }),
      el('div', { text: s.rules.auctions ? 'Lehnst du ab, wird das Feld an alle versteigert.' : 'Lehnst du ab, bleibt das Feld bei der Bank.' }),
      mine.money < f.price ? el('div', { text: 'Zu wenig Bargeld – nimm vorher eine Hypothek auf.' }) : null)));
    nodes.push(el('div', { class: 'action-row' },
      btn(`Kaufen (${eur(f.price)})`, 'game:buy', { cls: 'btn-primary', disabled: mine.money < f.price }),
      btn(s.rules.auctions ? 'Versteigern' : 'Nicht kaufen', 'game:decline')));
    nodes.push(timerBar(s));
  } else if (myTurn && s.phase === 'end') {
    nodes.push(el('div', { class: 'action-title' }, '✅ Zug beenden'));
    nodes.push(el('div', { class: 'action-sub', text: 'Du kannst jetzt noch bauen, handeln oder Hypotheken verwalten.' }));
    nodes.push(el('div', { class: 'action-row' },
      btn('Zug beenden', 'game:endTurn', { cls: 'btn-primary', lg: true }),
      btn('Besitz', null, { onclick: () => selectTab('mine') })));
    nodes.push(timerBar(s));
  } else {
    // Zuschauen / andere sind dran
    const who = s.phase === 'debt' && debt ? nameOf(debt.debtor) : cur?.name;
    const what = {
      roll: 'würfelt …',
      jail: 'sitzt im Gefängnis und entscheidet …',
      buy: s.pendingBuy !== null ? `überlegt: ${BOARD[s.pendingBuy].name} kaufen?` : 'überlegt …',
      auction: 'Versteigerung läuft',
      debt: debt ? `muss ${eur(debt.amount)} aufbringen …` : 'muss zahlen …',
      end: 'beendet gleich den Zug …',
    }[s.phase] || '…';
    const p = s.phase === 'debt' && debt ? s.players.find((x) => x.id === debt.debtor) : cur;
    nodes.push(el('div', { class: 'action-title' }, p ? avatar(p.token, 'sm') : null, s.phase === 'auction' ? 'Versteigerung läuft' : `${who} ${what}`));
    if (store.spectator) nodes.push(el('div', { class: 'action-sub', text: 'Du schaust zu.' }));
    else if (mine?.bankrupt) nodes.push(el('div', { class: 'action-sub', text: 'Du bist ausgeschieden und schaust zu.' }));
    else if (s.phase !== 'auction') nodes.push(el('div', { class: 'action-sub', text: 'Du kannst jederzeit Handel anbieten und chatten.' }));
    nodes.push(timerBar(s));
  }
  panel.replaceChildren(...nodes.filter(Boolean));
}

function miniDeed(idx) {
  const f = BOARD[idx];
  const color = f.group ? GROUPS[f.group].color : '#5b6770';
  return el('div', { class: 'mini-deed' },
    el('div', { class: `band ${inkOn(color) === 'light' ? 'light' : ''}`, style: { background: color }, text: f.name }),
    el('div', { class: 'body' },
      f.type === 'street' ? el('div', { text: `Miete ${eur(f.rent[0])}` }) : null,
      f.type === 'street' ? el('div', { text: `Hotel ${eur(f.rent[5])}` }) : null,
      f.type === 'railroad' ? el('div', { text: '25–200 €' }) : null,
      f.type === 'utility' ? el('div', { text: '4×/10× Augen' }) : null,
      el('div', { class: 'muted', text: `Hyp. ${eur(f.mortgage)}` })));
}

async function rematch() {
  const r = await send('room:rematch');
  if (!r.ok) toast(r.error, 'error');
}

async function backToLobby() {
  const r = await send('room:lobby');
  if (!r.ok) toast(r.error, 'error');
}

/* --- Mitte des Bretts -------------------------------------------------------- */

function renderCenter(s) {
  const cur = s.players.find((p) => p.id === s.currentPid);
  if (s.phase === 'over') {
    const w = s.players.find((p) => p.id === s.winner);
    board.setStatus([w ? avatar(w.token) : null, `${w?.name} gewinnt!`]);
  } else if (cur) {
    board.setStatus([avatar(cur.token), cur.id === store.me ? 'Du bist am Zug' : `${cur.name} ist am Zug`]);
  }
}

/* --- Zug-Timer und Auktions-Countdown --------------------------------------- */

function ensureTick() {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    const now = serverNow();
    for (const bar of $$('.timer-bar')) {
      const deadline = Number(bar.dataset.deadline);
      const total = Number(bar.dataset.total);
      const left = Math.max(0, deadline - now);
      bar.firstChild.style.transform = `scaleX(${Math.min(1, left / total)})`;
      bar.classList.toggle('low', left < 10000);
      bar.title = `${Math.ceil(left / 1000)} s`;
    }
    const a = view?.auction;
    const ap = document.querySelector('.auction-panel');
    if (a && ap) {
      const left = Math.max(0, a.endsAt - now);
      const total = a.bids ? view.rules.auctionResetMs : view.rules.auctionStartMs;
      const bar = ap.querySelector('.timer-bar');
      bar.firstChild.style.transform = `scaleX(${Math.min(1, left / total)})`;
      bar.classList.toggle('low', left < 3000);
      ap.querySelector('.auction-time').textContent = `${Math.ceil(left / 1000)} s`;
    }
  }, 200);
}

/* --- Versteigerung ----------------------------------------------------------- */

function renderAuction(s) {
  let panel = document.querySelector('.auction-panel');
  const a = s.auction;
  if (s.phase !== 'auction' || !a) {
    panel?.remove();
    return;
  }
  const f = BOARD[a.idx];
  const mine = me();
  const canBid = mine && !mine.bankrupt && !a.passed.includes(store.me);
  const leader = a.bidder ? s.players.find((p) => p.id === a.bidder) : null;
  if (!panel || panel.dataset.idx !== String(a.idx)) {
    panel?.remove();
    panel = el('div', { class: 'auction-panel', role: 'dialog', 'aria-label': `Versteigerung ${f.name}`, dataset: { idx: a.idx } });
    document.body.append(panel);
    sfx.turn();
  }
  const bidNode = el('div', { class: 'auction-bid', text: a.bid ? eur(a.bid) : '—' });
  if (panel.dataset.bid && panel.dataset.bid !== String(a.bid)) bidNode.classList.add('bump');
  panel.dataset.bid = String(a.bid);

  const controls = [];
  if (canBid) {
    const isLeader = a.bidder === store.me;
    const incs = [1, 10, 50, 100];
    controls.push(el('div', { class: 'bid-row' }, incs.map((inc) => {
      const amount = Math.max(s.rules.auctionMinBid, a.bid + inc);
      return el('button', { class: 'btn btn-secondary', disabled: isLeader || amount > mine.money, onclick: () => bid(amount) }, `+${inc}`);
    })));
    const input = el('input', { class: 'input', type: 'number', min: a.bid + 1, max: mine.money, placeholder: `Gebot (mind. ${eur(a.bid + 1)})`, 'aria-label': 'Eigenes Gebot' });
    controls.push(el('div', { class: 'bid-custom' }, input,
      el('button', { class: 'btn btn-primary', disabled: isLeader, onclick: () => { const v = parseInt(input.value, 10); if (v) bid(v); } }, 'Bieten')));
    controls.push(el('button', { class: 'btn btn-ghost', disabled: isLeader, onclick: () => act('game:auction:pass') }, isLeader ? 'Du führst' : 'Aussteigen'));
    controls.push(el('div', { class: 'hint', text: `Dein Bargeld: ${eur(mine.money)}` }));
  } else {
    controls.push(el('div', { class: 'hint', text: mine && a.passed.includes(store.me) ? 'Du bist ausgestiegen.' : 'Du schaust zu.' }));
  }
  const keepInput = panel.querySelector('.bid-custom input');
  const typed = keepInput && document.activeElement === keepInput ? keepInput.value : null;
  panel.replaceChildren(
    el('div', { class: 'auction-head' }, miniDeed(a.idx), el('div', {},
      el('div', { class: 'muted', text: `Versteigerung · Listenpreis ${eur(f.price)}` }),
      bidNode,
      el('div', { class: 'auction-leader' }, leader ? avatar(leader.token, 'sm') : null, leader ? `${leader.name} führt` : 'Noch kein Gebot'))),
    el('div', { class: 'auction-bidders' }, s.players.filter((p) => !p.bankrupt).map((p) => {
      const av = avatar(p.token, 'sm');
      av.title = `${p.name}${a.passed.includes(p.id) ? ' (ausgestiegen)' : ''}`;
      if (a.passed.includes(p.id)) av.classList.add('out');
      return av;
    }), el('span', { class: 'muted auction-time', style: { marginLeft: 'auto' } })),
    el('div', { class: 'timer-bar' }, el('div')),
    ...controls,
  );
  if (typed !== null) {
    const inp = panel.querySelector('.bid-custom input');
    inp.value = typed;
    inp.focus();
  }
  positionAuction();
}

function positionAuction() {
  const panel = document.querySelector('.auction-panel');
  if (!panel) return;
  if (window.innerWidth <= 700) { panel.style.left = ''; panel.style.top = ''; return; }
  const r = $('#board-wrap').getBoundingClientRect();
  panel.style.left = `${r.left + r.width / 2}px`;
  panel.style.top = `${r.top + r.height / 2}px`;
}

async function bid(amount) {
  const r = await send('game:auction:bid', { amount });
  if (!r.ok) { sfx.error(); toast(r.error, 'error'); }
}

/* --- Verlauf --------------------------------------------------------------- */

function renderLog(s) {
  const list = $('#log');
  const fresh = s.log.filter((e) => e.id > lastLogId);
  if (!fresh.length) return;
  const atTop = list.parentElement.scrollTop < 30;
  for (const e of fresh) {
    list.prepend(el('li', { class: `k-${e.kind}`, text: e.text }));
    lastLogId = e.id;
  }
  while (list.children.length > 200) list.lastChild.remove();
  if (atTop) list.parentElement.scrollTop = 0;
}

/* --- Eigener Besitz -------------------------------------------------------- */

function renderMyProps(s) {
  const box = $('#my-props');
  const mine = me();
  if (!mine) {
    box.replaceChildren(el('p', { class: 'muted', text: 'Als Zuschauer hast du keinen Besitz.' }));
    return;
  }
  const owned = L.ownedBy(s, store.me);
  const nw = L.netWorth(s, store.me);
  const header = el('div', { class: 'action-sub', style: { marginBottom: '8px' } },
    `Vermögen ${eur(nw.total)} · Bank: ${s.rules.buildingLimit === 'unlimited' ? '∞' : s.bank.houses} Häuser, ${s.rules.buildingLimit === 'unlimited' ? '∞' : s.bank.hotels} Hotels`);
  if (!owned.length) {
    box.replaceChildren(header, el('p', { class: 'muted', text: 'Du besitzt noch keine Grundstücke.' }));
    return;
  }
  const groups = {};
  for (const i of owned) (groups[BOARD[i].group] ||= []).push(i);
  const nodes = [header];
  for (const [g, idxs] of Object.entries(groups)) {
    const full = L.ownsGroup(s, store.me, g);
    nodes.push(el('div', { class: 'prop-group' },
      el('h4', {}, el('i', { class: 'dot', style: { background: GROUPS[g].color } }), GROUPS[g].name, full && GROUPS[g].housePrice ? el('span', { class: 'badge badge-accent', text: 'komplett' }) : null,
        el('span', { class: 'muted', text: `${GROUP_MEMBERS[g].filter((i) => s.props[i].owner === store.me).length}/${GROUP_MEMBERS[g].length}` })),
      ...idxs.map((i) => propRow(s, i))));
  }
  box.replaceChildren(...nodes);
}

function propRow(s, i) {
  const f = BOARD[i];
  const pr = s.props[i];
  const R = s.rules;
  const status = pr.mortgaged ? 'Hypothek' : pr.houses === HOTEL_LEVEL ? 'Hotel' : pr.houses ? `${pr.houses} ${pr.houses === 1 ? 'Haus' : 'Häuser'}` : 'unbebaut';
  const actions = [];
  const mk = (label, event, check, title) => el('button', {
    class: 'btn btn-secondary', disabled: busy || !check.ok, title: check.ok ? title : check.reason,
    onclick: () => act(event, { idx: i }),
  }, label);
  if (f.type === 'street' && !pr.mortgaged) {
    actions.push(mk('+🏠', 'game:build', manageCheck(s, () => L.canBuild(s, R, store.me, i), false), `Haus bauen (${eur(f.housePrice)})`));
    if (pr.houses > 0) actions.push(mk('−🏠', 'game:sell', manageCheck(s, () => L.canSellBuilding(s, R, store.me, i), true), `Gebäude verkaufen (+${eur(Math.floor(f.housePrice * R.buildingSellRatio))})`));
  }
  if (pr.mortgaged) actions.push(mk('Ablösen', 'game:unmortgage', manageCheck(s, () => L.canUnmortgage(s, R, store.me, i), false), `Hypothek zurückzahlen (${eur(L.unmortgageCost(R, i))})`));
  else if (pr.houses === 0) actions.push(mk('Hypothek', 'game:mortgage', manageCheck(s, () => L.canMortgage(s, R, store.me, i), true), `Hypothek aufnehmen (+${eur(f.mortgage)})`));
  return el('div', { class: `prop-row ${pr.mortgaged ? 'mortgaged' : ''}` },
    el('span', { class: 'sw', style: { background: GROUPS[f.group].color } }),
    el('div', { class: 'pn' }, f.name, el('small', { text: `${status} · Miete ${eur(L.calcRent(s, R, i, 7))}${f.type === 'utility' ? ' (bei 7)' : ''}` })),
    el('div', { class: 'pa' }, actions));
}

/** Verwalten ist nur im eigenen Zug bzw. bei Schulden erlaubt (wie auf dem Server) */
function manageCheck(s, fn, raising) {
  const debtor = s.phase === 'debt' && s.debt?.debtor === store.me;
  if (debtor) return raising ? fn() : { ok: false, reason: 'Zahle zuerst deine Schulden.' };
  if (s.currentPid !== store.me) return { ok: false, reason: 'Nur während deines Zuges.' };
  const allowed = raising ? ['roll', 'jail', 'buy', 'end'] : ['roll', 'jail', 'end'];
  if (!allowed.includes(s.phase)) return { ok: false, reason: 'Gerade nicht möglich.' };
  return fn();
}

/* --- Modale: Feld, Spieler, Regeln, Menü ---------------------------------------- */

function openFieldModal(idx) {
  const s = view;
  const f = BOARD[idx];
  const m = modal({ title: f.name });
  m.box.style.width = 'min(380px, 100%)';
  const deed = deedCard(idx, s, s.rules);
  deed.style.borderRadius = '12px';
  deed.style.overflow = 'hidden';
  deed.style.border = '1px solid var(--border)';
  m.body.append(deed);
  const pr = s.props[idx];
  if (pr && pr.owner === store.me) {
    m.body.append(el('div', { style: { marginTop: '12px' } }, propRow(s, idx)));
  } else if (pr && pr.owner && me() && !me().bankrupt && L.tradingAllowed(s, s.rules).ok && L.isTradeable(s, idx)) {
    m.foot.append(el('button', { class: 'btn btn-secondary', text: 'Handel anbieten', onclick: () => { m.close(); openTradeModal({ to: pr.owner, getProps: [idx] }); } }));
  }
  m.foot.append(el('button', { class: 'btn btn-primary', text: 'Schließen', onclick: () => m.close() }));
}

function openPlayerModal(pid) {
  const s = view;
  const p = s.players.find((x) => x.id === pid);
  const m = modal({ title: p.name });
  const nw = L.netWorth(s, pid);
  m.body.append(el('div', { class: 'tiles' },
    tile('Bargeld', eur(p.money)), tile('Grundbesitz', eur(nw.property)), tile('Gebäude', eur(nw.buildings)), tile('Vermögen', eur(nw.total))));
  const owned = L.ownedBy(s, pid);
  const list = el('div', { style: { marginTop: '14px' } });
  if (!owned.length) list.append(el('p', { class: 'muted', text: 'Keine Grundstücke.' }));
  for (const i of owned) {
    const pr = s.props[i];
    list.append(el('div', { class: `prop-row ${pr.mortgaged ? 'mortgaged' : ''}` },
      el('span', { class: 'sw', style: { background: GROUPS[BOARD[i].group].color } }),
      el('div', { class: 'pn' }, BOARD[i].name, el('small', { text: pr.mortgaged ? 'Hypothek' : pr.houses === HOTEL_LEVEL ? 'Hotel' : pr.houses === 1 ? '1 Haus' : `${pr.houses} Häuser` })),
      el('div', { class: 'pa' })));
  }
  m.body.append(list);
  if (pid !== store.me && me() && !me().bankrupt && !p.bankrupt && L.tradingAllowed(s, s.rules).ok) {
    m.foot.append(el('button', { class: 'btn btn-secondary', text: `Handel mit ${p.name}`, onclick: () => { m.close(); openTradeModal({ to: pid }); } }));
  }
  if (isHost() && !p.isBot && !p.bankrupt && pid !== store.me && (p.away || !p.online) && s.phase !== 'over') {
    m.foot.append(el('button', { class: 'btn btn-danger', text: 'Aus dem Spiel entfernen', onclick: () => { m.close(); kickAway(p); } }));
  }
  m.foot.append(el('button', { class: 'btn btn-primary', text: 'Schließen', onclick: () => m.close() }));
}

export function tile(label, value, sub) {
  return el('div', { class: 'tile' }, el('div', { class: 'label', text: label }), el('div', { class: 'value', text: value }), sub ? el('div', { class: 'sub', text: sub }) : null);
}

export function openRulesOverview(rules) {
  if (!rules) return;
  const m = modal({ title: 'Regel-Übersicht' });
  const list = describeRules(rules);
  const sections = {};
  for (const r of list) (sections[r.section] ||= []).push(r);
  m.body.append(el('p', { class: 'muted', text: 'Hervorgehobene Regeln weichen vom Original ab. Die Regeln gelten für alle und sind während des Spiels fest.' }));
  for (const [sec, rows] of Object.entries(sections)) {
    m.body.append(el('div', { class: 'rules-section' }, el('h3', { text: sec }),
      ...rows.map((r) => el('div', { class: `rule-row ${r.changed ? 'changed' : ''}`, title: r.help },
        el('div', {}, el('div', { text: r.label }), el('small', { class: 'muted', text: r.help })),
        el('strong', { text: r.value })))));
  }
  const bonus = rules.playerBonus && Object.entries(rules.playerBonus);
  if (bonus?.length) {
    m.body.append(el('div', { class: 'rules-section' }, el('h3', { text: 'Startbonus' }),
      ...bonus.map(([pid, v]) => el('div', { class: 'rule-row changed' }, el('span', { text: member(pid)?.name || pid }), el('strong', { text: `+${eur(v)}` })))));
  }
  m.body.append(el('div', { class: 'rules-section' }, el('h3', { text: 'Grundregeln' }),
    el('ul', { class: 'muted' },
      el('li', { text: 'Pasch: noch einmal würfeln. Dreimal Pasch hintereinander: ab ins Gefängnis.' }),
      el('li', { text: 'Kaufst du ein freies Feld nicht, wird es versteigert (falls aktiv).' }),
      el('li', { text: 'Häuser nur mit kompletter Farbgruppe, Hotel nach 4 Häusern. Rückverkauf zum halben Preis.' }),
      el('li', { text: 'Hypothek: halber Kaufpreis; Rückzahlung mit Zinsen. Auf belasteten Feldern gibt es keine Miete.' }),
      el('li', { text: 'Wer nicht zahlen kann, ist bankrott. Das Vermögen geht an den Gläubiger oder die Bank.' }))));
  m.foot.append(el('button', { class: 'btn btn-primary', text: 'Schließen', onclick: () => m.close() }));
}

function openMenu(anchor) {
  const items = [{ label: 'Einladungslink kopieren', action: copyInvite }];
  const mine = me();
  if (mine && !mine.bankrupt && view?.phase !== 'over') {
    items.push({ label: 'Aufgeben', danger: true, action: async () => {
      if (!(await confirmDialog('Wirklich aufgeben? Deine Grundstücke gehen an die Bank.', 'Aufgeben', true))) return;
      const r = await send('game:resign');
      if (!r.ok) toast(r.error, 'error');
    } });
  }
  items.push({ label: 'Raum verlassen', action: async () => {
    if (mine && !mine.bankrupt && view?.phase !== 'over'
      && !(await confirmDialog('Raum verlassen? Nach 2 Minuten spielt die KI für dich weiter. Über den Link kannst du jederzeit zurückkehren.', 'Verlassen'))) return;
    await send('room:leave');
    document.dispatchEvent(new CustomEvent('mono:left'));
  } });
  popupMenu(anchor, items);
}

/* --- Heatmap ----------------------------------------------------------------- */

async function toggleHeat() {
  heatOn = !heatOn;
  $('#btn-heat').setAttribute('aria-pressed', String(heatOn));
  if (heatOn) await refreshHeat();
  else board.setHeatmap(null);
}

let heatPending = false;
async function refreshHeat(counts) {
  if (counts) { board.setHeatmap(counts); return; }
  if (heatPending) return;
  heatPending = true;
  const r = await send('stats:request');
  heatPending = false;
  if (r.ok && r.stats && heatOn) board.setHeatmap(r.stats.landings);
}

/** Heatmap von außen (Statistik-Screen) einschalten, optional für einen Spieler */
export function showHeatOnBoard(counts) {
  heatOn = true;
  $('#btn-heat').setAttribute('aria-pressed', 'true');
  board.setHeatmap(counts);
}

export const currentView = () => view;
export { selectTab, act };
