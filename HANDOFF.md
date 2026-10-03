# Übergabe: Monopoly Online

Stand: 03.10.2026. Dieses Dokument ist für den nächsten Agenten (oder Menschen), der hier
weiterarbeitet. Es beschreibt den Stand, wichtige Entscheidungen, Stolperfallen und
mögliche nächste Schritte. Ergänzend: `README.md` (Start, Deploy, Zusammenarbeit, Aufbau),
`docs/SERVER.md` (eigener Server), `docs/PROTOCOL.md` (Socket-Events, Zustand, Ereignisse),
`docs/CHECKLIST.md` (Regeln ↔ Tests).

## 1. Stand

- Vollständig spielbares Online-Multiplayer-Monopoly nach einer langen Spezifikation
  (deutsch, klassische Ausgabe, Hausregeln, KI, Statistik-Screen). Der Nutzer ist zufrieden.
- `npm test`: **86 Tests, alle grün** (zuletzt mehrfach hintereinander stabil).
- Im Browser mit headless Chromium geprüft: 3 Tabs im selben Browser, Reconnect per
  Neuladen, komplettes Spiel bis zur Siegerehrung, Versteigerung, Handel, Tooltips,
  Heatmap, hell/dunkel, Handy/Tablet/Desktop. Keine Konsolenfehler.
