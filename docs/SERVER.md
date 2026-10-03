# Auf dem eigenen Server betreiben

Das Spiel ist ein einzelner Node-Prozess (Port 3000), der Webseite und Echtzeit-Verbindung
ausliefert. Davor sitzt ein Webserver (Caddy oder nginx), der HTTPS übernimmt und die
WebSocket-Verbindungen weiterreicht. Die Befehle unten sind für ein Debian/Ubuntu-artiges Linux
geschrieben, auf anderen Systemen heißen nur die Paketbefehle anders.

## Voraussetzungen

- Node.js **20 oder neuer** (`node --version`), `git`
- eine (Sub-)Domain, die auf den Server zeigt, z. B. `monopoly.deine-domain.de`
- Ports 80 und 443 von außen erreichbar

## 1. Projekt von GitHub holen

Das Repo `Tobi-15/monopoly` ist privat. Der Server braucht deshalb eine Berechtigung zum Lesen.
Empfohlen ist ein **Deploy-Key**: ein SSH-Schlüssel, der nur dieses eine Repo lesen darf.

Auf dem Server:
```bash
ssh-keygen -t ed25519 -C "monopoly-server" -f ~/.ssh/monopoly_deploy -N ""
cat ~/.ssh/monopoly_deploy.pub        # diese Zeile kopieren
```

Den öffentlichen Schlüssel bei GitHub eintragen: Repo **Settings → Deploy keys → Add deploy key**.
Titel z. B. „Server“, Schlüssel einfügen, *Allow write access* **nicht** anhaken. Alternativ geht
das vom eigenen PC aus mit `gh repo deploy-key add monopoly_deploy.pub --repo Tobi-15/monopoly --title Server`.

Danach auf dem Server `~/.ssh/config` ergänzen, damit Git diesen Schlüssel benutzt:
```
Host github-monopoly
  HostName github.com
  User git
  IdentityFile ~/.ssh/monopoly_deploy
  IdentitiesOnly yes
```

Und klonen:
```bash
sudo mkdir -p /opt/monopoly && sudo chown "$USER" /opt/monopoly
git clone git@github-monopoly:Tobi-15/monopoly.git /opt/monopoly
cd /opt/monopoly
npm ci --omit=dev
```

*Einfachere Alternative:* `gh auth login` auf dem Server und dann
`gh repo clone Tobi-15/monopoly /opt/monopoly`. Dann hat der Server aber Zugriff auf dein ganzes
GitHub-Konto, nicht nur auf dieses Repo.

## 2. Als Dienst einrichten

Datei `/etc/systemd/system/monopoly.service`:
```ini
[Unit]
Description=Monopoly Online
After=network.target

[Service]
WorkingDirectory=/opt/monopoly
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/monopoly
StateDirectory=monopoly
DynamicUser=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
`ExecStart` muss auf dein Node zeigen. Den richtigen Pfad liefert `which node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now monopoly
systemctl status monopoly          # sollte "active (running)" zeigen
curl -s localhost:3000/healthz     # → {"ok":true,"rooms":0}
journalctl -u monopoly -f          # Logs ansehen
```

Laufende Spielstände werden in `/var/lib/monopoly/rooms.json` gesichert. Das passiert regelmäßig
und beim Beenden des Dienstes.

## 3. HTTPS und Domain

### Mit Caddy (am einfachsten)
Caddy holt das Zertifikat selbst und reicht WebSockets automatisch weiter. In `/etc/caddy/Caddyfile`:
```
monopoly.deine-domain.de {
    reverse_proxy localhost:3000
}
```
Danach `sudo systemctl reload caddy`. Fertig: `https://monopoly.deine-domain.de`.

### Mit nginx (falls schon vorhanden)
```nginx
server {
    server_name monopoly.deine-domain.de;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_read_timeout 3600s;
    }
}
```
Zertifikat holen mit `sudo certbot --nginx -d monopoly.deine-domain.de`. Die Zeilen `Upgrade` und
`Connection` sind nötig für die Echtzeit-Verbindung. `X-Forwarded-For` braucht der Spam-Schutz, um
Spieler auseinanderzuhalten.

### Port 3000 sperren
Alle Zugriffe sollen über Caddy oder nginx laufen. Der Server vertraut der Angabe
`X-Forwarded-For`; wäre Port 3000 direkt offen, ließe sich der Spam-Schutz umgehen.
```bash
sudo ufw allow 80,443/tcp
sudo ufw deny 3000/tcp
```

## 4. Updates einspielen

Wenn du oder dein Freund Änderungen nach GitHub gepusht habt:
```bash
cd /opt/monopoly
git pull
npm ci --omit=dev
sudo systemctl restart monopoly
```
Laufende Spiele überstehen den Neustart, weil der Dienst den Spielstand beim Beenden sichert.
Die Spieler verbinden sich danach automatisch neu.

## Alternative: Docker

Wenn auf dem Server ohnehin Docker läuft (nach dem Klonen in Schritt 1):
```bash
cd /opt/monopoly
docker build -t monopoly .
docker run -d --name monopoly --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v monopoly-data:/app/data monopoly
```
Davor wieder Caddy oder nginx wie oben. Update: `git pull`, dann `docker build` und den Container
neu starten (`docker rm -f monopoly`, danach erneut `docker run …`). Hinweis: Den Docker-Build
konnten wir bisher nicht testen. Der Start mit Node (ohne Docker) ist geprüft.

## Ohne Domain (nur im Heimnetz)

Ohne Domain gibt es kein HTTPS-Zertifikat. Im Heimnetz reicht dann `http://<IP-des-Servers>:3000`.
In dem Fall Port 3000 im Router **nicht** nach außen freigeben. Für Freunde außerhalb des Netzes
ist eine Domain mit HTTPS der saubere Weg.
