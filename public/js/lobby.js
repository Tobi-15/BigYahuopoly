/**
 * Startseite (Raum erstellen/beitreten) und Lobby (Spieler, Bots, Hausregeln).
 */
import { el, $, toast, copyText, storage, eur, confirmDialog, promptDialog, modal } from './util.js';
import { send, saveSession, storedSession, tabSession } from './net.js';
import { store, isHost, emitStore } from './store.js';
import { TOKENS, getToken } from '/shared/tokens.js';
import { RULE_DEFS, PRESETS, DEFAULT_RULES, isRuleActive, formatRuleValue, matchPreset } from '/shared/rules.js';
import { TOKEN_ICONS } from './icons.js';

const LEVELS = { easy: 'Leicht', medium: 'Mittel', hard: 'Schwer' };

export function avatar(token, size = '') {
  return el('span', { class: `avatar ${size}`, dataset: { token }, svg: TOKEN_ICONS[token] || '' });
}

export const inviteLink = (code) => `${location.origin}/r/${code}`;

/* ====================================================================== */
/* Startseite                                                             */
/* ====================================================================== */

let homeToken = null;
let takenTokens = [];
let peekTimer = null;

export function initHome() {
  const profile = storage.get('mono.profile', {});
  const nameInput = $('#home-name');
  nameInput.value = profile.name || '';
  homeToken = profile.token || TOKENS[0].id;
  renderTokenPicker();

  const codeInput = $('#home-code');
  const urlCode = location.pathname.match(/^\/r\/([A-Za-z0-9]{4})/)?.[1];
  if (urlCode) codeInput.value = urlCode.toUpperCase();
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(peek, 250);
  });
  codeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(false); });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') (codeInput.value.length === 4 ? join(false) : create()); });
  $('#btn-create').onclick = create;
  $('#btn-join').onclick = () => join(false);
  $('#btn-spectate').onclick = () => join(true);
  renderResume();
}

export function renderResume() {
  const box = $('#resume-box');
  const last = !tabSession() && storedSession();
  if (!last) { box.hidden = true; return; }
  box.hidden = false;
  box.replaceChildren(
    el('div', {}, el('strong', { text: `Raum ${last.code}` }), el('div', { class: 'muted', text: `Du warst zuletzt als ${last.name || 'Spieler'} dabei.` })),
    el('button', { class: 'btn btn-primary btn-sm', text: 'Zurückkehren', onclick: () => emitStore('rejoin', { ...last, force: false, manual: true }) }),
  );
}

function renderTokenPicker() {
  const box = $('#home-tokens');
  box.replaceChildren(...TOKENS.map((t) => {
    const taken = takenTokens.includes(t.id);
    return el('button', {
      class: 'token-option', role: 'radio', type: 'button', dataset: { token: t.id },
      'aria-checked': String(homeToken === t.id), disabled: taken, title: taken ? `${t.name} ist schon vergeben` : t.name,
      onclick: () => { homeToken = t.id; renderTokenPicker(); },
    }, avatar(t.id), el('span', { text: t.name }));
  }));
}

/** Nach dem Verbindungsaufbau prüfen, welche Figuren im Raum schon vergeben sind */
export function peekIfCode() {
  if ($('#home-code').value.length === 4) peek();
}

async function peek() {
  const code = $('#home-code').value;
  const info = $('#join-info');
  if (code.length !== 4) {
    takenTokens = [];
    info.textContent = '';
    renderTokenPicker();
    return;
  }
  const r = await send('room:peek', { code });
  if (!r.ok || !r.exists) {
    info.textContent = r.ok ? 'Diesen Raum gibt es nicht.' : r.error;
    takenTokens = [];
  } else {
    takenTokens = r.taken;
    const status = { lobby: 'wartet in der Lobby', playing: 'Spiel läuft – nur Zuschauen möglich', over: 'Spiel beendet' }[r.status];
    info.textContent = `Raum ${code}: ${r.players}/${r.maxPlayers} Spieler, ${status}.`;
    if (takenTokens.includes(homeToken)) homeToken = TOKENS.find((t) => !takenTokens.includes(t.id))?.id ?? homeToken;
  }
  renderTokenPicker();
}

function readProfile() {
  const name = $('#home-name').value.trim();
  if (!name) {
    toast('Bitte gib zuerst deinen Namen ein.', 'warn');
    $('#home-name').focus();
    return null;
  }
  storage.set('mono.profile', { name, token: homeToken });
  return { name, token: homeToken };
}

