/**
 * Statische SVG-Icons: Spielfiguren und Feld-Symbole.
 * Figuren nutzen currentColor (weiß auf farbigem Kreis).
 */

const svg = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;
const shade = 'fill="#000" opacity=".28"';

export const TOKEN_ICONS = {
  hat: svg(`<path d="M7.6 2.6h8.8l.9 11.2H6.7z"/><path d="M6.9 10.4h10.2l.3 2.6H6.6z" ${shade}/><path d="M1.8 15.6c0-1.3 2.8-2.3 10.2-2.3s10.2 1 10.2 2.3-4.2 3.6-10.2 3.6S1.8 16.9 1.8 15.6z"/>`),
  car: svg(`<path d="M2.6 13.2l1.7-4A2.2 2.2 0 0 1 6.3 8h8.3c.7 0 1.3.3 1.7.9l2.3 3.1 2.3.6c.8.2 1.3.9 1.3 1.7v1.7a1 1 0 0 1-1 1h-1.3a2.7 2.7 0 0 0-5.3 0H9.4a2.7 2.7 0 0 0-5.3 0H2.9a1 1 0 0 1-1-1v-1.7c0-.5.3-.9.7-1.1z"/><path d="M6.6 9.6h3.8v2.7H5.5zM11.7 9.6h3l2 2.7h-5z" ${shade}/><circle cx="6.75" cy="17.4" r="2.1"/><circle cx="17.25" cy="17.4" r="2.1"/>`),
  ship: svg(`<path d="M1.8 13.6h20.4l-2.6 5.6a1.6 1.6 0 0 1-1.5.9H5.9a1.6 1.6 0 0 1-1.5-.9z"/><path d="M5.6 9.4h12.2v3.4H5.6z"/><path d="M8.6 4.6h3.4v4.2H8.6z"/><path d="M8.6 5.6h3.4v1H8.6z" ${shade}/><circle cx="14.4" cy="3.4" r="1.5" opacity=".65"/><circle cx="17" cy="2.2" r="1" opacity=".45"/><circle cx="7" cy="16" r=".9" ${shade}/><circle cx="10.3" cy="16" r=".9" ${shade}/><circle cx="13.6" cy="16" r=".9" ${shade}/><circle cx="16.9" cy="16" r=".9" ${shade}/>`),
  dog: svg(`<path d="M3.6 9.2c0-1.5 1-2.8 2.5-3.2l.8-2.4 1.5 2.2h1.8c1.5 0 2.7 1.2 2.7 2.7v.9h5.5c1.6 0 2.9 1.3 2.9 2.9v.3l1.1-1.6.6.4-.9 3.4c-.2.9-1.1 1.6-2 1.6l-.2 3.2h-2l-.4-3h-6.2l-.5 3H8.7l-.4-3.5a3.4 3.4 0 0 1-2-3.1v-.9H5.1c-.8 0-1.5-.7-1.5-1.5z"/><circle cx="7.4" cy="8.4" r=".75" ${shade}/><path d="M3.6 10.4h2.6v1.3H3.6z" ${shade}/>`),
  shoe: svg(`<path d="M5.2 3.6h5.2v7.8l7.5 2.1c2.1.6 3.6 2.5 3.6 4.7v.6a1.2 1.2 0 0 1-1.2 1.2H3.9a1.2 1.2 0 0 1-1.2-1.2v-3.4c0-1 .3-1.9.9-2.7l1.6-2.2z"/><path d="M2.7 17.9h18.6v1.4a1.2 1.2 0 0 1-1.2 1.2H3.9a1.2 1.2 0 0 1-1.2-1.2z" ${shade}/><path d="M10.4 11.4l1.4.4-1 1.6-1.3-.4zM12.8 12.1l1.4.4-1 1.6-1.3-.4z" ${shade}/>`),
  thimble: svg(`<path d="M6.9 19.4V9.6a5.1 5.1 0 0 1 10.2 0v9.8z"/><rect x="5.6" y="17.8" width="12.8" height="3.2" rx="1.2"/><g ${shade}><circle cx="9.6" cy="9.2" r=".8"/><circle cx="12" cy="8.2" r=".8"/><circle cx="14.4" cy="9.2" r=".8"/><circle cx="9.6" cy="12" r=".8"/><circle cx="12" cy="11.2" r=".8"/><circle cx="14.4" cy="12" r=".8"/><circle cx="9.6" cy="14.8" r=".8"/><circle cx="12" cy="14.2" r=".8"/><circle cx="14.4" cy="14.8" r=".8"/></g>`),
  iron: svg(`<path d="M1.8 17.4c0-4.1 3.5-7.6 8.6-7.6h9.6c1.2 0 2.2 1 2.2 2.2v5.4a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z"/><path d="M8.8 10V7.4c0-1.5 1.2-2.7 2.7-2.7h6.4c1.4 0 2.5 1.1 2.5 2.5V10h-2.3V7.1h-6.9V10z"/><path d="M1.8 16.6h20.4v.8a1.2 1.2 0 0 1-1.2 1.2H3a1.2 1.2 0 0 1-1.2-1.2z" ${shade}/>`),
  wheelbarrow: svg(`<path d="M2.4 7.6h13.8l-2.4 7H5.2z"/><path d="M15.2 9.4l6-3.2.8 1.4-6 3.2z"/><path d="M5.8 14.2h1.6l-1.1 4.4H4.7zM12.4 14.2H14l.6 4.4H13z"/><circle cx="9.6" cy="18.2" r="2.8"/><circle cx="9.6" cy="18.2" r="1" ${shade}/>`),
};

