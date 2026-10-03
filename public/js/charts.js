/**
 * Leichte SVG-Diagramme ohne Bibliothek.
 *
 * Gestaltung: dünne Marken (2-px-Linien, Balken ≤ 24 px mit 4-px-Rundung am
 * Datenende), Haarlinien-Gitter, Legende ab 2 Reihen, Fadenkreuz-Tooltip mit
 * allen Reihen, Farben über CSS-Variablen (funktionieren im hellen und
 * dunklen Theme), animierte Übergänge. Beschriftungen nutzen Textfarben,
 * nie die Reihenfarbe.
 */
import { el } from './util.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  for (const c of kids.flat()) if (c) n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return n;
};

const fmtNum = (v) => Number(v).toLocaleString('de-DE');
export const fmtEur = (v) => `${fmtNum(Math.round(v))} €`;

/** Saubere Achsenteilung (0 / 500 / 1.000 …) */
function niceTicks(max, count = 5) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw);
  const ticks = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

function tooltip(container) {
  let tip = container.querySelector('.chart-tip');
  if (!tip) {
    tip = el('div', { class: 'chart-tip', role: 'status' });
    container.append(tip);
  }
  return {
    show(x, y, nodes) {
      tip.replaceChildren(...nodes);
      tip.classList.add('show');
      const cw = container.clientWidth;
      const w = tip.offsetWidth;
      const left = x + 14 + w > cw ? x - w - 14 : x + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${Math.max(0, y - 10)}px`;
    },
    hide() { tip.classList.remove('show'); },
  };
}

const tipRow = (color, label, value) => el('div', { class: 'tt-row' },
  el('span', { class: 'k', style: { background: color } }), el('span', { text: label }), el('b', { text: value }));

/**
 * Liniendiagramm.
 * @param {HTMLElement} container
 * @param {object} o
 * @param {number[]} o.x                 X-Werte (Runden)
 * @param {{id,name,color,values:number[]}[]} o.series
 * @param {{x,id,text,kind}[]} [o.markers] Ereignismarkierungen
 */
export function lineChart(container, { x, series, markers = [], yFormat = fmtEur, xLabel = 'Runde', height = 300, animate = true }) {
  container.classList.add('chart');
  container.querySelector('svg')?.remove();
  const W = Math.max(280, container.clientWidth || 600);
  const H = height;
  const m = { l: 62, r: series.length <= 4 ? 96 : 16, t: 12, b: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const maxY = Math.max(1, ...series.flatMap((sr) => sr.values));
  const ticks = niceTicks(maxY);
  const top = ticks[ticks.length - 1];
  const x0 = x[0];
  const x1 = x[x.length - 1] === x0 ? x0 + 1 : x[x.length - 1];
  const px = (v) => m.l + ((v - x0) / (x1 - x0)) * iw;
  const py = (v) => m.t + ih - (v / top) * ih;

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Liniendiagramm' });
  const grid = s('g');
  for (const t of ticks) {
    grid.append(s('line', { class: t === 0 ? 'axis' : 'gridline', x1: m.l, x2: W - m.r, y1: py(t), y2: py(t) }));
    grid.append(s('text', { class: 'tick', x: m.l - 8, y: py(t) + 4, 'text-anchor': 'end' }, yFormat(t)));
  }
  const xticks = x.length <= 12 ? x : x.filter((_, i) => i % Math.ceil(x.length / 10) === 0 || i === x.length - 1);
  for (const v of xticks) grid.append(s('text', { class: 'tick', x: px(v), y: H - m.b + 18, 'text-anchor': 'middle' }, String(v)));
  grid.append(s('text', { class: 'tick', x: W - m.r, y: H - 2, 'text-anchor': 'end' }, xLabel));
  svg.append(grid);

  // Linien
  const lines = s('g');
  for (const sr of series) {
    const d = sr.values.map((v, i) => `${i ? 'L' : 'M'}${px(x[i]).toFixed(1)},${py(v).toFixed(1)}`).join('');
    const path = s('path', { class: `line ${animate ? 'draw' : ''}`, d, style: `stroke:${sr.color}` });
    lines.append(path);
  }
  svg.append(lines);

  // Endpunkte und direkte Beschriftung (nur bei ≤ 4 Reihen und ohne Überlappung)
  const ends = series.map((sr) => ({ sr, x: px(x[sr.values.length - 1]), y: py(sr.values[sr.values.length - 1]) }));
  for (const e of ends) svg.append(s('circle', { class: 'end-dot', cx: e.x, cy: e.y, r: 4, style: `fill:${e.sr.color}` }));
  if (series.length <= 4) {
    const sorted = ends.slice().sort((a, b) => a.y - b.y);
    const collide = sorted.some((e, i) => i && e.y - sorted[i - 1].y < 13);
    if (!collide) for (const e of ends) svg.append(s('text', { class: 'end-label', x: e.x + 8, y: e.y + 4 }, e.sr.name));
  }

  // Ereignismarkierungen
  const markerNodes = [];
  for (const mk of markers) {
    const sr = series.find((x2) => x2.id === mk.id);
    if (!sr) continue;
    const i = x.indexOf(mk.x);
    if (i < 0) continue;
    const cx = px(mk.x);
    const cy = py(sr.values[i]);
    const shape = mk.kind === 'bankrupt'
      ? s('path', { class: 'marker', d: `M${cx - 5},${cy - 5}L${cx + 5},${cy + 5}M${cx + 5},${cy - 5}L${cx - 5},${cy + 5}`, style: `stroke:${sr.color};stroke-width:2.5` })
      : s('rect', { class: 'marker', x: cx - 4.5, y: cy - 4.5, width: 9, height: 9, transform: `rotate(45 ${cx} ${cy})`, style: `fill:${sr.color}` });
    svg.append(shape);
    markerNodes.push({ ...mk, cx, cy, sr });
  }

  // Fadenkreuz + Tooltip
  const cross = s('line', { class: 'crosshair', y1: m.t, y2: m.t + ih });
  svg.append(cross);
  const hit = s('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', tabindex: 0 });
  svg.append(hit);
  const tip = tooltip(container);
  const showAt = (i) => {
    const xv = x[i];
    const cx = px(xv);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.style.opacity = '1';
    const rows = series.map((sr) => ({ sr, v: sr.values[i] })).sort((a, b) => b.v - a.v);
    const notes = markerNodes.filter((mk) => mk.x === xv);
    const scale = container.clientWidth / W;
    tip.show(cx * scale, py(rows[0].v) * scale, [
      el('div', { class: 'tt-title', text: `${xLabel} ${xv}` }),
      ...rows.map((r) => tipRow(r.sr.color, r.sr.name, yFormat(r.v))),
      ...notes.map((n) => el('div', { class: 'tt-note', text: `${n.kind === 'bankrupt' ? '✕' : '◆'} ${n.sr.name}: ${n.text}` })),
    ]);
  };
  const nearest = (clientX) => {
    const r = svg.getBoundingClientRect();
    const vx = ((clientX - r.left) / r.width) * W;
    let best = 0;
    x.forEach((v, i) => { if (Math.abs(px(v) - vx) < Math.abs(px(x[best]) - vx)) best = i; });
    return best;
  };
  let focusIdx = x.length - 1;
  hit.addEventListener('pointermove', (e) => showAt((focusIdx = nearest(e.clientX))));
  hit.addEventListener('pointerleave', () => { cross.style.opacity = '0'; tip.hide(); });
  hit.addEventListener('focus', () => showAt(focusIdx));
  hit.addEventListener('blur', () => { cross.style.opacity = '0'; tip.hide(); });
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') showAt((focusIdx = Math.max(0, focusIdx - 1)));
    if (e.key === 'ArrowRight') showAt((focusIdx = Math.min(x.length - 1, focusIdx + 1)));
  });

  container.prepend(svg);
  if (animate) {
    for (const p of lines.querySelectorAll('path')) {
      const len = p.getTotalLength?.() || 1000;
      p.style.setProperty('--len', len);
    }
  }
}

/**
 * Horizontales Balkendiagramm (z. B. Top-10-Felder).
 * @param {{label, value, color?, note?}[]} items
 */
export function barChart(container, items, { valueFormat = fmtNum, color = 'var(--tok-hat)', animate = true } = {}) {
  container.classList.add('chart');
  container.querySelector('svg')?.remove();
  const W = Math.max(280, container.clientWidth || 500);
  const band = 30;
  const thick = 18;
  const labelW = Math.min(170, W * 0.38);
  const H = items.length * band + 8;
  const max = Math.max(1, ...items.map((i) => i.value));
  const iw = W - labelW - 56;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Balkendiagramm' });
  const tip = tooltip(container);
  svg.append(s('line', { class: 'axis', x1: labelW, x2: labelW, y1: 0, y2: H }));
  items.forEach((it, i) => {
    const y = i * band + (band - thick) / 2 + 4;
    const w = Math.max(2, (it.value / max) * iw);
    const r = Math.min(4, w / 2);
    // Rundung nur am Datenende (rechts), gerade an der Grundlinie
    const d = `M${labelW},${y}H${labelW + w - r}Q${labelW + w},${y} ${labelW + w},${y + r}V${y + thick - r}Q${labelW + w},${y + thick} ${labelW + w - r},${y + thick}H${labelW}Z`;
    const bar = s('path', { class: `bar ${animate ? 'grow-x' : ''}`, d, style: `fill:${it.color || color};animation-delay:${i * 40}ms`, tabindex: 0 });
    const show = () => {
      const scale = container.clientWidth / W;
      tip.show((labelW + w) * scale, y * scale, [el('div', { class: 'tt-title', text: it.label }), el('div', {}, el('b', { text: valueFormat(it.value) }), it.note ? ` ${it.note}` : '')]);
    };
    bar.addEventListener('pointerenter', show);
    bar.addEventListener('focus', show);
    bar.addEventListener('pointerleave', () => tip.hide());
    bar.addEventListener('blur', () => tip.hide());
    svg.append(
      s('text', { class: 'cat-label', x: labelW - 8, y: y + thick / 2 + 4, 'text-anchor': 'end' }, it.label),
      bar,
      s('text', { class: 'bar-label', x: labelW + w + 6, y: y + thick / 2 + 4 }, valueFormat(it.value)));
  });
  container.prepend(svg);
}

/**
 * Säulen-Histogramm (z. B. Würfelsummen 2–12).
 * @param {{label, value}[]} items
 */
export function histogram(container, items, { color = 'var(--tok-hat)', valueFormat = fmtNum, xLabel = '', expected = null, animate = true } = {}) {
  container.classList.add('chart');
  container.querySelector('svg')?.remove();
  const W = Math.max(280, container.clientWidth || 500);
  const H = 240;
  const m = { l: 40, r: 8, t: 18, b: 34 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const max = Math.max(1, ...items.map((i) => i.value), ...(expected || []));
  const ticks = niceTicks(max, 4);
  const top = ticks[ticks.length - 1];
  const bandW = iw / items.length;
  const thick = Math.min(24, bandW - 6);
  const py = (v) => m.t + ih - (v / top) * ih;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Histogramm' });
  for (const t of ticks) {
    svg.append(s('line', { class: t === 0 ? 'axis' : 'gridline', x1: m.l, x2: W - m.r, y1: py(t), y2: py(t) }));
    svg.append(s('text', { class: 'tick', x: m.l - 6, y: py(t) + 4, 'text-anchor': 'end' }, fmtNum(t)));
  }
  const tip = tooltip(container);
  items.forEach((it, i) => {
    const cx = m.l + bandW * i + bandW / 2;
    const h = Math.max(it.value ? 2 : 0, (it.value / top) * ih);
    const x = cx - thick / 2;
    const y = m.t + ih - h;
    const r = Math.min(4, h / 2, thick / 2);
    const d = h ? `M${x},${m.t + ih}V${y + r}Q${x},${y} ${x + r},${y}H${x + thick - r}Q${x + thick},${y} ${x + thick},${y + r}V${m.t + ih}Z` : '';
    if (d) {
      const bar = s('path', { class: `bar ${animate ? 'grow-y' : ''}`, d, style: `fill:${color};animation-delay:${i * 35}ms`, tabindex: 0 });
      const show = () => {
        const scale = container.clientWidth / W;
        tip.show(cx * scale, y * scale, [el('div', { class: 'tt-title', text: `${xLabel} ${it.label}` }), el('div', {}, el('b', { text: valueFormat(it.value) }),
          expected ? ` (erwartet ≈ ${fmtNum(Math.round(expected[i]))})` : '')]);
      };
      bar.addEventListener('pointerenter', show);
      bar.addEventListener('focus', show);
      bar.addEventListener('pointerleave', () => tip.hide());
      bar.addEventListener('blur', () => tip.hide());
      svg.append(bar);
      if (thick >= 14) svg.append(s('text', { class: 'bar-label', x: cx, y: y - 4, 'text-anchor': 'middle' }, fmtNum(it.value)));
    }
    if (expected) {
      const ey = py(expected[i]);
      svg.append(s('line', { x1: cx - thick / 2 - 3, x2: cx + thick / 2 + 3, y1: ey, y2: ey, style: 'stroke:var(--text-2);stroke-width:2;stroke-linecap:round' }));
    }
    svg.append(s('text', { class: 'tick', x: cx, y: H - m.b + 16, 'text-anchor': 'middle' }, it.label));
  });
  container.prepend(svg);
}
