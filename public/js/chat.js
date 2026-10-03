/**
 * Chat-Panel (Lobby und Spiel) und Emote-Reaktionen.
 */
import { el, $, $$, fmtTime, toast } from './util.js';
import { send } from './net.js';
import { store } from './store.js';
import { sfx } from './sound.js';

export const EMOTES = ['👏', '😂', '😡', '😱', '🎉', '👍', '😭', '🤑', '🔥', '🙈'];

/** Alle Chat-Container ([data-chat]) einmalig aufbauen */
export function mountChats() {
  for (const box of $$('[data-chat]')) {
    if (box.dataset.mounted) continue;
    box.dataset.mounted = '1';
    const list = el('ol', { class: 'chat-list' });
    const input = el('input', { class: 'input', maxlength: 300, placeholder: 'Nachricht …', 'aria-label': 'Chat-Nachricht' });
    const form = el('form', { class: 'chat-form' }, input, el('button', { class: 'btn btn-secondary', type: 'submit', text: 'Senden' }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      const r = await send('chat:message', { text });
      if (!r.ok) toast(r.error, 'error');
    });
    const emotes = el('div', { class: 'emotes', 'aria-label': 'Emotes' },
      EMOTES.map((e) => el('button', { type: 'button', text: e, title: `Reaktion ${e}`, onclick: () => sendEmote(e) })));
    box.append(list, emotes, form);
  }
  renderChat();
}

async function sendEmote(emote) {
  const r = await send('chat:emote', { emote });
  if (!r.ok) toast(r.error, 'error');
}

function msgNode(m) {
  if (m.system) return el('li', { class: 'chat-msg system', text: m.text });
  const from = el('span', { class: 'from', text: `${m.name}${m.spectator ? ' (Zuschauer)' : ''}:` });
  const mem = store.room?.members.find((x) => x.id === m.from);
  if (mem) from.style.color = `var(--tok-${mem.token})`;
  return el('li', { class: 'chat-msg' }, from, m.text, el('span', { class: 'time', text: fmtTime(m.ts) }));
}

export function renderChat() {
  for (const list of $$('.chat-list')) {
    list.replaceChildren(...store.chat.map(msgNode));
    list.scrollTop = list.scrollHeight;
  }
}

export function addChatMessage(m) {
  store.chat.push(m);
  if (store.chat.length > 100) store.chat.shift();
  for (const list of $$('.chat-list')) {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    list.append(msgNode(m));
    if (atBottom) list.scrollTop = list.scrollHeight;
  }
  if (!m.system && m.from !== store.me) {
    sfx.chat();
    const tab = $('.tab[data-tab="chat"]');
    if (tab && !tab.classList.contains('active')) $('#chat-dot').hidden = false;
  }
}

/** Emote über dem Avatar des Absenders (oder unten in der Mitte) schweben lassen */
export function showEmote({ from, name, emote }) {
  const layer = $('#emote-layer');
  const anchor = from && (document.querySelector(`.player[data-pid="${from}"] .avatar`) || document.querySelector(`.lobby-member[data-pid="${from}"] .avatar`));
  let x = window.innerWidth / 2;
  let y = window.innerHeight - 120;
  if (anchor) {
    const r = anchor.getBoundingClientRect();
    x = r.left + r.width / 2;
    y = r.top;
  }
  x += (Math.random() - 0.5) * 30;
  const node = el('div', { class: 'emote-float', style: { left: `${x - 24}px`, top: `${y - 30}px` } }, emote, el('small', { text: name }));
  layer.append(node);
  setTimeout(() => node.remove(), 2500);
}