async function create() {
  const p = readProfile();
  if (!p) return;
  const r = await send('room:create', p);
  if (!r.ok) return toast(r.error, 'error');
  enterRoom({ code: r.code, playerId: r.playerId, secret: r.secret, name: p.name });
}

async function join(spectator) {
  const code = $('#home-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    toast('Bitte gib den 4-stelligen Raumcode ein.', 'warn');
    $('#home-code').focus();
    return;
  }
  if (spectator) {
    const name = $('#home-name').value.trim() || 'Zuschauer';
    const r = await send('room:join', { code, name, spectator: true });
    if (!r.ok) return toast(r.error, 'error');
    enterRoom({ code: r.code, spectator: true, name });
    return;
  }
  const p = readProfile();
  if (!p) return;
  const r = await send('room:join', { code, ...p });
  if (!r.ok) {
    if (r.code === 'GAME_RUNNING') {
      if (await confirmDialog('Das Spiel läuft bereits. Möchtest du zuschauen?', 'Zuschauen')) join(true);
      return;
    }
    toast(r.error, 'error');
    peek();
    return;
  }
  enterRoom({ code: r.code, playerId: r.playerId, secret: r.secret, name: p.name });
}

/** Nach erfolgreichem Beitritt: Sitzung merken, URL setzen */
export function enterRoom(sess) {
  store.code = sess.code;
  store.me = sess.playerId || null;
  store.spectator = Boolean(sess.spectator);
  saveSession(sess);
  history.replaceState(null, '', `/r/${sess.code}`);
  emitStore('route');
}

/* ====================================================================== */
/* Lobby                                                                  */
/* ====================================================================== */

let rulesFormState = { built: false, editable: null };
let botLevel = 'medium';
let pendingRules = null;
let rulesTimer = null;

export function initLobby() {
  $('#lobby-code').onclick = copyInvite;
  $('#btn-copy-link').onclick = copyInvite;
  $('#btn-lobby-leave').onclick = async () => {
    await send('room:leave');
    emitStore('left');
  };
  $('#btn-ready').onclick = async () => {
    const me = store.room.members.find((m) => m.id === store.me);
    const r = await send('room:ready', { ready: !me?.ready });
    if (!r.ok) toast(r.error, 'error');
  };
  $('#btn-start').onclick = async () => {
    const r = await send('room:start');
    if (!r.ok) toast(r.error, 'error');
  };
}

export async function copyInvite() {
  const ok = await copyText(inviteLink(store.code));
  toast(ok ? `Link kopiert: ${inviteLink(store.code)}` : `Einladungslink: ${inviteLink(store.code)}`);
}

