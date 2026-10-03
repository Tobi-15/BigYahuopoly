/**
 * Handel zwischen Spielern: Angebots-Dialog und Liste offener Angebote.
 * Der Server prüft jedes Angebot erneut (Besitz, Geld, Gebäude, Zinsen).
 */
import { BOARD, GROUPS } from '/shared/board.js';
import * as L from '/shared/logic.js';
import { el, $, eur, toast, modal } from './util.js';
import { send } from './net.js';
import { store } from './store.js';
import { avatar } from './lobby.js';

const view = () => store.state;
const pname = (pid) => view()?.players.find((p) => p.id === pid)?.name ?? '?';

/** Text für eine Handelsseite */
export function describeSide(side) {
  const parts = [
    ...side.props.map((i) => BOARD[i].name),
    side.money ? eur(side.money) : null,
    side.cards ? `${side.cards} Freikarte${side.cards > 1 ? 'n' : ''}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'nichts';
}

const sideValue = (side) => side.money + side.props.reduce((s, i) => s + BOARD[i].price, 0);

/**
 * Handelsdialog öffnen.
 * @param {object} [preset] { to, getProps, giveProps, giveMoney, getMoney, giveCards, getCards, counterOf }
 */
export function openTradeModal(preset = {}) {
  const s = view();
  if (!s || !store.me) return;
  const allowed = L.tradingAllowed(s, s.rules);
  if (!allowed.ok) { toast(allowed.reason, 'warn'); return; }
  const partners = s.players.filter((p) => p.id !== store.me && !p.bankrupt);
  if (!partners.length) { toast('Keine Handelspartner mehr.', 'warn'); return; }

  const st = {
    to: preset.to && partners.some((p) => p.id === preset.to) ? preset.to : partners[0].id,
    give: new Set(preset.giveProps || []),
    get: new Set(preset.getProps || []),
    giveMoney: preset.giveMoney || 0,
    getMoney: preset.getMoney || 0,
    giveCards: preset.giveCards || 0,
    getCards: preset.getCards || 0,
  };
  const m = modal({ title: preset.counterOf ? 'Gegenangebot' : 'Handel anbieten', wide: true });
  const sendBtn = el('button', { class: 'btn btn-primary', text: preset.counterOf ? 'Gegenangebot senden' : 'Angebot senden' });
  const summary = el('div', { class: 'hint', style: { marginRight: 'auto' } });
  m.foot.append(summary, el('button', { class: 'btn btn-ghost', text: 'Abbrechen', onclick: () => m.close() }), sendBtn);

  const draw = () => {
    const cur = view();
    const meP = cur.players.find((p) => p.id === store.me);
    const partner = cur.players.find((p) => p.id === st.to);
    const pick = el('div', { class: 'partner-pick' }, partners.map((p) => el('button', {
      type: 'button', dataset: { token: p.token }, 'aria-pressed': String(p.id === st.to), disabled: Boolean(preset.counterOf),
      onclick: () => { st.to = p.id; st.get.clear(); st.getMoney = 0; st.getCards = 0; draw(); },
    }, avatar(p.token, 'sm'), p.name)));
    const col = (title, owner, set, moneyKey, cardsKey) => {
      const props = L.ownedBy(cur, owner.id);
      return el('div', { class: 'trade-col' },
        el('h3', {}, avatar(owner.token, 'sm'), title),
        el('div', { class: 'trade-props' }, props.length ? props.map((i) => {
          const ok = L.isTradeable(cur, i);
          const cb = el('input', { type: 'checkbox', checked: set.has(i), disabled: !ok, onchange: (e) => { e.target.checked ? set.add(i) : set.delete(i); update(); } });
          const pr = cur.props[i];
          return el('label', { class: `trade-prop ${ok ? '' : 'disabled'}`, title: ok ? '' : 'Erst alle Gebäude der Farbgruppe verkaufen' },
            cb, el('span', { class: 'sw', style: { background: GROUPS[BOARD[i].group].color } }), BOARD[i].name,
            el('small', { text: pr.mortgaged ? 'Hypothek' : eur(BOARD[i].price) }));
        }) : el('p', { class: 'muted', text: 'Keine Grundstücke.' })),
        el('label', { class: 'trade-money' }, 'Geld',
          el('input', { class: 'input', type: 'number', min: 0, max: owner.money, step: 10, value: st[moneyKey], oninput: (e) => { st[moneyKey] = Math.max(0, parseInt(e.target.value, 10) || 0); update(); } }),
          el('span', { class: 'muted', text: `von ${eur(owner.money)}` })),
        owner.jailCards.length ? el('label', { class: 'trade-money' }, 'Freikarten',
          el('input', { class: 'input', type: 'number', min: 0, max: owner.jailCards.length, value: st[cardsKey], oninput: (e) => { st[cardsKey] = Math.max(0, Math.min(owner.jailCards.length, parseInt(e.target.value, 10) || 0)); update(); } }),
          el('span', { class: 'muted', text: `von ${owner.jailCards.length}` })) : null);
    };
    m.body.replaceChildren(
      el('div', { class: 'field-label', text: 'Handelspartner' }), pick,
      el('div', { class: 'trade-grid' },
        col('Du gibst', meP, st.give, 'giveMoney', 'giveCards'),
        col(`Du bekommst von ${partner.name}`, partner, st.get, 'getMoney', 'getCards')));
    update();
  };

  const offer = () => ({
    give: { props: [...st.give], money: st.giveMoney, cards: st.giveCards },
    get: { props: [...st.get], money: st.getMoney, cards: st.getCards },
  });

  const update = () => {
    const o = offer();
    const cur = view();
    const meP = cur.players.find((p) => p.id === store.me);
    const partner = cur.players.find((p) => p.id === st.to);
    let problem = null;
    if (!o.give.props.length && !o.give.money && !o.give.cards && !o.get.props.length && !o.get.money && !o.get.cards) problem = 'Wähle aus, was ihr tauscht.';
    else if (o.give.money > meP.money) problem = 'So viel Bargeld hast du nicht.';
    else if (o.get.money > partner.money) problem = `${partner.name} hat nicht so viel Bargeld.`;
    const fee = o.get.props.filter((i) => cur.props[i].mortgaged).reduce((sum, i) => sum + L.mortgageInterestFee(cur.rules, i), 0);
    summary.textContent = problem || `Wert: du gibst ~${eur(sideValue(o.give))}, du bekommst ~${eur(sideValue(o.get))}${fee ? ` · ${eur(fee)} Hypothekenzinsen fällig` : ''}`;
    sendBtn.disabled = Boolean(problem);
  };

  sendBtn.onclick = async () => {
    const o = offer();
    const r = preset.counterOf
      ? await send('trade:counter', { id: preset.counterOf, ...o })
      : await send('trade:offer', { to: st.to, ...o });
    if (!r.ok) return toast(r.error, 'error');
    toast(`Angebot an ${pname(st.to)} gesendet.`);
    m.close();
  };
  draw();
}

/** Liste offener Angebote im Tab „Handel“ */
export function renderTrades(s) {
  const box = $('#trade-list');
  const incoming = s.trades.filter((t) => t.to === store.me);
  const outgoing = s.trades.filter((t) => t.from === store.me);
  const others = s.trades.filter((t) => t.from !== store.me && t.to !== store.me);
  const count = $('#trade-count');
  count.hidden = !incoming.length;
  count.textContent = String(incoming.length);

  const nodes = [];
  const allowed = L.tradingAllowed(s, s.rules);
  const meP = s.players.find((p) => p.id === store.me);
  if (meP && !meP.bankrupt && s.phase !== 'over') {
    nodes.push(el('button', { class: 'btn btn-secondary btn-block', text: '⇄ Neues Angebot', disabled: !allowed.ok, title: allowed.reason || '', onclick: () => openTradeModal() }));
    if (!allowed.ok) nodes.push(el('p', { class: 'hint', text: allowed.reason }));
  }
  for (const t of incoming) {
    nodes.push(el('div', { class: 'trade-item' },
      el('strong', { text: `Angebot von ${pname(t.from)}` }),
      el('div', { class: 'tside' }, el('b', { text: 'Du erhältst:' }), describeSide(t.give)),
      el('div', { class: 'tside' }, el('b', { text: 'Du gibst:' }), describeSide(t.get)),
      el('div', { class: 'action-row' },
        el('button', { class: 'btn btn-primary btn-sm', text: 'Annehmen', disabled: s.phase === 'auction', onclick: () => respond('trade:accept', t.id) }),
        el('button', { class: 'btn btn-secondary btn-sm', text: 'Gegenangebot', onclick: () => openTradeModal({
          to: t.from, counterOf: t.id,
          giveProps: t.get.props, getProps: t.give.props,
          giveMoney: t.get.money, getMoney: t.give.money,
          giveCards: t.get.cards, getCards: t.give.cards,
        }) }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'Ablehnen', onclick: () => respond('trade:reject', t.id) }))));
  }
  for (const t of outgoing) {
    nodes.push(el('div', { class: 'trade-item' },
      el('strong', { text: `Dein Angebot an ${pname(t.to)}` }),
      el('div', { class: 'tside' }, el('b', { text: 'Du gibst:' }), describeSide(t.give)),
      el('div', { class: 'tside' }, el('b', { text: 'Du erhältst:' }), describeSide(t.get)),
      el('div', { class: 'action-row' }, el('span', { class: 'muted', text: 'Wartet auf Antwort …' }),
        el('button', { class: 'btn btn-ghost btn-sm', text: 'Zurückziehen', onclick: () => respond('trade:cancel', t.id) }))));
  }
  if (others.length) nodes.push(el('p', { class: 'muted', text: `${others.length} weitere${others.length > 1 ? '' : 's'} Angebot${others.length > 1 ? 'e' : ''} zwischen anderen Spielern.` }));
  if (!incoming.length && !outgoing.length && !others.length) nodes.push(el('p', { class: 'muted', text: 'Keine offenen Angebote.' }));
  box.replaceChildren(...nodes);
}

async function respond(event, id) {
  const r = await send(event, { id });
  if (!r.ok) toast(r.error, 'error');
}
