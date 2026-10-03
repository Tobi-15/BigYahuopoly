/**
 * Snapshots aller Räume (inkl. Spielstand) als JSON-Datei.
 *
 * Wird regelmäßig und beim Beenden geschrieben und beim Start geladen. So
 * überleben laufende Spiele einen Neustart des Servers. Für mehrere
 * Server-Instanzen wäre Redis der nächste Schritt; für Freundesrunden reicht
 * eine Datei. Abschalten mit PERSIST=0.
 */
import fs from 'node:fs';
import path from 'node:path';

export class Persistence {
  constructor(file, rooms) {
    this.file = file;
    this.rooms = rooms;
    this.dirty = false;
    this.timer = null;
  }

  markDirty() {
    this.dirty = true;
  }

  load() {
    try {
      if (!fs.existsSync(this.file)) return 0;
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.rooms.restore(data.rooms);
      return this.rooms.rooms.size;
    } catch (err) {
      console.error('Snapshot konnte nicht geladen werden:', err.message);
      return 0;
    }
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), rooms: this.rooms.toJSON() }));
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (err) {
      console.error('Snapshot konnte nicht gespeichert werden:', err.message);
    }
  }

  start(intervalMs = 15000) {
    this.timer = setInterval(() => { if (this.dirty) this.save(); }, intervalMs);
    this.timer.unref?.();
  }

  stop() {
    clearInterval(this.timer);
  }
}