export function renderLobby() {
  const room = store.room;
  if (!room) return;
  const host = isHost();
  $('#lobby-code').textContent = room.code;
  const members = room.members;
  $('#lobby-count').textContent = `${members.length}/${room.settings.maxPlayers}`;
  $('#lobby-spectators').textContent = room.spectators ? `${room.spectators} Zuschauer` : '';

  // Maximale Spielerzahl
  const maxWrap = $('#lobby-max-wrap');
  if (host) {
    const sel = el('select', { class: 'select input-sm', 'aria-label': 'Maximale Spielerzahl', onchange: async (e) => {
      const r = await send('room:settings:update', { maxPlayers: Number(e.target.value) });
      if (!r.ok) { toast(r.error, 'error'); renderLobby(); }
    } }, [2, 3, 4, 5, 6].map((n) => el('option', { value: n, text: `${n} Spieler`, selected: n === room.settings.maxPlayers, disabled: n < members.length })));
    maxWrap.replaceChildren(el('span', { text: 'Max.' }), sel);
  } else {
    maxWrap.replaceChildren();
  }

  // Spielerliste
  const list = $('#lobby-list');
  const items = members.map((m) => memberRow(m, host, room));
  for (let i = members.length; i < room.settings.maxPlayers; i++) {
    items.push(el('li', { class: 'slot-empty', text: 'Freier Platz – warte auf Mitspieler oder füge eine KI hinzu' }));
  }
  list.replaceChildren(...items);

  // KI-Werkzeuge
  const tools = $('#lobby-bot-tools');
  if (host) {
    const level = el('select', { class: 'select input-sm', 'aria-label': 'KI-Stufe', onchange: (e) => { botLevel = e.target.value; } },
      Object.entries(LEVELS).map(([k, v]) => el('option', { value: k, text: `KI: ${v}`, selected: k === botLevel })));
    const full = members.length >= room.settings.maxPlayers;
    tools.replaceChildren(
      level,
      el('button', { class: 'btn btn-secondary btn-sm', text: '+ KI hinzufügen', disabled: full, onclick: async () => {
        const r = await send('room:bot:add', { level: level.value });
        if (!r.ok) toast(r.error, 'error');
      } }),
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Mit KI auffüllen', disabled: full, onclick: async () => {
        const r = await send('room:bot:fill', { level: level.value });
        if (!r.ok) toast(r.error, 'error');
      } }),
    );
  } else {
    tools.replaceChildren();
  }

  // Bereit / Start
  const me = members.find((m) => m.id === store.me);
  const readyBtn = $('#btn-ready');
  const startBtn = $('#btn-start');
  const hint = $('#start-hint');
  readyBtn.hidden = host || !me;
  startBtn.hidden = !host;
  if (me && !host) {
    readyBtn.textContent = me.ready ? '✓ Bereit' : 'Ich bin bereit';
    readyBtn.className = `btn btn-lg ${me.ready ? 'btn-primary' : 'btn-secondary'}`;
  }
  const notReady = members.filter((m) => !m.isBot && m.id !== room.hostId && !m.ready);
  const enough = members.length >= 2;
  startBtn.disabled = !enough || notReady.length > 0;
  if (store.spectator) hint.textContent = 'Du schaust zu. Das Spiel startet, sobald der Host es freigibt.';
  else if (!enough) hint.textContent = 'Mindestens 2 Spieler nötig (KI zählt mit).';
  else if (notReady.length) hint.textContent = `Warte auf: ${notReady.map((m) => m.name).join(', ')}`;
  else hint.textContent = host ? 'Alle bereit – los geht’s!' : 'Alle bereit. Der Host startet das Spiel.';
  startBtn.classList.toggle('pulse', !startBtn.disabled);

  renderRules(room.rules, host);
}

function memberRow(m, host, room) {
  const isMe = m.id === store.me;
  const meta = el('div', { class: 'meta' },
    el('span', { class: `dot ${m.online ? 'on' : ''}`, title: m.online ? 'online' : 'offline' }),
    m.id === room.hostId ? el('span', { class: 'badge badge-accent', text: '👑 Host' }) : null,
    m.isBot ? el('span', { class: 'badge', text: `KI · ${LEVELS[m.botLevel]}` }) : null,
    !m.isBot && m.id !== room.hostId ? el('span', { class: `badge ${m.ready ? 'badge-accent' : ''}`, text: m.ready ? '✓ bereit' : 'nicht bereit' }) : null,
    room.rules.playerBonus?.[m.id] ? el('span', { class: 'badge badge-warn', text: `+${eur(room.rules.playerBonus[m.id])} Bonus` }) : null,
  );
  const av = avatar(m.token);
  if (isMe) {
    av.style.cursor = 'pointer';
    av.title = 'Figur ändern';
    av.onclick = () => chooseToken(room);
  }
  const tools = el('div', { class: 'tools' });
  if (host && m.isBot) {
    tools.append(el('select', { class: 'select input-sm', 'aria-label': 'KI-Stufe', onchange: async (e) => {
      const r = await send('room:bot:level', { playerId: m.id, level: e.target.value });
      if (!r.ok) toast(r.error, 'error');
    } }, Object.entries(LEVELS).map(([k, v]) => el('option', { value: k, text: v, selected: k === m.botLevel }))));
  }
  if (host && !m.isBot) {
    const bonus = el('select', { class: 'select input-sm bonus', title: 'Startbonus für Neulinge', 'aria-label': `Startbonus für ${m.name}`, onchange: (e) => {
      const pb = { ...(room.rules.playerBonus || {}) };
      const v = Number(e.target.value);
      if (v > 0) pb[m.id] = v; else delete pb[m.id];
      pushRules({ ...room.rules, playerBonus: pb });
    } }, [0, 100, 200, 300, 500, 750, 1000].map((v) => el('option', { value: v, text: v ? `+${v} €` : 'Bonus', selected: (room.rules.playerBonus?.[m.id] || 0) === v })));
    tools.append(bonus);
  }
  if (host && !isMe) {
    tools.append(el('button', { class: 'btn btn-ghost btn-sm', title: 'Entfernen', 'aria-label': `${m.name} entfernen`, text: '✕', onclick: async () => {
      if (!m.isBot && !(await confirmDialog(`${m.name} aus dem Raum entfernen?`, 'Entfernen', true))) return;
      const r = await send('room:kick', { playerId: m.id });
      if (!r.ok) toast(r.error, 'error');
    } }));
  }
  return el('li', { class: `lobby-member ${isMe ? 'me' : ''}`, dataset: { pid: m.id } },
    av,
    el('div', { class: 'who' }, el('span', { class: 'name', text: `${m.name}${isMe ? ' (Du)' : ''}` }), meta),
    tools);
}

