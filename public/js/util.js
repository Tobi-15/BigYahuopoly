/**
 * Kleine DOM- und Format-Helfer.
 * Texte aus dem Netzwerk werden immer per textContent eingefügt (kein innerHTML).
 */

// Bedingtes Rendern: null/undefined/false in append()/prepend()/replaceChildren()
// ignorieren (statt sie als Text „null“ einzufügen).
for (const method of ['append', 'prepend', 'replaceChildren']) {
  const original = Element.prototype[method];
  Element.prototype[method] = function patched(...nodes) {
    return original.apply(this, nodes.flat().filter((n) => n !== null && n !== undefined && n !== false));
  };
}

/** Weiche Trennstellen in langen Straßennamen (Theater|straße, Schloss|allee …) */
export const hyphenate = (name) => name.replace(/([a-zäöü])(straße|allee|platz|bahnhof|werk|steuer|schaft)$/i, '$1\u00AD$2');

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Element erzeugen.
 * el('button', { class: 'btn', onclick: fn, dataset: { x: 1 }, text: 'Hi' }, child, …)
 * `svg` setzt vertrauenswürdiges, statisches SVG-Markup (nur eigene Icons).
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'svg') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const eur = (n) => `${Number(n || 0).toLocaleString('de-DE')} €`;

export function fmtDuration(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} Min.`;
  return `${Math.floor(m / 60)} Std. ${m % 60} Min.`;
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Lesbare Textfarbe auf einem Hintergrund */
export function inkOn(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.6 ? 'light' : 'dark';
}

/** Zahl animiert hoch-/runterzählen */
export function animateNumber(node, from, to, ms = 700, fmt = eur) {
  if (node._anim) cancelAnimationFrame(node._anim);
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    node.textContent = fmt(to);
    return;
  }
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    const e = 1 - (1 - p) ** 3;
    node.textContent = fmt(Math.round(from + (to - from) * e));
    if (p < 1) node._anim = requestAnimationFrame(step);
  };
  node._anim = requestAnimationFrame(step);
}

/* --- Toasts ------------------------------------------------------------- */
export function toast(text, kind = 'info', ms = 3800) {
  const root = $('#toasts');
  const t = el('div', { class: `toast ${kind}`, text });
  root.append(t);
  while (root.children.length > 4) root.firstChild.remove();
  setTimeout(() => {
    t.classList.add('out');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

/* --- Modale ------------------------------------------------------------- */
const openModals = [];

/**
 * @returns {{ root, body, foot, close }}
 */
export function modal({ title, wide = false, onClose, className = '' } = {}) {
  const body = el('div', { class: 'modal-body' });
  const foot = el('div', { class: 'modal-foot' });
  const closeBtn = el('button', { class: 'icon-btn', 'aria-label': 'Schließen', text: '✕' });
  const box = el('div', { class: `modal ${wide ? 'wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    el('div', { class: 'modal-head' }, el('h2', { text: title }), closeBtn),
    body, foot);
  const root = el('div', { class: 'modal-backdrop' }, box);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    root.remove();
    openModals.splice(openModals.indexOf(api), 1);
    onClose?.();
  };
  closeBtn.onclick = close;
  root.addEventListener('mousedown', (e) => { if (e.target === root) close(); });
  $('#modal-root').append(root);
  const api = { root, box, body, foot, close, setTitle: (t) => { $('h2', box).textContent = t; } };
  openModals.push(api);
  setTimeout(() => (box.querySelector('input, button:not(.icon-btn)') || closeBtn).focus(), 30);
  return api;
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openModals.length) openModals[openModals.length - 1].close();
});

export function confirmDialog(text, okLabel = 'OK', danger = false) {
  return new Promise((resolve) => {
    let result = false;
    const m = modal({ title: 'Bitte bestätigen', onClose: () => resolve(result) });
    m.body.append(el('p', { text }));
    m.foot.append(
      el('button', { class: 'btn btn-ghost', text: 'Abbrechen', onclick: () => m.close() }),
      el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, text: okLabel, onclick: () => { result = true; m.close(); } }),
    );
  });
}

export function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input', { class: 'input', value, maxlength: 30 });
    const m = modal({ title, onClose: () => resolve(result) });
    const submit = () => { result = input.value.trim() || null; m.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    m.body.append(el('label', { class: 'field-label', text: label }), input);
    m.foot.append(
      el('button', { class: 'btn btn-ghost', text: 'Abbrechen', onclick: () => m.close() }),
      el('button', { class: 'btn btn-primary', text: 'Speichern', onclick: submit }),
    );
  });
}

/** Kontextmenü an einem Element */
export function popupMenu(anchor, items) {
  document.querySelectorAll('.menu').forEach((m) => m.remove());
  const menu = el('div', { class: 'menu', role: 'menu' },
    items.map((it) => el('button', { class: it.danger ? 'danger' : '', role: 'menuitem', text: it.label, onclick: () => { menu.remove(); it.action(); } })));
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.top = `${r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - menu.offsetWidth - 8, r.right - menu.offsetWidth))}px`;
  setTimeout(() => {
    const off = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', off); } };
    document.addEventListener('mousedown', off);
  });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/** Sicherer Zugriff auf localStorage / sessionStorage */
export const storage = {
  get(key, fallback = null, area = 'local') {
    try {
      const v = (area === 'session' ? sessionStorage : localStorage).getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value, area = 'local') {
    try {
      (area === 'session' ? sessionStorage : localStorage).setItem(key, JSON.stringify(value));
    } catch { /* privates Fenster o. ä. */ }
  },
  remove(key, area = 'local') {
    try {
      (area === 'session' ? sessionStorage : localStorage).removeItem(key);
    } catch { /* ignorieren */ }
  },
};

/** Datei herunterladen */
export function download(filename, blobOrText, type = 'application/json') {
  const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
  const a = el('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/** Aktuelle Farbe einer CSS-Variable */
export const cssVar = (name, node = document.documentElement) => getComputedStyle(node).getPropertyValue(name).trim();
