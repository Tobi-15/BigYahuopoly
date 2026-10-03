/**
 * Statistik-Screen (Spielende und Live-Statistik während des Spiels).
 * Daten kommen vom Server (stats:update bzw. stats:request).
 */
import { BOARD, GROUPS } from '/shared/board.js';
import { el, $, eur, toast, modal, fmtDuration, fmtTime, download, cssVar } from './util.js';
import { send } from './net.js';
import { store, isHost } from './store.js';
import { avatar } from './lobby.js';
import { lineChart, barChart, histogram, fmtEur } from './charts.js';
import { gridPos } from './board.js';
import { TROPHY } from './icons.js';
import { showHeatOnBoard, tile } from './game.js';

let open = null; // { modal, final }
const REASONS = { lastStanding: 'Alle anderen sind bankrott', rounds: 'Rundenlimit erreicht', time: 'Zeitlimit abgelaufen' };

export async function openStats() {
  let stats = store.stats;
  if (!stats || !stats.finished) {
    const r = await send('stats:request');
    if (!r.ok || !r.stats) return toast(r.error || 'Noch keine Statistik verfügbar.', 'warn');
    stats = r.stats;
  }
  if (open) open.modal.close();
  const m = modal({ title: stats.finished ? 'Spielende – Statistik' : 'Live-Statistik', wide: true, onClose: () => { open = null; } });
  open = { modal: m, final: stats.finished };
  renderStats(m, stats);
}

/** Bei Spielende eine offene Live-Statistik durch die finale ersetzen */
export function refreshStatsIfOpen() {
  if (open && !open.final && store.stats?.finished) {
    open.final = true;
    open.modal.setTitle('Spielende – Statistik');
    renderStats(open.modal, store.stats);
  }
}

export function onStats(stats) {
  store.stats = stats;
  refreshStatsIfOpen();
}

const color = (token) => `var(--tok-${token})`;

function section(title, ...children) {
  const head = el('header', {}, el('h2', { text: title }));
  return { node: el('section', { class: 'stats-section' }, head, ...children), head };
}