export const FIELD_ICONS = {
  chance: svg(`<text x="12" y="19.5" text-anchor="middle" font-size="21" font-weight="900" font-family="Georgia, serif" fill="#f08c1d">?</text>`),
  community: svg(`<path d="M3 9.5a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3V12H3z" fill="#2f7fc1"/><path d="M3 12h18v7a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z" fill="#3b95dc"/><rect x="10" y="10.5" width="4" height="4" rx="1" fill="#f5d10f"/><path d="M3 12h18" stroke="#1d5e94" stroke-width="1"/>`),
  railroad: svg(`<path d="M5 4.5h9.5a3 3 0 0 1 3 3V15H5z"/><path d="M17.5 9h2.2l1.3 6h-3.5z"/><path d="M3 15h18.5v2H3z"/><rect x="7" y="6.5" width="4" height="3.5" rx=".6" fill="#fff" opacity=".85"/><circle cx="7" cy="19" r="2"/><circle cx="12.5" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M5 2.5h3v2H5z"/>`),
  bulb: svg(`<path d="M12 2.5a6.5 6.5 0 0 0-3.9 11.7c.7.5 1.1 1.3 1.1 2.1v.7h5.6v-.7c0-.8.4-1.6 1.1-2.1A6.5 6.5 0 0 0 12 2.5z" fill="#f5c518"/><path d="M9.3 18h5.4v1.4H9.3zM9.8 20.2h4.4c0 .9-.9 1.6-2.2 1.6s-2.2-.7-2.2-1.6z" fill="#7a7a7a"/><path d="M12 6.5v6" stroke="#b58900" stroke-width="1.2" fill="none"/>`),
  drop: svg(`<path d="M3 8h9v3H6v2H3z" fill="#7a8a99"/><path d="M12 7h4.5a3 3 0 0 1 3 3v2h-3v-1.5H12z" fill="#7a8a99"/><rect x="7.5" y="4.5" width="5" height="2.5" rx="1" fill="#5d6b78"/><path d="M18 14.5c0 0-2.2 2.9-2.2 4.4a2.2 2.2 0 0 0 4.4 0c0-1.5-2.2-4.4-2.2-4.4z" fill="#2f7fc1"/>`),
  tax: svg(`<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><text x="12" y="16.3" text-anchor="middle" font-size="12" font-weight="800" font-family="system-ui, sans-serif">€</text>`),
  luxury: svg(`<path d="M6 4h12l3.5 5L12 20.5 2.5 9z" fill="#7fc6ea"/><path d="M2.5 9h19M8 4l-2 5 6 11.5L18 9l-2-5M6 9l2-5M18 9l-2-5" stroke="#2c6e94" stroke-width=".9" fill="none"/>`),
  jail: svg(`<rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 3v18M12 3v18M16.5 3v18" stroke="currentColor" stroke-width="1.8"/>`),
  parking: svg(`<path d="M3.5 13.5l1.5-4A2 2 0 0 1 6.8 8h8.6a2 2 0 0 1 1.6.8l2.5 3.4 1.6.4c.7.2 1.2.8 1.2 1.5v1.8a1 1 0 0 1-1 1h-1.2a2.5 2.5 0 0 0-5 0H9.3a2.5 2.5 0 0 0-5 0H3.5a1 1 0 0 1-1-1v-1.4c0-.5.4-.9 1-1z" fill="#e0302b"/><circle cx="6.8" cy="17.1" r="1.9" fill="#333"/><circle cx="17.2" cy="17.1" r="1.9" fill="#333"/><path d="M7 9.5h3.6v2.5H6zM11.8 9.5h3l1.8 2.5h-4.8z" fill="#fff" opacity=".7"/>`),
  gotojail: svg(`<path d="M12 2.5l7.5 3v6c0 4.6-3.2 8.7-7.5 10-4.3-1.3-7.5-5.4-7.5-10v-6z" fill="#2449a8"/><path d="M12 6.5l1.4 2.9 3.1.4-2.3 2.2.6 3.1-2.8-1.5-2.8 1.5.6-3.1-2.3-2.2 3.1-.4z" fill="#f5d10f"/>`),
  go: svg(`<path d="M2 12h14" stroke="#e0302b" stroke-width="4" stroke-linecap="round"/><path d="M13 5l8 7-8 7z" fill="#e0302b"/>`),
};

/** Trophäe für die Siegerehrung */
export const TROPHY = `<svg class="trophy" viewBox="0 0 120 120" aria-hidden="true">
  <defs><linearGradient id="tg" x1="0" x2="1"><stop offset="0" stop-color="#f6d365"/><stop offset=".5" stop-color="#fbe7a1"/><stop offset="1" stop-color="#e5a823"/></linearGradient></defs>
  <path d="M30 18h60v22c0 18-13 32-30 32S30 58 30 40z" fill="url(#tg)" stroke="#b07d12" stroke-width="2"/>
  <path d="M30 26H16c0 16 8 24 18 25M90 26h14c0 16-8 24-18 25" fill="none" stroke="#e5a823" stroke-width="6" stroke-linecap="round"/>
  <path d="M52 72h16v14H52z" fill="#e5a823"/><path d="M38 86h44l4 14H34z" fill="#8a5a12"/><rect x="44" y="90" width="32" height="6" rx="2" fill="#f6d365"/>
  <path class="shine" d="M44 24l6 0-8 34-5 0z" fill="#fff"/>
  <path d="M60 30l3.5 7 7.7 1.1-5.6 5.4 1.3 7.7L60 47.6l-6.9 3.6 1.3-7.7-5.6-5.4 7.7-1.1z" fill="#fff8d6"/>
</svg>`;
