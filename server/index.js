/**
 * Startpunkt: `npm start` → http://localhost:3000
 *
 * Umgebungsvariablen:
 *   PORT          Port (Standard 3000; Hoster setzen ihn automatisch)
 *   PERSIST       0 = keine Snapshots auf die Festplatte
 *   DATA_DIR      Ordner für Snapshots (Standard ./data)
 *   BOT_DELAY_MS  Bedenkzeit der KI in ms (Standard 900)
 */
import path from 'node:path';
import { createServer } from './app.js';

const PORT = Number(process.env.PORT) || 3000;
const persistFile = process.env.PERSIST === '0' ? null : path.join(process.env.DATA_DIR || 'data', 'rooms.json');

const { server, close } = createServer({
  persistFile,
  botDelayMs: process.env.BOT_DELAY_MS ? Number(process.env.BOT_DELAY_MS) : undefined,
});

server.listen(PORT, () => {
  console.log(`BigYahuopoly läuft auf http://localhost:${PORT}`);
});

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    console.log('Server wird beendet, Spielstände werden gesichert …');
    await close();
    process.exit(0);
  });
}