function renderStats(m, st) {
  const players = st.ranking.map((r) => ({ ...r, ...st.players[r.pid] }));
  const byId = Object.fromEntries(players.map((p) => [p.pid, p]));
  const body = el('div', { class: 'stats' });

  /* 1. Siegerehrung / Zwischenstand */
  const winner = players[0];
  const podiumOrder = [players[1], players[0], players[2]].filter(Boolean);
  const podium = el('div', { class: 'podium' }, podiumOrder.map((p) => {
    const place = players.indexOf(p) + 1;
    return el('div', { class: `step p${place}` }, avatar(p.token, place === 1 ? 'lg' : ''), el('div', { class: 'pname', text: p.name }), el('div', { class: 'block', text: String(place) }));
  }));
  const ranks = el('ol', { class: 'rank-list' }, players.map((p) => el('li', {},
    el('span', { class: 'r', text: `${p.rank}.` }), avatar(p.token, 'sm'),
    el('span', {}, el('strong', { text: p.name }), p.bankrupt ? el('span', { class: 'muted', text: ` · bankrott in Runde ${p.bankruptRound}` }) : null),
    el('span', { class: 'num', text: p.bankrupt ? '—' : eur(p.netWorth) }))));
  const hero = el('div', { class: 'podium-wrap' },
    st.finished ? el('div', { svg: TROPHY }) : null,
    el('div', {},
      el('div', { class: 'muted', text: st.finished ? 'Gewinner' : 'Führt gerade' }),
      el('div', { class: 'winner-name' }, winner.name),
      el('div', { class: 'muted', text: `${fmtDuration(st.durationMs)} · ${st.rounds} Runde${st.rounds === 1 ? '' : 'n'}${st.endReason ? ` · ${REASONS[st.endReason]}` : ''}` }),
      podium));
  body.append(section(st.finished ? 'Siegerehrung' : 'Zwischenstand', hero, ranks).node);

  /* 2. Vermögensverlauf */
  {
    const sec = section('Vermögensverlauf');
    const chartBox = el('div');
    const legend = el('div', { class: 'legend' });
    const tableBox = el('div', { class: 'table-scroll', hidden: true });
    let mode = 'total';
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Ansicht' });
    const modes = { total: 'Gesamt', cash: 'Bargeld', property: 'Grundbesitz + Gebäude' };
    const value = (v) => (mode === 'property' ? v.property + v.buildings : v[mode]);
    const draw = (animate = true) => {
      for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
      const x = st.history.map((h) => h.round);
      const series = players.map((p) => ({ id: p.pid, name: p.name, color: color(p.token), values: st.history.map((h) => value(h.values[p.pid] || { cash: 0, property: 0, buildings: 0, total: 0 })) }));
      const markers = st.markers.map((mk) => ({ x: Math.min(mk.round, x[x.length - 1]), id: mk.pid, text: mk.text, kind: mk.kind })).filter((mk) => x.includes(mk.x));
      lineChart(chartBox, { x, series, markers, animate });
      tableBox.replaceChildren(el('table', { class: 'stats-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Runde' }), players.map((p) => el('th', { text: p.name })))),
        el('tbody', {}, st.history.map((h) => el('tr', {}, el('td', { text: h.final ? `${h.round} (Ende)` : String(h.round) }),
          players.map((p) => el('td', { text: eur(value(h.values[p.pid] || { cash: 0, property: 0, buildings: 0, total: 0 })) })))))));
    };
    for (const [k, label] of Object.entries(modes)) seg.append(el('button', { type: 'button', dataset: { mode: k }, text: label, onclick: () => { mode = k; draw(); } }));
    legend.append(...players.map((p) => el('span', {}, el('i', { class: 'k', style: { background: color(p.token) } }), p.name)),
      el('span', {}, '◆ Kauf / Farbgruppe / Hotel'), el('span', {}, '✕ Bankrott'));
    const tableBtn = el('button', { class: 'btn btn-ghost btn-sm', text: 'Tabelle', 'aria-pressed': 'false', onclick: () => {
      tableBox.hidden = !tableBox.hidden;
      tableBtn.setAttribute('aria-pressed', String(!tableBox.hidden));
    } });
    sec.head.append(el('div', { class: 'action-row' }, seg, tableBtn));
    sec.node.append(legend, chartBox, tableBox);
    body.append(sec.node);
    requestAnimationFrame(() => draw());
    observeResize(chartBox, () => draw(false));
  }

  /* 3. Meistbesuchte Felder */
  {
    const sec = section('Meistbesuchte Felder');
    const select = el('select', { class: 'select input-sm', 'aria-label': 'Spieler filtern' },
      el('option', { value: '', text: 'Alle Spieler' }), players.map((p) => el('option', { value: p.pid, text: p.name })));
    const mini = el('div', { class: 'mini-board' });
    const bars = el('div');
    const scale = el('div', { class: 'heat-scale' }, 'selten', el('span', { class: 'ramp' }, [1, 2, 3, 4, 5, 6, 7].map((k) => el('i', { style: { background: `var(--heat-${k})` } }))), 'oft');
    const counts = () => (select.value ? byId[select.value].landings : st.landings);
    const draw = (animate = true) => {
      const c = counts();
      const max = Math.max(1, ...c);
      mini.replaceChildren(...BOARD.map((f) => {
        const { col, row } = gridPos(f.index);
        const step = c[f.index] ? Math.max(1, Math.ceil((c[f.index] / max) * 7)) : 0;
        return el('div', { class: 'mb', title: `${f.name}: ${c[f.index]}×`, style: { gridColumn: String(col), gridRow: String(row), background: step ? `var(--heat-${step})` : '' } },
          f.group && GROUPS[f.group].housePrice ? el('span', { class: 'gb', style: { background: GROUPS[f.group].color } }) : null);
      }), el('div', { class: 'center', text: `${c.reduce((a, b) => a + b, 0)} Landungen` }));
      const top = c.map((count, idx) => ({ idx, count })).filter((x) => x.count).sort((a, b) => b.count - a.count || a.idx - b.idx).slice(0, 10);
      barChart(bars, top.map((t) => ({ label: BOARD[t.idx].name, value: t.count, note: '× gelandet' })), {
        color: select.value ? color(byId[select.value].token) : 'var(--tok-hat)', animate,
      });
    };
    select.onchange = () => draw();
    sec.head.append(el('div', { class: 'action-row' }, select,
      el('button', { class: 'btn btn-ghost btn-sm', text: 'Auf dem Brett zeigen', onclick: () => { showHeatOnBoard(counts()); open?.modal.close(); } })));
    sec.node.append(el('div', { class: 'stats-grid-2' }, el('div', {}, mini, scale), bars));
    body.append(sec.node);
    requestAnimationFrame(() => draw());
    observeResize(bars, () => draw(false));
  }

  /* 4. Finanzen */
  {
    const cols = [
      ['Miete erhalten', (p) => p.rentReceived],
      ['Miete gezahlt', (p) => p.rentPaid],
      ['LOS-Einnahmen', (p) => p.goIncome],
      ['Steuern & Strafen', (p) => p.taxesPaid],
      ['Grundstückskäufe', (p) => p.purchases],
      ['Gebäude', (p) => p.buildingSpend],
      ['Hypothekenzinsen', (p) => p.interestPaid],
      ['Karten +', (p) => p.cardIncome],
      ['Karten −', (p) => p.cardPaid],
      ['Jackpot', (p) => p.jackpotWon],
    ];
    const sec = section('Finanzen pro Spieler', el('div', { class: 'table-scroll' }, el('table', { class: 'stats-table' },
      el('thead', {}, el('tr', {}, el('th', { text: 'Spieler' }), cols.map(([h]) => el('th', { text: h })))),
      el('tbody', {}, players.map((p) => el('tr', {}, el('td', {}, el('span', { class: 'who-cell' }, avatar(p.token, 'sm'), p.name)), cols.map(([, fn]) => el('td', { text: eur(fn(p)) }))))))));
    body.append(sec.node);
  }

  /* 5. Besitz und Gebäude */
  {
    const cards = players.map((p) => {
      const o = st.ownership[p.pid];
      return el('div', { class: 'own-card' },
        el('div', { class: 'who-cell' }, avatar(p.token, 'sm'), p.name),
        el('div', { class: 'chips' }, o.groups.length ? o.groups.map((g) => el('i', { title: GROUPS[g].name, style: { background: GROUPS[g].color } })) : el('span', { class: 'muted', text: 'keine Farbgruppe' })),
        el('div', { class: 'muted', text: `${o.fields.length} Felder · ${o.railroads} Bahnhöfe · ${o.utilities} Werke` }),
        el('div', { class: 'muted', text: `${o.houses} Häuser · ${o.hotels} Hotels (gebaut: ${p.housesBuilt} / ${p.hotelsBuilt})` }),
        o.bestField ? el('div', {}, 'Ertragreichstes Feld: ', el('strong', { text: BOARD[o.bestField.idx].name }), ` (${eur(o.bestField.rent)})`) : null);
    });
    const best = st.bestField;
    const sec = section('Besitz und Gebäude',
      best ? el('div', { class: 'tiles', style: { marginBottom: '12px' } }, tile('Ertragreichstes Feld', BOARD[best.idx].name, `${eur(best.rent)} Mieteinnahmen`)) : null,
      el('div', { class: 'own-grid' }, cards));
    body.append(sec.node);
  }

  /* 6. Würfel */
  {
    const total = st.diceSums.reduce((a, b) => a + b, 0);
    const probs = [0, 0, 1, 2, 3, 4, 5, 6, 5, 4, 3, 2, 1].map((n) => n / 36);
    const hist = el('div');
    const sec = section('Würfelstatistik',
      el('div', { class: 'tiles', style: { marginBottom: '12px' } },
        tile('Würfe', total.toLocaleString('de-DE')), tile('Pasche', String(st.doublesTotal), total ? `${Math.round((st.doublesTotal / total) * 100)} % (erwartet 17 %)` : ''),
        tile('Gefängnisbesuche', String(players.reduce((s, p) => s + p.jailVisits, 0)))),
      el('div', { class: 'stats-grid-2' },
        el('div', {}, el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'k', style: { background: 'var(--tok-hat)', height: '10px', width: '10px' } }), 'Anzahl'), el('span', {}, el('i', { class: 'k', style: { background: 'var(--text-2)' } }), 'statistisch erwartet')), hist),
        el('div', { class: 'table-scroll' }, el('table', { class: 'stats-table' },
          el('thead', {}, el('tr', {}, el('th', { text: 'Spieler' }), el('th', { text: 'Würfe' }), el('th', { text: 'Pasche' }), el('th', { text: 'Gefängnis' }), el('th', { text: 'Karten' }))),
          el('tbody', {}, players.map((p) => el('tr', {}, el('td', {}, el('span', { class: 'who-cell' }, avatar(p.token, 'sm'), p.name)),
            el('td', { text: String(p.rolls) }), el('td', { text: String(p.doubles) }), el('td', { text: String(p.jailVisits) }), el('td', { text: String(p.cardsDrawn) }))))))));
    body.append(sec.node);
    const draw = (animate = true) => histogram(hist, st.diceSums.slice(2).map((v, i) => ({ label: String(i + 2), value: v })), { xLabel: 'Augensumme', expected: probs.slice(2).map((pr) => pr * total), animate });
    requestAnimationFrame(() => draw());
    observeResize(hist, () => draw(false));
  }

  /* 7. Handel und Auktionen */
  {
    const a = st.auctions;
    const name = (pid) => byId[pid]?.name ?? '?';
    body.append(section('Handel und Versteigerungen', el('div', { class: 'tiles' },
      tile('Abgeschlossene Handel', String(st.trades.count)),
      tile('Handelsvolumen', eur(st.trades.totalValue), 'Geld + Listenpreise'),
      tile('Versteigerungen', String(a.count)),
      a.highest ? tile('Höchstes Gebot', eur(a.highest.amount), `${BOARD[a.highest.idx].name} · ${name(a.highest.pid)}`) : tile('Höchstes Gebot', '—'),
      a.cheapest ? tile('Größtes Schnäppchen', eur(a.cheapest.amount), `${BOARD[a.cheapest.idx].name} (statt ${eur(a.cheapest.listPrice)}) · ${name(a.cheapest.pid)}`) : tile('Größtes Schnäppchen', '—'),
    )).node);
  }

  /* 8. Auszeichnungen */
  if (st.badges.length) {
    body.append(section('Auszeichnungen', el('div', { class: 'badges' }, st.badges.map((b, i) => {
      const p = byId[b.pid];
      return el('div', { class: 'badge-card', style: { animationDelay: `${i * 70}ms` } },
        el('div', { class: 'bi', text: b.icon }),
        el('div', {}, el('strong', { text: b.name }), el('div', { class: 'who-cell' }, p ? avatar(p.token, 'sm') : null, p?.name ?? '?'), el('small', { text: b.description })));
    }))).node);
  }

  m.body.replaceChildren(body);

  /* Aktionen */
  m.foot.replaceChildren(
    el('button', { class: 'btn btn-ghost', text: '📜 Replay-Log', onclick: () => openReplay() }),
    el('button', { class: 'btn btn-ghost', text: '⬇ JSON', onclick: () => download(`monopoly-statistik-${store.code}.json`, JSON.stringify(st, null, 2)) }),
    el('button', { class: 'btn btn-ghost', text: '🖼 Bild', onclick: () => exportImage(st, players) }),
    st.finished && isHost() ? el('button', { class: 'btn btn-secondary', text: 'Zurück zur Lobby', onclick: async () => { const r = await send('room:lobby'); if (!r.ok) toast(r.error, 'error'); else m.close(); } }) : null,
    st.finished && isHost() ? el('button', { class: 'btn btn-primary', text: '🔁 Revanche', onclick: async () => { const r = await send('room:rematch'); if (!r.ok) toast(r.error, 'error'); else m.close(); } }) : null,
    st.finished && !isHost() ? el('span', { class: 'muted', text: 'Der Host kann eine Revanche starten.' }) : null,
    !st.finished ? el('button', { class: 'btn btn-secondary', text: 'Aktualisieren', onclick: async () => { const r = await send('stats:request'); if (r.ok && r.stats) renderStats(m, r.stats); } }) : null,
  );
}

