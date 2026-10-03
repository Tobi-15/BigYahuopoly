# Netzwerk-Protokoll

Transport: Socket.IO (WebSocket, Fallback Long-Polling). Jede Client-Nachricht wird
mit einer Antwort (Ack) beantwortet:

```js
socket.emit('game:roll', {}, (res) => res.ok ? … : alert(res.error));
// res = { ok: true, …daten } | { ok: false, error: 'Text', code?: 'GAME_RUNNING' | 'IN_USE' }
```

Der Server ist autoritativ: Clients schicken nur Absichten, der Server prüft Phase,
Spieler, Regeln und Eingaben und verteilt danach den neuen Zustand an alle.
Rate-Limit: 25 Aktionen am Stück, 12 pro Sekunde nachgefüllt; Chat 5 am Stück,
1 alle 2 Sekunden; max. 6 neue Räume pro Minute und IP.

## Client → Server

### Räume und Lobby

| Event | Daten | Antwort | Wer |
|---|---|---|---|
| `room:peek` | `{ code }` | `{ exists, status, taken[], players, maxPlayers }` | alle |
| `room:create` | `{ name, token }` | `{ code, playerId, secret }` | alle |
| `room:join` | `{ code, name, token }` oder `{ code, name, spectator: true }` | `{ code, playerId, secret }` | alle |
| `room:rejoin` | `{ code, playerId, secret, force? }` | `{ code, playerId, secret, status }` | Mitglied |
| `room:leave` | `{}` | `{}` | Mitglied |
| `room:rules:update` | `{ rules }` (vollständiges Regelobjekt) | `{}` | Host, Lobby |
| `room:settings:update` | `{ maxPlayers }` (2–6) | `{}` | Host, Lobby |
| `room:ready` | `{ ready }` | `{}` | Mitglied, Lobby |
| `room:token` | `{ token }` | `{}` | Mitglied, Lobby |
| `room:kick` | `{ playerId }` | `{}` | Host (im Spiel nur abwesende Spieler) |
| `room:bot:add` | `{ level: 'easy'｜'medium'｜'hard' }` | `{}` | Host, Lobby |
| `room:bot:fill` | `{ level }` | `{ added }` | Host, Lobby |
| `room:bot:level` | `{ playerId, level }` | `{}` | Host, Lobby |
| `room:start` | `{}` | `{}` | Host, Lobby |
| `room:rematch` | `{}` | `{}` | Host, nach Spielende |
| `room:lobby` | `{}` | `{}` | Host, nach Spielende |

`room:rejoin` ohne `force` wird mit `code: 'IN_USE'` abgelehnt, wenn der Spieler schon
in einem anderen Fenster verbunden ist. Mit `force: true` übernimmt das neue Fenster.
Ein Beitritt während eines laufenden Spiels wird mit `code: 'GAME_RUNNING'` abgelehnt.
Dann ist nur Zuschauen möglich.

### Spielaktionen

| Event | Daten | Phase | Wer |
|---|---|---|---|
| `game:roll` | – | `roll`, `jail` | aktiver Spieler |
| `game:jail:pay` | – | `jail` | aktiver Spieler |
| `game:jail:card` | – | `jail` | aktiver Spieler |
| `game:buy` | – | `buy` | aktiver Spieler |
| `game:decline` | – | `buy` | aktiver Spieler (→ Versteigerung) |
| `game:endTurn` | – | `end` | aktiver Spieler |
| `game:build` | `{ idx }` | `roll`, `jail`, `end` | aktiver Spieler |
| `game:sell` | `{ idx }` | `roll`, `jail`, `buy`, `end`, `debt` | aktiver Spieler / Schuldner |
| `game:mortgage` | `{ idx }` | `roll`, `jail`, `buy`, `end`, `debt` | aktiver Spieler / Schuldner |
| `game:unmortgage` | `{ idx }` | `roll`, `jail`, `end` | aktiver Spieler |
| `game:auction:bid` | `{ amount }` | `auction` | alle nicht ausgestiegenen Spieler |
| `game:auction:pass` | – | `auction` | alle nicht ausgestiegenen Spieler |
| `game:debt:pay` | – | `debt` | Schuldner |
| `game:bankrupt` | – | `debt` | Schuldner |
| `game:resign` | – | jede außer `over` | jeder Spieler (aufgeben) |
| `trade:offer` | `{ to, give: { props[], money, cards }, get: {…} }` | jede außer `auction` | jeder Spieler |
| `trade:accept` | `{ id }` | jede außer `auction` | Empfänger |
| `trade:reject` | `{ id }` | jede | Empfänger |
| `trade:cancel` | `{ id }` | jede | Absender |
| `trade:counter` | `{ id, give, get }` | jede außer `auction` | Empfänger (Rollen tauschen) |