- **Git/GitHub:** privates Repo [`Tobi-15/monopoly`](https://github.com/Tobi-15/monopoly),
  Branch `main`. Der Nutzer arbeitet dort zusammen mit einem Freund. Der Freund ist noch
  **nicht** eingeladen, der Benutzername folgt (Befehl dazu in README → „Zusammenarbeit“).
  Vor jeder Arbeit `git pull`, weil jetzt zwei Leute (plus Agenten) pushen.
- **Deploy:** Ziel ist ein eigener Server des Nutzers auf einem anderen PC (Details wie OS,
  Domain und Webserver noch unbekannt). Anleitung: `docs/SERVER.md` (Deploy-Key, systemd,
  Caddy/nginx, Updates per `git pull`). Noch nicht deployed. Render, Railway und Fly.io sind
  als Alternativen im README beschrieben.
- Nicht ungefragt pushen oder deployen. Der Nutzer betreibt ein ähnliches Projekt
  (`~/Work/wizard`, `Tobi-15/wizard`, Render).

## 2. Schnellstart für Entwickler

```bash
npm install
npm start            # http://localhost:3000 (Snapshots nach ./data/rooms.json)
npm run dev          # mit --watch
npm test             # node:test, ca. 6 s
npm run sim          # 100 Bot-Spiele mit Invarianten, ca. 3 s
PORT=3123 PERSIST=0 BOT_DELAY_MS=100 npm start   # Testserver mit schnellen Bots
```

Umgebung hier: Node 26 (Projekt verlangt ≥ 20), Arch/Omarchy, Chromium unter `/usr/bin/chromium`.

## 3. Architektur in Kürze

```
shared/   Daten + reine Regelfunktionen, laufen in Node UND im Browser (/shared/…)
server/   game/Game.js (Zustandsautomat), game/stats.js, game/bot.js,
          rooms.js (Räume/Timer/Bots/Abwesenheit), socket.js (Protokoll), persist.js, app.js
public/   index.html, css/style.css, js/* (ES-Module ohne Build)
test/     node:test-Suites, helpers.js (seeded RNG, fake clock, Bot-Simulator, Invarianten)
```

### Spiellogik (`server/game/Game.js`)
- Der gesamte Zustand liegt als reines JSON in `game.s`, serialisierbar über `toJSON()`/`fromJSON()`.
- Einziger Einstieg: `game.act(pid, type, payload)` → `{ ok }` oder `{ ok: false, error }`.
  Ungültiges wirft intern `GameError` (Text wird dem Nutzer gezeigt).
- **Ablauf über eine Schritt-Warteschlange** `s.queue` (`move`, `moveTo`, `land`,
  `finishMove`, `auction`, `release`, `nextTurn`, `resume`). `proceed()` arbeitet sie ab,
  bis eine Entscheidung nötig ist. Ketten wie Karte → Bewegung → Miete → Schulden laufen
  so ohne Rekursion.
- Stabile Phasen: `roll | jail | buy | auction | debt | end | over`. `moving` ist nur ein
  Zwischenzustand. Nach jeder Aktion muss eine stabile Phase erreicht sein (Invariante in den Tests).
- Schulden: `charge()` zahlt sofort oder legt einen Eintrag in `s.debts` an (Warteschlange,
  auch für mehrere Schuldner, z. B. Geburtstagskarte).
- Alle Zahlen kommen aus `this.rules` (= `resolveRules()` aus `shared/rules.js`: Hausregeln
  + `FIXED`-Konstanten) bzw. aus `shared/board.js`/`cards.js`. **Keine festen Zahlen in der Logik.**
- `game.events` sammelt Ereignisse für Client-Animationen (`dice`, `move`, `card`, `money` …),
  `room.afterChange()` holt sie mit `flushEvents()` ab und verteilt Zustand und Ereignisse.
- `publicState()` lässt Kartenstapel-Reihenfolge und Statistik-Rohdaten weg.
- Tests steuern Würfel über `game.diceQueue` und Zeit über eine injizierte Uhr (`now`).

### Räume (`server/rooms.js`)
- Mitglieder mit `id` und `secret` (für den Reconnect). Bots sind normale Mitglieder mit `isBot`.
- Abwesenheit: Nach `FIXED.absenceTakeoverMs` (2 min) ohne Socket gilt der Spieler als
  `away`, dann spielt die KI für ihn. In der Lobby wird er stattdessen entfernt. Der Host kann
  abwesende Spieler aus dem Spiel nehmen (`removePlayer` = Bankrott an die Bank).
- Ist kein Mensch und kein Zuschauer mehr verbunden, **pausieren** Bots und Zug-Timer
  (`deserted()`). `resume()` startet beides beim nächsten Beitritt wieder.
- Zug-Timer: `onDeadline()` macht nur einen Minimal-Zug (`autoMove`: würfeln, kaufen oder
  ablehnen, Zug beenden, Schulden regeln). Es wird nichts gebaut und kein Handel angeboten.
- Bot-Takt: `scheduleBots()`/`botStep()`. Nach Bewegungen wartet der Bot länger
  (Faktor 2,4 × `BOT_DELAY_MS`), damit die Animationen bei den Clients durchlaufen.

### Client (`public/js`)
- `main.js`: Bildschirme, Verbindung, Wiederverbinden.
  - Sitzung pro Tab in `sessionStorage` (`mono.session`, Rejoin mit `force: true`).
  - Pro Raum zusätzlich in `localStorage` (`mono.sessions`, Rejoin ohne `force`, bei
    `IN_USE` wird abgelehnt). Dadurch funktionieren mehrere Tabs = mehrere Spieler.
  - **Wichtig:** Der Server schickt `room:update`, `state:update` und `chat:*` noch *vor*
    der Ack-Antwort auf join/rejoin. Diese Nachrichten werden in `pending` gepuffert und
    in `flushPending()` angewendet, sobald `store.code` gesetzt ist.
- `game.js`: Warteschlange für `state:update`. Die Ereignisse werden nacheinander animiert,
  danach wird der neue Zustand gerendert. Ist ein Tab versteckt oder hängt er hinterher,
  laufen die Animationen im Schnellmodus (`fast`) bzw. werden übersprungen.
  `view` = angezeigter Zustand, `store.state` = neuester Serverzustand.
- `board.js`: DOM-/CSS-Grid-Brett. Figuren werden per `transform` und WAAPI bewegt. Dazu
  kommen 3D-Würfel aus CSS, die Karten-Flip-Animation und die Heatmap.
- `util.js` **patcht `Element.prototype.append/prepend/replaceChildren`**, damit
  `null`/`false` beim bedingten Rendern ignoriert werden (sonst erscheint „null“ als Text).
  Viele Render-Funktionen verlassen sich darauf.
- Texte aus dem Netz immer per `textContent` einsetzen (`el(…, { text })`), nie per `innerHTML`.
  `svg:` ist nur für eigene, statische Icons gedacht.
- Diagramme in `charts.js` sind eigenes SVG. Sie folgen den Dataviz-Regeln: Haarlinien,
  2-px-Linien, Legende, Fadenkreuz-Tooltip, Farben über CSS-Variablen `--tok-*` (hell/dunkel).
- Sound wird per WebAudio synthetisiert (`sound.js`), es gibt keine Audiodateien.

## 4. Stolperfallen (alle schon einmal passiert)

- **CSS-Containment:** `.board` und `.board-area` haben `container-type`. Das macht sie zum
  Containing Block für `position: fixed`. Deshalb hängt das Auktions-Panel an `document.body`
  und wird per JS über dem Brett positioniert (`positionAuction`).
- **`cqw` auf dem Container selbst** bezieht sich auf den *äußeren* Container. Darum nutzt
  das Grid von `.board` Prozentwerte. Innerhalb der Felder funktionieren `cqw` und `--u`.
- **Puppeteer:** `page.click()` hängt in Hintergrund-Tabs, weil dort nicht gerendert wird.
  In Mehr-Tab-Tests mit `page.$eval(sel, n => n.click())` klicken und vor Screenshots
  `bringToFront()` aufrufen. Headless Chromium meldet `(hover: none)`. Darum reagiert der
  Feld-Tooltip auf `pointerType === 'mouse'` statt auf eine Media-Query.
- **`pkill -f "node server/index.js"`** in einem Bash-Befehl trifft auch die eigene Shell
  (Exit 144). Stattdessen: `kill $(pgrep -f "node server/inde[x].js")`.
- In Socket-Tests nicht zweimal auf denselben Zustand reagieren (siehe `playStep`/`actedAt`
  in `test/multiplayer.test.js`), sonst greift das Rate-Limit.
- Zufall in Tests: `assert` niemals auf Geld/Positionen direkt nach dem Start, wenn Bots mit
  kleinem Delay schon ziehen können. Besser Statistik-Historie (Runde 0) oder `rules` prüfen.

## 5. Browser-Tests wiederherstellen

Die E2E-Skripte lagen im temporären Scratchpad und sind **nicht** im Repo. So baut man sie neu:

```bash
mkdir -p /tmp/mono-e2e && cd /tmp/mono-e2e && npm init -y && npm i puppeteer-core@23
```
```js
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium', headless: true,
  args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 900 } });
// Tab A: #home-name tippen, .token-option[data-token=…] klicken, #btn-create
// Tabs B/C: /r/CODE öffnen, Name, Figur, #btn-join → #screen-lobby:not([hidden])
// Host: #lobby-bot-tools .btn-secondary (KI), B/C: #btn-ready, Host: #btn-start
// Spielen: im #action-panel den ersten aktiven button.btn-primary klicken,
//          in .auction-panel „Aussteigen“; Fehler über page.on('pageerror'/'console') sammeln
```
Sinnvoll wäre, das als `scripts/e2e.mjs` (optionale devDependency) ins Repo zu übernehmen.

## 6. Bekannte Grenzen und Ideen für nächste Schritte

Bewusste Vereinfachungen (dokumentiert in `docs/CHECKLIST.md`):
- Bauen und Hypotheken nur im eigenen Zug bzw. als Schuldner, nicht „jederzeit“.
- Gebote in Versteigerungen sind auf das Bargeld begrenzt.
- Bei Abwesenheit entscheidet der Host über das Entfernen; eine Abstimmung aller Spieler gibt es nicht.
- 2D-Brett statt Three.js (die Spezifikation erlaubte beides).

Offene Punkte und Ideen (nach Nutzen sortiert):
1. **Deploy auf den eigenen Server**, sobald der Nutzer die Server-Details hat
   (`docs/SERVER.md` daran anpassen). Freund als Collaborator einladen, sobald der Name feststeht.
2. Bot-Spiele dauern lange (`npm run sim`: Ø ca. 110 Runden, 2 von 100 laufen ins Schrittlimit,
   meist 2-Spieler-Partien). Die Bots könnten aktiver handeln (Tausch Feld gegen Feld,
   nicht nur Geld gegen das fehlende Feld) und früher bauen.
3. Versteigerungen erzeugen viele Log-Zeilen („X bietet …“). Die Gebote könnten im Log
   zusammengefasst werden.
4. E2E-Browser-Test ins Repo übernehmen (siehe Abschnitt 5).
5. Die Client-Logik hat keine Unit-Tests (nur E2E). Kandidaten: `charts.js`-Skalen, `board.tokenXY`.
6. Barrierefreiheit: Tastaturnavigation über das Brett (Felder sind fokussierbar, Enter
   öffnet die Details). Zusätzlich könnte eine Liste der Figurpositionen für Screenreader helfen.
7. Für mehrere Server-Instanzen: Redis statt JSON-Snapshot (`server/persist.js` kapselt das).
8. Optional: PWA-Manifest, Lautstärkeregler, Animationsgeschwindigkeit als Einstellung.

## 7. Konventionen

- UI-Texte, Kommentare und Doku sind auf Deutsch. Spieler werden ohne Pronomen angesprochen
  (z. B. „Anna ist am Zug“).
- Keine Frameworks, kein Build. ES-Module überall. `shared/` bleibt frei von Abhängigkeiten
  und browsertauglich.
- Neue Hausregel: in `RULE_DEFS` (`shared/rules.js`) eintragen, Logik über `this.rules`,
  einen Test in `test/houserules.test.js` (Standard vs. geändert) und eine Zeile in
  `docs/CHECKLIST.md` ergänzen. Der Lobby-Editor baut sich automatisch aus `RULE_DEFS`.
- Neues Socket-Event: in `server/socket.js` mit Eingabeprüfung registrieren (Spielaktionen
  über `GAME_EVENTS` → `Game.act`) und in `docs/PROTOCOL.md` dokumentieren.
- Nach Änderungen an der Spiellogik immer `npm test` **und** `npm run sim` laufen lassen.
  Die Invarianten im Fuzzing finden Fehler, die gezielte Tests übersehen.
