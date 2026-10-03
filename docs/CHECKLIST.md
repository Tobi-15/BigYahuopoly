# Regel-Checkliste

Stand: alle Punkte umgesetzt und durch automatische Tests abgedeckt (`npm test`, 86 Tests).
In der Spalte „Test“ steht die Datei und der Testname bzw. die Testgruppe.

## Spielbrett und Karten

| Regel | Umsetzung | Test |
|---|---|---|
| 40 Felder, LOS, Gefängnis, Frei Parken, Gehe ins Gefängnis | `shared/board.js` | game: Grundablauf, Gefängnis |
| 22 Straßen in 8 Farbgruppen, 4 Bahnhöfe, 2 Werke, deutsche Namen | `shared/board.js` | game: Kaufen und Miete |
| Mieten (Grund, 1–4 Häuser, Hotel), Hauspreise, Hypothekenwerte wie im Original | `shared/board.js` | game: Grundmiete … Hotel |
| Einkommensteuer 200 €, Zusatzsteuer 100 € | `shared/board.js` | game: Steuern |
| 16 Ereignis- + 16 Gemeinschaftskarten | `shared/cards.js` | game: Karten (8 Tests) |
| Stapel serverseitig gemischt, Karte danach unter den Stapel | `Game.drawCard` | game: Rücke vor bis auf LOS |
| Freikarte bleibt beim Spieler, nach Nutzung zurück unter den Stapel | `Game.doUseCard` | game: Kaution zahlen und Freikarte nutzen |
| Kartenbestand bleibt vollständig (32 Karten) | Invariante | simulation (40 Spiele) |

## Standardregeln

| Regel | Umsetzung | Test |
|---|---|---|
| 2–6 Spieler, Startgeld 1500, 200 über LOS | `rules.js`, `Game.paySalary` | game: Startgeld …, LOS überqueren |
| 2 Würfel, Pasch = noch einmal, 3× Pasch = Gefängnis | `Game.doRoll` | game: Pasch … Gefängnis |
| Gefängnis: Kaution, Freikarte oder Pasch, max. 3 Runden, dann zahlen und ziehen | `Game.rollInJail` | game: Gefängnis (4 Tests) |
| Pasch im Gefängnis befreit, aber ohne weiteren Wurf | `Game.rollInJail` | game: Pasch befreit … |
| Kaufen oder Versteigerung an alle | `Game.doBuy/doDecline` | game: Ablehnen startet Versteigerung |
| Versteigerung: Countdown, Reset bei jedem Gebot, Aussteigen, Zuschlag | `Game.doBid/doPass/endAuction` | game: Versteigerung (3 Tests) |
| Doppelte Miete bei unbebauter Farbgruppe | `logic.calcRent` | game: Grundmiete, doppelte Miete … |
| Bahnhöfe nach Anzahl (25/50/100/200), Werke 4×/10× Augen | `logic.calcRent` | game: Bahnhöfe … Werke |
| Keine Miete auf Hypotheken | `logic.calcRent` | game: Keine Miete auf Hypothek |
| Bauen nur mit kompletter Gruppe, gleichmäßig, ohne Hypothek in der Gruppe | `logic.canBuild` | game: Bauen nur mit … |
| Hotel nach 4 Häusern, Häuser zurück an die Bank | `Game.doBuild` | game: Hotel: 4 Häuser zurück … |
| Bankbestand 32 Häuser / 12 Hotels | `logic.canBuild` | game: Bankbestand begrenzt das Bauen |
| Rückverkauf zum halben Preis, gleichmäßig | `logic.canSellBuilding` | game: Hotel … Verkauf zum halben Preis |
| Hypothek = halber Preis, nur ohne Gebäude in der Gruppe, Rückzahlung +10 % | `logic.canMortgage`, `Game.doUnmortgage` | game: Hypothek nur ohne Gebäude … |
| Übernommene Hypothek (Handel/Bankrott): 10 % Zinsen sofort | `Game.doTradeAccept`, `declareBankrupt` | game: Übernommene Hypothek …, Bankrott an einen Spieler |
| Zu wenig Geld → Geld beschaffen oder Bankrott | `Game.charge`, Phase `debt` | game: Zu wenig Geld: Schuldenphase … |
| Bankrott an Spieler: Geld, Felder, Freikarten an Gläubiger; Gebäude zum halben Preis | `Game.declareBankrupt` | game: Bankrott an einen Spieler |
| Bankrott an die Bank: Felder zurück und versteigert | `Game.declareBankrupt` | game: Bankrott an die Bank … |
| Spielende, wenn nur noch einer übrig ist | `Game.endGame` | game: Letzter Überlebender gewinnt |
| Mitspieler gerät durch Karte in Schulden (Geburtstag) | Schulden-Warteschlange | game: Geburtstag: Mitspieler ohne Geld … |
| Handel: Felder, Geld, Freikarten; Prüfung durch Server; Gegenangebot | `Game.doTrade*` | game: Handel (5 Tests) |
| Kein Handel von Feldern mit Gebäuden in der Gruppe | `logic.isTradeable` | game: Ungültige Angebote … |