### Sonstiges

| Event | Daten | Antwort |
|---|---|---|
| `stats:request` | – | `{ stats }` (Live- oder End-Statistik) |
| `replay:request` | – | `{ log: [{ id, round, t, text, kind, pid }] }` |
| `chat:message` | `{ text }` (max. 300 Zeichen) | `{}` |
| `chat:emote` | `{ emote }` (👏 😂 😡 😱 🎉 👍 😭 🤑 🔥 🙈) | `{}` |

## Server → Client

| Event | Daten | Wann |
|---|---|---|
| `room:update` | `{ code, hostId, status, settings, rules, members[], spectators }` | jede Lobby-Änderung, Statuswechsel |
| `state:update` | `{ state, events[], serverNow, full? }` | nach jeder Spielaktion; `full: true` beim (Wieder-)Beitritt |
| `stats:update` | Statistik-Auswertung | bei Spielende (und beim Beitritt in ein beendetes Spiel) |
| `chat:history` | `[{ id, ts, from, name, text, system?, spectator? }]` | beim Beitritt |
| `chat:message` | `{ id, ts, from, name, text, system?, spectator? }` | neue Nachricht |
| `chat:emote` | `{ from, name, emote, ts }` | Emote |
| `toast` | `{ kind, text }` | Hinweise |
| `room:kicked` | `{ reason: 'kick'｜'takeover' }` | vom Host entfernt / Sitzung in anderem Fenster |

Bei jedem Beitritt und Wiederverbinden schickt der Server den **kompletten** Zustand
(`room:update`, `chat:history`, `state:update` mit `full: true`, ggf. `stats:update`).

### Spielzustand (`state`)

```js
{
  players: [{ id, name, token, isBot, botLevel, money, position, inJail, jailTurns,
              jailCards: ['c10'], bankrupt, online, away }],
  props: { [feldIndex]: { owner, houses /* 0–4, 5 = Hotel */, mortgaged } },
  bank: { houses, hotels },
  currentPid, round, turnNo,
  phase: 'roll' | 'jail' | 'buy' | 'auction' | 'debt' | 'end' | 'over',
  turn: { pid, dice: [a, b] | null, doubles, rollAgain },
  pendingBuy,                       // Feldindex in Phase 'buy'
  auction: { idx, bid, bidder, endsAt, passed[], bids } | null,
  debt: { debtor, creditor, amount, kind, meta } | null,
  trades: [{ id, from, to, give, get, createdAt, counterOf }],
  pot,                              // Frei-Parken-Jackpot
  lastCard, log: [/* letzte 60 Einträge */],
  deadline,                         // Zug-Timer (ms, Serverzeit) oder null
  responsible,                      // wer gerade handeln muss
  winner, ranking, endReason, startedAt, endedAt,
  rules                             // aktive Hausregeln + feste Konstanten
}
```

Kartenstapel-Reihenfolgen und Reconnect-Geheimnisse werden nie an Clients geschickt.

### Ereignisse (`events`) für Animationen

| `t` | Felder | Bedeutung |
|---|---|---|
| `dice` | `pid, dice, forRent?` | Würfelwurf |
| `move` | `pid, from, to, steps, direct?` | Figur bewegt sich (steps < 0 = rückwärts, direct = ins Gefängnis) |
| `card` | `pid, deck, id, text` | Karte gezogen |
| `money` | `pid, delta, kind` | Kontostand ändert sich |
| `buy` / `auctionEnd` | `pid, idx, price/amount` | Feld gekauft / ersteigert |
| `build` | `pid, idx, houses` | Gebäude gebaut/verkauft |
| `mortgage` | `pid, idx, mortgaged` | Hypothek |
| `jail` / `release` / `jailCard` | `pid` | Gefängnis |
| `auctionStart` / `bid` / `pass` | `idx` / `pid, amount` / `pid` | Versteigerung |
| `debt` | `pid, amount` | Schulden entstanden |
| `bankrupt` | `pid, creditor` | Bankrott |
| `jackpot` | `pid, amount` | Frei-Parken-Jackpot |
| `tradeOffer` / `tradeDone` / `tradeRejected` | `id, from, to` | Handel |
| `turn` | `pid` | neuer Zug |
| `gameOver` | `winner, reason` | Spielende |