function chooseToken(room) {
  const taken = room.members.filter((m) => m.id !== store.me).map((m) => m.token);
  const md = modal({ title: 'Figur wählen' });
  md.body.append(el('div', { class: 'token-picker' }, TOKENS.map((t) => el('button', {
    class: 'token-option', type: 'button', dataset: { token: t.id }, disabled: taken.includes(t.id),
    onclick: async () => {
      const r = await send('room:token', { token: t.id });
      if (!r.ok) toast(r.error, 'error');
      else storage.set('mono.profile', { ...storage.get('mono.profile', {}), token: t.id });
      md.close();
    },
  }, avatar(t.id), el('span', { text: t.name })))));
}

/* --- Hausregeln ------------------------------------------------------------ */

function pushRules(rules) {
  pendingRules = rules;
  clearTimeout(rulesTimer);
  rulesTimer = setTimeout(async () => {
    const r = await send('room:rules:update', { rules: pendingRules });
    pendingRules = null;
    if (!r.ok) {
      toast(r.error, 'error');
      rulesFormState.built = false;
      renderLobby();
    }
  }, 180);
}

const customPresets = () => storage.get('mono.customPresets', []);

function renderRules(rules, editable) {
  $('#rules-host-hint').textContent = editable ? 'Du bist Host und legst die Regeln fest.' : 'Nur der Host kann die Regeln ändern.';

  // Presets
  const active = matchPreset(rules);
  const bar = $('#preset-bar');
  bar.replaceChildren(
    ...Object.entries(PRESETS).map(([id, p]) => el('button', {
      class: 'preset', type: 'button', 'aria-pressed': String(active === id), disabled: !editable,
      onclick: () => pushRules({ ...p.rules, playerBonus: rules.playerBonus || {} }),
    }, el('strong', { text: p.name }), el('span', { text: p.description }))),
    el('button', {
      class: 'preset', type: 'button', 'aria-pressed': String(!active), disabled: !editable,
      title: 'Aktuelle Einstellungen als eigenes Preset speichern',
      onclick: async () => {
        const name = await promptDialog('Eigene Regeln speichern', 'Name für dein Preset', 'Meine Regeln');
        if (!name) return;
        const { playerBonus, ...r } = rules;
        const list = customPresets().filter((x) => x.name !== name);
        list.push({ name, rules: r });
        storage.set('mono.customPresets', list);
        toast(`Preset „${name}“ gespeichert.`);
        renderRules(rules, editable);
      },
    }, el('strong', { text: 'Eigene Regeln' }), el('span', { text: active ? 'Aktuelle Einstellungen speichern' : 'Geänderte Regeln – hier speichern' })),
  );

  const cp = $('#custom-presets');
  const saved = customPresets();
  cp.replaceChildren(...(saved.length ? [el('span', { class: 'muted', text: 'Gespeichert:' })] : []), ...saved.map((p) => el('span', { class: 'chip' },
    el('span', { text: p.name }),
    editable ? el('button', { type: 'button', title: 'Laden', text: '↺', onclick: () => pushRules({ ...DEFAULT_RULES, ...p.rules, playerBonus: rules.playerBonus || {} }) }) : null,
    el('button', { type: 'button', title: 'Löschen', text: '✕', onclick: () => {
      storage.set('mono.customPresets', customPresets().filter((x) => x.name !== p.name));
      renderRules(rules, editable);
    } }),
  )));

  const form = $('#rules-form');
  if (!rulesFormState.built || rulesFormState.editable !== editable) {
    buildRulesForm(form, editable);
    rulesFormState = { built: true, editable };
  }
  syncRulesForm(form, pendingRules || rules, editable);
}