## Hausregeln (jede mit Test „Standard vs. geändert“)

| Hausregel | Standard | Test (houserules) |
|---|---|---|
| Startgeld 500–5000 | 1500 | Startgeld |
| LOS-Gehalt 100–500 | 200 | LOS-Gehalt |
| Doppeltes Gehalt genau auf LOS | aus | Doppeltes Gehalt genau auf LOS |
| Frei Parken: Jackpot | aus | Frei Parken: Jackpot … |
| Versteigerungen an/aus | an | Versteigerungen aus |
| Gleichmäßiges Bauen | an | Gleichmäßiges Bauen aus |
| Miete im Gefängnis | an | Keine Miete im Gefängnis |
| Doppelte Miete bei Farbgruppe | an | Doppelte Miete bei Farbgruppe abschaltbar |
| Hypothekenzinsen 10 % / 0 % | 10 % | Hypothekenzinsen 0 % |
| Kaution 50–200, max. Gefängnisrunden 1–3 | 50 / 3 | Gefängniskaution und maximale Gefängnisrunden |
| Gebäudelimit 32/12 oder unbegrenzt | 32/12 | Gebäudelimit unbegrenzt |
| Zug-Timer aus/30/60/90/120 s mit Auto-Zug | aus | Zug-Timer setzt eine Frist …; multiplayer: Zug-Timer |
| Handel an/aus, kein Handel in den ersten X Runden | an / 0 | Handel deaktiviert / erst ab Runde X |
| Siegbedingung: letzter Überlebender | ✓ | Letzter Überlebender: Rundenzahl spielt keine Rolle |
| Siegbedingung: Rundenlimit (höchstes Vermögen) | – | Siegbedingung Rundenlimit |
| Siegbedingung: Zeitlimit (laufende Runde wird beendet) | – | Siegbedingung Zeitlimit |
| Bot-Handicap, Startbonus pro Spieler | 0 | Bot-Handicap und Startbonus … |
| Validierung (ungültige Werte, unbekannte Spieler) | – | Ungültige Werte …, Startbonus nur für Spieler im Raum |
| Presets Klassisch / Schnell / Party gültig und erkennbar | – | Presets sind gültig und erkennbar |
| Spiellogik liest nur aus der Konfiguration | `resolveRules` | Spiellogik enthält alle Regeln als Konfiguration |
| Regeln beim Spielstart erneut validiert | `Room.startGame` | rooms: Regeln werden beim Spielstart erneut validiert |

## Multiplayer

| Anforderung | Test |
|---|---|
| Raum erstellen / beitreten, Figur nur einmal | multiplayer: Lobby, Spielstart … |
| Nur der Host ändert Regeln, Bereit-Status nötig | multiplayer: Lobby, Spielstart … |
| Nur der aktive Spieler darf würfeln | multiplayer: Lobby, Spielstart … |
| Alle Clients sehen denselben Zustand | multiplayer: Lobby, Spielstart … |
| Wiederverbinden mit gespeicherter ID + Geheimnis, kompletter Zustand | multiplayer: Lobby, Spielstart … |
| Falsches Geheimnis / zweites Fenster wird abgelehnt | multiplayer: Lobby, Spielstart … |
| KI übernimmt nach Abwesenheit, Host kann entfernen | multiplayer: Lobby, Spielstart … |
| Zuschauer bekommen den Zustand, dürfen nicht handeln | multiplayer: Lobby, Spielstart … |
| Chat, Emotes, Rate-Limit | multiplayer: Lobby, Spielstart … |
| Komplettes Spiel → Statistik → Revanche | multiplayer: Komplettes Spiel … |
| Host entfernt Spieler, Host-Wechsel | multiplayer: Lobby: Host entfernt Spieler …; rooms (7 Tests) |
| Spielstand überlebt Server-Neustart | multiplayer: Snapshot … |

Zusätzlich manuell im Browser geprüft (headless Chromium): 3 Tabs im selben Browser
(Lobby, Regeln, Spielstart, Neuladen eines Tabs), ein komplettes Spiel bis zur
Siegerehrung, Versteigerung, Handel-Dialog, Tooltips, Heatmap, helles/dunkles Design,
Handy-, Tablet- und Desktop-Ansicht. Dabei traten keine Konsolenfehler auf.

## Bekannte Grenzen

- Bauen und Hypotheken nur während des eigenen Zuges (bzw. als Schuldner). Im Original
  ist Bauen „jederzeit“ erlaubt. Die Einschränkung verhindert Konflikte bei gleichzeitigen
  Aktionen und ist in Online-Umsetzungen üblich.
- Gebote in Versteigerungen sind auf das vorhandene Bargeld begrenzt.
- Snapshots liegen in einer JSON-Datei. Für mehrere Server-Instanzen bräuchte es Redis o. ä.
