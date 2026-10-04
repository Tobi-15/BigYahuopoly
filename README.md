# BigYahuopoly

Das klassische Brettspiel als Echtzeit-Multiplayer im Browser: deutsche Originalausgabe
(Badstraße bis Schlossallee), einstellbare Hausregeln, KI-Gegner und ein ausführlicher
Statistik-Screen. Jeder spielt in seinem eigenen Browser. Ein Account ist nicht nötig.

- **Server-autoritativ:** Würfeln, Kaufen, Miete, Karten und Bankrott laufen nur auf dem
  Server. Clients schicken nur Aktionen. Die Würfel kommen aus `crypto.randomInt`.
- **Lobby:** Raum mit 4-stelligem Code und Einladungslink, Figur wählen (jede nur einmal),
  Bereit-Status, KI-Bots in 3 Stufen, Hausregeln mit Presets, Zuschauer-Modus
- **Live:** Würfel-, Figuren- und Karten-Animationen bei allen gleichzeitig,
  Echtzeit-Versteigerungen mit Countdown, Handel mit Gegenangebot, Chat, Emotes
- **Robust:** Wiederverbinden mit gespeicherter Sitzung, KI-Übernahme nach 2 Minuten
  Abwesenheit (oder Entfernen durch den Host), Zug-Timer mit Auto-Zug, Rate-Limiting,
  automatisches Aufräumen inaktiver Räume, Snapshots (Spielstand überlebt Neustarts)
- **Statistik:** Siegerehrung mit Podium, Vermögensverlauf, Heatmap, Finanzen, Würfel,
  Handel/Auktionen, Auszeichnungen, Export als PNG/JSON, Replay-Log

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bash
npm install
npm start          # → http://localhost:3000
```

Zum Ausprobieren auf einem Rechner öffnest du einfach **mehrere Tabs**. Jeder Tab ist ein
eigener Spieler (die Sitzung liegt im `sessionStorage` des Tabs). Lädst du einen Tab neu,
bist du sofort wieder im Spiel. Schließt du ihn, kommst du über den Einladungslink
(`/r/CODE`) zurück, weil die Sitzung zusätzlich pro Raum im `localStorage` liegt.

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | HTTP-Port (Hoster setzen ihn automatisch) | `3000` |
| `PERSIST` | `0` schaltet Snapshots ab | an |
| `DATA_DIR` | Ordner für `rooms.json` | `./data` |
| `BOT_DELAY_MS` | Bedenkzeit der KI | `900` |

## Online stellen (Freunde spielen per Link mit)

Der Server ist ein einzelner Node-Prozess (Express + Socket.IO), der auch die Webseite
ausliefert. Jeder Hoster mit WebSocket-Unterstützung funktioniert.

### Render.com (kostenlos, dauerhafter Link)
1. Das Projekt liegt bereits auf GitHub (`Tobi-15/BigYahuopoly`).
2. Auf [render.com](https://render.com) **New → Blueprint** wählen und das Repo auswählen.
   Die `render.yaml` richtet alles ein (Build `npm install --omit=dev`, Start `npm start`,
   Healthcheck `/healthz`).
3. Den Link `https://<name>.onrender.com` an Freunde schicken. Einer erstellt einen Raum,
   die anderen öffnen den Einladungslink.

Hinweis: Der Gratis-Plan schläft nach 15 Minuten ohne Besucher ein. Der erste Aufruf dauert
dann etwa eine Minute. Bei einem Neustart oder Deploy geht dort der Snapshot verloren,
weil das Dateisystem nicht dauerhaft ist.

### Railway
**New Project → Deploy from GitHub Repo.** Railway erkennt Node automatisch und setzt
`PORT`. Unter *Settings → Networking → Generate Domain* bekommst du den Link.

### Fly.io
```bash
fly launch --copy-config --no-deploy   # nutzt fly.toml und das Dockerfile
fly deploy
```
Damit Spielstände Neustarts überleben, ein Volume anlegen und `DATA_DIR` darauf zeigen
lassen (`fly volumes create data` + `[mounts]` in `fly.toml`).

### Schnell vom eigenen Rechner (temporär)
```bash
npm start
cloudflared tunnel --url http://localhost:3000   # gibt eine https://….trycloudflare.com-URL aus
```

### Eigener Server
Schritt-für-Schritt-Anleitung (Projekt per GitHub holen, systemd-Dienst, HTTPS mit Caddy oder
nginx, Updates, Docker-Variante): **[`docs/SERVER.md`](docs/SERVER.md)**. Kurzfassung:
```bash
# einmalig: Deploy-Key einrichten (docs/SERVER.md, Abschnitt 1), dann:
git clone git@github-bigyahuopoly:Tobi-15/BigYahuopoly.git /opt/bigyahuopoly && cd /opt/bigyahuopoly
npm ci --omit=dev && npm start      # dauerhaft als systemd-Dienst: docs/SERVER.md, Abschnitt 2
```

## Zusammenarbeit

