/**
 * Server-Aufbau: Express (statische Dateien, Healthcheck) + Socket.IO.
 * Getrennt von index.js, damit Tests einen Server auf einem freien Port
 * starten können.
 */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { RoomManager } from './rooms.js';
import { setupSockets } from './socket.js';
import { Persistence } from './persist.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {object} [opts]
 * @param {number} [opts.botDelayMs]   Bedenkzeit der Bots (Tests: klein)
 * @param {number} [opts.absenceMs]    Abwesenheit bis zur KI-Übernahme
 * @param {string|null} [opts.persistFile] Snapshot-Datei oder null
 */
export function createServer(opts = {}) {
  const app = express();
  app.disable('x-powered-by');
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 32 * 1024,
    pingInterval: 10000,
    pingTimeout: 8000,
    // liefert /socket.io/socket.io.min.js für den Browser aus (kein Build nötig)
    serveClient: true,
  });

  let persistence = null;
  const rooms = new RoomManager({
    io,
    botDelayMs: opts.botDelayMs,
    absenceMs: opts.absenceMs,
    onChange: () => persistence?.markDirty(),
  });
  if (opts.persistFile) {
    persistence = new Persistence(opts.persistFile, rooms);
    const n = persistence.load();
    if (n) console.log(`${n} Raum/Räume aus Snapshot wiederhergestellt.`);
    persistence.start();
  }

  setupSockets(io, rooms, opts.limits);

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.get('/healthz', (req, res) => res.json({ ok: true, rooms: rooms.rooms.size }));
  app.use('/shared', express.static(path.join(root, 'shared'), { maxAge: 0 }));
  app.use(express.static(path.join(root, 'public'), { maxAge: 0 }));
  // Einladungslinks /r/ABCD liefern die App aus
  app.get('/r/:code', (req, res) => res.sendFile(path.join(root, 'public/index.html')));

  const close = () => new Promise((resolve) => {
    persistence?.stop();
    persistence?.save();
    io.close();
    rooms.stop();
    server.close(() => resolve());
  });

  return { app, server, io, rooms, persistence, close };
}