function observeResize(node, fn) {
  let w = 0;
  let t = null;
  const ro = new ResizeObserver(() => {
    if (!node.isConnected) { ro.disconnect(); return; }
    const nw = node.clientWidth;
    if (Math.abs(nw - w) < 8) return;
    const first = w === 0;
    w = nw;
    if (first) return;
    clearTimeout(t);
    t = setTimeout(fn, 120);
  });
  ro.observe(node);
}

/* --- Replay-Log ------------------------------------------------------------- */

async function openReplay() {
  const r = await send('replay:request');
  if (!r.ok) return toast(r.error, 'error');
  const log = r.log;
  const m = modal({ title: 'Spielverlauf (Replay-Log)', wide: true });
  const players = store.state?.players || [];
  const who = el('select', { class: 'select input-sm', 'aria-label': 'Spieler' }, el('option', { value: '', text: 'Alle Spieler' }), players.map((p) => el('option', { value: p.id, text: p.name })));
  const kind = el('select', { class: 'select input-sm', 'aria-label': 'Art' },
    [['', 'Alle Ereignisse'], ['buy', 'Käufe'], ['rent', 'Miete'], ['card', 'Karten'], ['auction', 'Versteigerungen'], ['trade', 'Handel'], ['jail', 'Gefängnis'], ['build', 'Bauen'], ['bankrupt', 'Bankrott']]
      .map(([v, t]) => el('option', { value: v, text: t })));
  const search = el('input', { class: 'input input-sm', placeholder: 'Suchen …', 'aria-label': 'Suchen' });
  const list = el('ol', { class: 'replay-list' });
  const t0 = log[0]?.t || 0;
  // Schritt-für-Schritt-Wiedergabe
  let playing = null;
  const playBtn = el('button', { class: 'btn btn-secondary btn-sm', text: '▶ Abspielen' });
  const draw = (limit = Infinity) => {
    const q = search.value.trim().toLowerCase();
    const rows = log.filter((e) => (!who.value || e.pid === who.value) && (!kind.value || e.kind === kind.value) && (!q || e.text.toLowerCase().includes(q))).slice(0, limit);
    list.replaceChildren(...rows.map((e) => el('li', {}, el('span', { class: 'rt', text: `R${e.round} · ${fmtMin(e.t - t0)}` }), el('span', { text: e.text }))));
    return rows.length;
  };
  const fmtMin = (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
  playBtn.onclick = () => {
    if (playing) { clearInterval(playing); playing = null; playBtn.textContent = '▶ Abspielen'; draw(); return; }
    let n = 0;
    playBtn.textContent = '⏸ Stopp';
    playing = setInterval(() => {
      n++;
      const shown = draw(n);
      list.lastElementChild?.scrollIntoView({ block: 'nearest' });
      if (n >= shown + 1) { clearInterval(playing); playing = null; playBtn.textContent = '▶ Abspielen'; }
    }, 180);
  };
  for (const c of [who, kind]) c.onchange = () => draw();
  search.oninput = () => draw();
  m.body.append(el('div', { class: 'replay-controls' }, who, kind, search, playBtn,
    el('button', { class: 'btn btn-ghost btn-sm', text: '⬇ Als Text', onclick: () => download(`monopoly-verlauf-${store.code}.txt`, log.map((e) => `[Runde ${e.round} ${fmtTime(e.t)}] ${e.text}`).join('\n'), 'text/plain') })),
    list);
  m.foot.append(el('span', { class: 'muted', text: `${log.length} Einträge` }), el('button', { class: 'btn btn-primary', text: 'Schließen', onclick: () => { clearInterval(playing); m.close(); } }));
  draw();
}

/* --- Export als Bild ---------------------------------------------------------- */

function exportImage(st, players) {
  const W = 1200;
  const H = 1500;
  const c = (v) => cssVar(v) || '#888';
  const col = (token) => c(`--tok-${token}`);
  const bg = c('--surface');
  const text = c('--text');
  const muted = c('--text-2');
  const grid = c('--grid');
  const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const font = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"';
  let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ${font}>`;
  out += `<rect width="${W}" height="${H}" fill="${bg}"/>`;
  out += `<rect x="40" y="36" width="250" height="56" rx="6" fill="#d4322c"/><text x="165" y="74" fill="#fff" font-size="30" font-weight="900" text-anchor="middle" letter-spacing="3">MONOPOLY</text>`;
  out += `<text x="320" y="62" fill="${text}" font-size="28" font-weight="800">${st.finished ? 'Spielende' : 'Zwischenstand'} · Raum ${esc(store.code)}</text>`;
  out += `<text x="320" y="90" fill="${muted}" font-size="18">${new Date().toLocaleDateString('de-DE')} · ${esc(fmtDuration(st.durationMs))} · ${st.rounds} Runden${st.endReason ? ` · ${esc(REASONS[st.endReason])}` : ''}</text>`;
  // Rangliste
  let y = 150;
  out += `<text x="40" y="${y}" fill="${text}" font-size="22" font-weight="800">Rangliste</text>`;
  players.forEach((p, i) => {
    y += 42;
    out += `<circle cx="58" cy="${y - 7}" r="12" fill="${col(p.token)}"/><text x="82" y="${y}" fill="${text}" font-size="20" font-weight="${i ? 600 : 800}">${i + 1}. ${esc(p.name)}${i === 0 && st.finished ? ' 🏆' : ''}</text>`;
    out += `<text x="560" y="${y}" fill="${muted}" font-size="20" text-anchor="end">${p.bankrupt ? `bankrott (Runde ${p.bankruptRound})` : esc(fmtEur(p.netWorth))}</text>`;
  });
  // Vermögensverlauf
  const cx = 620;
  const cy = 130;
  const cw = 540;
  const ch = 300;
  out += `<text x="${cx}" y="150" fill="${text}" font-size="22" font-weight="800">Vermögensverlauf</text>`;
  const xs = st.history.map((h) => h.round);
  const maxV = Math.max(1, ...st.history.flatMap((h) => Object.values(h.values).map((v) => v.total)));
  const px = (r) => cx + ((r - xs[0]) / Math.max(1, xs[xs.length - 1] - xs[0])) * cw;
  const py = (v) => cy + 40 + ch - (v / maxV) * ch;
  for (let k = 0; k <= 4; k++) out += `<line x1="${cx}" x2="${cx + cw}" y1="${py((maxV * k) / 4)}" y2="${py((maxV * k) / 4)}" stroke="${grid}" stroke-width="1"/>`;
  for (const p of players) {
    const d = st.history.map((h, i) => `${i ? 'L' : 'M'}${px(h.round).toFixed(1)},${py(h.values[p.pid]?.total || 0).toFixed(1)}`).join('');
    out += `<path d="${d}" fill="none" stroke="${col(p.token)}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`;
  }
  out += `<text x="${cx}" y="${cy + ch + 70}" fill="${muted}" font-size="15">Runde ${xs[0]}</text><text x="${cx + cw}" y="${cy + ch + 70}" fill="${muted}" font-size="15" text-anchor="end">Runde ${xs[xs.length - 1]}</text>`;
  // Würfel-Histogramm
  y = Math.max(y + 80, 560);
  out += `<text x="40" y="${y}" fill="${text}" font-size="22" font-weight="800">Würfelsummen</text>`;
  const ds = st.diceSums.slice(2);
  const dmax = Math.max(1, ...ds);
  ds.forEach((v, i) => {
    const bh = (v / dmax) * 180;
    const bx = 40 + i * 48;
    out += `<rect x="${bx}" y="${y + 220 - bh}" width="32" height="${bh}" rx="4" fill="${col('hat')}"/><text x="${bx + 16}" y="${y + 244}" fill="${muted}" font-size="15" text-anchor="middle">${i + 2}</text>`;
  });
  // Top-Felder
  out += `<text x="${cx}" y="${y}" fill="${text}" font-size="22" font-weight="800">Meistbesuchte Felder</text>`;
  const tmax = Math.max(1, ...st.topFields.map((t) => t.count));
  st.topFields.slice(0, 8).forEach((t, i) => {
    const by = y + 22 + i * 30;
    out += `<text x="${cx + 170}" y="${by + 16}" fill="${text}" font-size="15" text-anchor="end">${esc(BOARD[t.idx].name)}</text><rect x="${cx + 180}" y="${by + 2}" width="${(t.count / tmax) * 300}" height="18" rx="4" fill="${col('hat')}"/><text x="${cx + 188 + (t.count / tmax) * 300}" y="${by + 16}" fill="${muted}" font-size="14">${t.count}</text>`;
  });
  // Auszeichnungen
  y += 320;
  out += `<text x="40" y="${y}" fill="${text}" font-size="22" font-weight="800">Auszeichnungen</text>`;
  st.badges.forEach((b, i) => {
    const bx = 40 + (i % 2) * 570;
    const by = y + 40 + Math.floor(i / 2) * 64;
    const p = players.find((x) => x.pid === b.pid);
    out += `<text x="${bx}" y="${by + 10}" font-size="30">${b.icon}</text><text x="${bx + 48}" y="${by}" fill="${text}" font-size="19" font-weight="800">${esc(b.name)} – ${esc(p?.name ?? '?')}</text><text x="${bx + 48}" y="${by + 24}" fill="${muted}" font-size="15">${esc(b.description)}</text>`;
  });
  out += '</svg>';

  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) download(`monopoly-statistik-${store.code}.png`, blob);
      else toast('Bild konnte nicht erzeugt werden.', 'error');
    }, 'image/png');
  };
  img.onerror = () => toast('Bild konnte nicht erzeugt werden.', 'error');
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(out)}`;
}