Das Repo [`Tobi-15/BigYahuopoly`](https://github.com/Tobi-15/BigYahuopoly) ist öffentlich (Schreibzugriff nur für eingeladene Mitentwickler). Mitentwickler
brauchen ein kostenloses GitHub-Konto und eine Einladung:

1. **Einladen:** auf GitHub im Repo **Settings → Collaborators → Add people** und den
   Benutzernamen eingeben. Oder im Terminal:
   `gh api -X PUT repos/Tobi-15/BigYahuopoly/collaborators/BENUTZERNAME -f permission=push`
2. **Annehmen:** Die eingeladene Person bekommt eine Mail bzw. Benachrichtigung auf GitHub und nimmt an.
3. **Loslegen:**
   ```bash
   git clone https://github.com/Tobi-15/BigYahuopoly.git   # oder: gh repo clone Tobi-15/BigYahuopoly
   cd BigYahuopoly && npm install && npm start
   ```

Arbeitsablauf, damit sich Änderungen nicht in die Quere kommen:
- vor dem Arbeiten `git pull`
- kleine, beschreibende Commits; vor dem Push `npm test`
- danach `git push`. Bei größeren Umbauten lieber einen eigenen Branch und einen Pull Request.
- Den Server aktualisiert ihr mit `git pull` + Neustart (siehe `docs/SERVER.md`, Abschnitt 4).

## Tests

```bash
npm test         # 86 Tests: Spiellogik, jede Hausregel, Räume, Statistik, Bot-Fuzzing, Multi-Client
npm run sim      # 100 komplette Bot-Spiele mit Invarianten-Prüfung
```

- `test/game.test.js`: Miete, Gefängnis, Pasch, Bauen, Hypotheken, Bankrott, Versteigerung, Handel, Karten
- `test/houserules.test.js`: Regel-Validierung, Presets und **jede Hausregel** (Standard vs. geändert)
- `test/rooms.test.js`: Host-Rechte, Bereit-Status, Regelprüfung beim Start, Bots, Abwesenheit
- `test/stats.test.js`: Statistik-Sammler und Auswertung (inkl. komplettem Spiel)
- `test/simulation.test.js`: 40 komplette Bot-Spiele mit 5 Regel-Varianten. Nach jeder
  Aktion werden Invarianten geprüft (kein negatives Geld, Gebäude- und Kartenbestand, stabile Phase).
- `test/multiplayer.test.js`: echte Socket.IO-Clients. Abgedeckt sind Lobby, Synchronität bei
  3 Clients, Reconnect, Abwesenheit mit KI-Übernahme, Zuschauer, Chat, Rate-Limit,
  Zug-Timer, ein komplettes Spiel bis zum Statistik-Screen mit Revanche, Host-Rechte und
  Server-Neustart mit Snapshot.

Die Checkliste aller Regeln und Hausregeln steht in [`docs/CHECKLIST.md`](docs/CHECKLIST.md),
das Netzwerk-Protokoll in [`docs/PROTOCOL.md`](docs/PROTOCOL.md).

## Aufbau

```
shared/                 von Server UND Browser genutzt (ES-Module, keine Abhängigkeiten)
  board.js              40 Felder, Preise, Mieten, Hypotheken (Originalwerte)
  cards.js              16 Ereignis- und 16 Gemeinschaftskarten
  rules.js              Hausregeln: Definitionen, Standardwerte, Validierung, Presets
  logic.js              reine Regel-Funktionen: Miete, Bauen erlaubt?, Vermögen …
  tokens.js             8 Spielfiguren mit festen Farben
server/
  game/Game.js          Zustandsautomat der Spiellogik (liest nur aus der Regel-Konfiguration)
  game/stats.js         Statistik-Sammler + Auswertung + Auszeichnungen
  game/bot.js           KI in 3 Stufen (nutzt dieselben Aktionen wie Menschen)
  rooms.js              Räume, Lobby, Bots, Timer, Abwesenheit, Snapshots
  socket.js             Netzwerk-Protokoll, Eingabeprüfung, Rate-Limit
  persist.js            JSON-Snapshots
  app.js, index.js      Express + Socket.IO, Start
public/
  index.html, css/style.css
  js/main.js            Bildschirme, Verbindung, Wiederverbinden
  js/lobby.js           Startseite, Lobby, Hausregel-Editor, Presets
  js/game.js            Spielansicht, Animations-Warteschlange, Aktionen
  js/board.js           Brett (DOM/CSS-Grid), Figuren, 3D-Würfel, Karten, Heatmap
  js/trade.js           Handel
  js/stats.js           Statistik-Screen, Replay-Log, Bild-Export
  js/charts.js          SVG-Diagramme (Linie, Balken, Histogramm)
  js/sound.js           Soundeffekte per WebAudio (ohne Audiodateien)
```

**Ablauf einer Aktion:** Der Client sendet z. B. `game:roll`. Der Server prüft Phase und
Spieler, `Game.act()` würfelt, bewegt, wertet das Feld aus und sammelt *Ereignisse*
(`dice`, `move`, `card`, `money` …). Danach gehen der neue Zustand und die Ereignisse an alle.
Jeder Client spielt die Ereignisse als Animation ab und zeigt dann den neuen Zustand an.
Hängt ein Tab hinterher (z. B. im Hintergrund), werden die Animationen übersprungen.

## Hausregeln

Der Host stellt sie in der Lobby ein. Jede Regel hat ihren Original-Standardwert und einen
Tooltip. Der Server validiert die Regeln bei jeder Änderung und erneut beim Spielstart.
Danach sind sie fest und im Spiel jederzeit über **§ Regeln** einsehbar.

Startgeld · LOS-Gehalt · doppeltes Gehalt genau auf LOS · Frei-Parken-Jackpot ·
Versteigerungen · gleichmäßiges Bauen · doppelte Miete bei Farbgruppe · Miete im Gefängnis ·
Hypothekenzinsen 10 %/0 % · Kaution · max. Gefängnisrunden · Gebäudelimit 32/12 oder
unbegrenzt · Zug-Timer · Handel an/aus und Sperrrunden · Siegbedingung (letzter Überlebender,
Rundenlimit, Zeitlimit) · Bot-Handicap · Startbonus pro Spieler

**Presets:** Klassisch · Schnelles Spiel · Party-Modus · Eigene Regeln (im Browser
gespeichert, jederzeit wieder ladbar)