function buildRulesForm(form, editable) {
  const sections = {};
  for (const [key, def] of Object.entries(RULE_DEFS)) {
    if (def.type === 'map') continue; // Startbonus wird in der Spielerliste gesetzt
    const sec = (sections[def.section] ||= el('div', { class: 'rules-section' }, el('h3', { text: def.section })));
    const info = el('span', { class: 'info', tabindex: 0, text: 'i', 'aria-label': def.help, dataset: { help: def.help } });
    const label = el('label', { class: 'rule-label', for: `rule-${key}` }, el('span', { text: def.label }), info);
    let control;
    if (!editable) {
      control = el('span', { class: 'rule-value', dataset: { key } });
    } else if (def.type === 'bool') {
      const input = el('input', { type: 'checkbox', id: `rule-${key}`, dataset: { key } });
      input.addEventListener('change', () => updateRule(key, input.checked));
      control = el('label', { class: 'switch' }, input, el('span'));
    } else if (def.type === 'int') {
      const input = el('input', { type: 'range', id: `rule-${key}`, min: def.min, max: def.max, step: def.step, dataset: { key } });
      const val = el('span', { class: 'val' });
      input.addEventListener('input', () => {
        val.textContent = formatRuleValue(key, Number(input.value));
        updateRule(key, Number(input.value));
      });
      control = el('span', { class: 'rule-control' }, input, val);
    } else if (def.type === 'enum') {
      const seg = el('div', { class: 'seg', role: 'group', 'aria-label': def.label, dataset: { key } },
        def.options.map((o) => el('button', { type: 'button', dataset: { value: JSON.stringify(o) }, text: def.optionLabels?.[o] ?? String(o), onclick: () => updateRule(key, o) })));
      control = seg;
    }
    sec.append(el('div', { class: 'rule-row', dataset: { row: key } }, label, el('div', { class: 'rule-control' }, control)));
  }
  form.replaceChildren(...Object.values(sections));
  attachHelp(form);
}

function updateRule(key, value) {
  const base = pendingRules || store.room.rules;
  const next = { ...base, [key]: value };
  syncRulesForm($('#rules-form'), next, true);
  pushRules(next);
}

function syncRulesForm(form, rules, editable) {
  for (const [key, def] of Object.entries(RULE_DEFS)) {
    const row = form.querySelector(`[data-row="${key}"]`);
    if (!row) continue;
    row.hidden = !isRuleActive(key, rules);
    row.classList.toggle('changed', JSON.stringify(rules[key]) !== JSON.stringify(def.default));
    if (!editable) {
      row.querySelector('.rule-value').textContent = formatRuleValue(key, rules[key]);
      continue;
    }
    if (def.type === 'bool') {
      const input = row.querySelector('input');
      input.checked = rules[key];
    } else if (def.type === 'int') {
      const input = row.querySelector('input');
      if (document.activeElement !== input) input.value = rules[key];
      row.querySelector('.val').textContent = formatRuleValue(key, rules[key]);
    } else if (def.type === 'enum') {
      for (const b of row.querySelectorAll('.seg button')) b.setAttribute('aria-pressed', String(b.dataset.value === JSON.stringify(rules[key])));
    }
  }
}

/** Tooltips für (i)-Symbole */
export function attachHelp(root) {
  let pop = null;
  const show = (target) => {
    hide();
    pop = el('div', { class: 'help-pop', role: 'tooltip', text: target.dataset.help });
    document.body.append(pop);
    const r = target.getBoundingClientRect();
    const left = Math.min(window.innerWidth - pop.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - pop.offsetWidth / 2));
    const top = r.top - pop.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - pop.offsetHeight - 8;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
  };
  const hide = () => { pop?.remove(); pop = null; };
  for (const i of root.querySelectorAll('[data-help]')) {
    i.addEventListener('mouseenter', () => show(i));
    i.addEventListener('mouseleave', hide);
    i.addEventListener('focus', () => show(i));
    i.addEventListener('blur', hide);
    i.addEventListener('click', (e) => { e.preventDefault(); pop ? hide() : show(i); });
  }
}

export function resetLobby() {
  rulesFormState = { built: false, editable: null };
  pendingRules = null;
}

export { getToken };
