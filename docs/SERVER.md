# Auf dem eigenen Server betreiben

Das Spiel ist ein einzelner Node-Prozess (Port 3000), der Webseite und Echtzeit-Verbindung
ausliefert. Davor sitzt ein Webserver (Caddy oder nginx), der HTTPS übernimmt und die
WebSocket-Verbindungen weiterreicht. Die Befehle unten sind für ein Debian/Ubuntu-artiges Linux
geschrieben, auf anderen Systemen heißen nur die Paketbefehle anders.

## Voraussetzungen

- Node.js **20 oder neuer** (`node --version`), `git`
- eine (Sub-)Domain, die auf den Server zeigt, z. B. `bigyahuopoly.deine-domain.de`
- Ports 80 und 443 von außen erreichbar

## 1. Projekt von GitHub holen

Das Repo `Tobi-15/BigYahuopoly` ist öffentlich, der Server kann es also direkt klonen (`git clone https://github.com/Tobi-15/BigYahuopoly.git`). Der Deploy-Key unten ist nur nötig, wenn du das Repo wieder auf privat stellst.
Empfohlen ist ein **Deploy-Key**: ein SSH-Schlüssel, der nur dieses eine Repo lesen darf.

Auf dem Server:
```bash
ssh-keygen -t ed25519 -C "bigyahuopoly-server" -f ~/.ssh/bigyahuopoly_deploy -N ""
cat ~/.ssh/bigyahuopoly_deploy.pub        # diese Zeile kopieren
```

Den öffentlichen Schlüssel bei GitHub eintragen: Repo **Settings → Deploy keys → Add deploy key**.
Titel z. B. „Server“, Schlüssel einfügen, *Allow write access* **nicht** anhaken. Alternativ geht
das vom eigenen PC aus mit `gh repo deploy-key add bigyahuopoly_deploy.pub --repo Tobi-15/BigYahuopoly --title Server`.

Danach auf dem Server `~/.ssh/config` ergänzen, damit Git diesen Schlüssel benutzt:
```
Host github-bigyahuopoly
  HostName github.com
  User git
  IdentityFile ~/.ssh/bigyahuopoly_deploy
  IdentitiesOnly yes
```

Und klonen:
```bash
sudo mkdir -p /opt/bigyahuopoly && sudo chown "$USER" /opt/bigyahuopoly
git clone git@github-bigyahuopoly:Tobi-15/BigYahuopoly.git /opt/bigyahuopoly
cd /opt/bigyahuopoly
npm ci --omit=dev
```

*Einfachere Alternative:* `gh auth login` auf dem Server und dann
`gh repo clone Tobi-15/BigYahuopoly /opt/bigyahuopoly`. Dann hat der Server aber Zugriff auf dein ganzes
GitHub-Konto, nicht nur auf dieses Repo.

## 2. Als Dienst einrichten

Datei `/etc/systemd/system/bigyahuopoly.service`:
```ini
[Unit]
Description=BigYahuopoly
After=network.target

[Service]
WorkingDirectory=/opt/bigyahuopoly
ExecStart=/usr/bin/node server/index.js
Environment=PORT=3000
Environment=DATA_DIR=/var/lib/bigyahuopoly
StateDirectory=bigyahuopoly
DynamicUser=yes
Restart=on-failure

[Install]
WantedBy=multi-user.target
```
`ExecStart` muss auf dein Node zeigen. Den richtigen Pfad liefert `which node`.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now bigyahuopoly
systemctl status bigyahuopoly          # sollte "active (running)" zeigen
curl -s localhost:3000/healthz     # → {"ok":true,"rooms":0}
journalctl -u bigyahuopoly -f          # Logs ansehen
```

Laufende Spielstände werden in `/var/lib/bigyahuopoly/rooms.json` gesichert. Das passiert regelmäßig
und beim Beenden des Dienstes.

## 3. HTTPS und Domain

### Mit Caddy (am einfachsten)
Caddy holt das Zertifikat selbst und reicht WebSockets automatisch weiter. In `/etc/caddy/Caddyfile`:
```
bigyahuopoly.deine-domain.de {
    reverse_proxy localhost:3000
}
```
Danach `sudo systemctl reload caddy`. Fertig: `https://bigyahuopoly.deine-domain.de`.

### Mit nginx (falls schon vorhanden)
```nginx
server {
    server_name bigyahuopoly.deine-domain.de;
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
Zertifikat holen mit `sudo certbot --nginx -d bigyahuopoly.deine-domain.de`. Die Zeilen `Upgrade` und
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
cd /opt/bigyahuopoly
git pull
npm ci --omit=dev
sudo systemctl restart bigyahuopoly
```
Laufende Spiele überstehen den Neustart, weil der Dienst den Spielstand beim Beenden sichert.
Die Spieler verbinden sich danach automatisch neu.

## Alternative: Docker

Wenn auf dem Server ohnehin Docker läuft (nach dem Klonen in Schritt 1):
```bash
cd /opt/bigyahuopoly
docker build -t bigyahuopoly .
docker run -d --name bigyahuopoly --restart unless-stopped \
  -p 127.0.0.1:3000:3000 -v bigyahuopoly-data:/app/data bigyahuopoly
```
Davor wieder Caddy oder nginx wie oben. Update: `git pull`, dann `docker build` und den Container
neu starten (`docker rm -f bigyahuopoly`, danach erneut `docker run …`). Hinweis: Den Docker-Build
konnten wir bisher nicht testen. Der Start mit Node (ohne Docker) ist geprüft.

## Ohne Domain (nur im Heimnetz)

Ohne Domain gibt es kein HTTPS-Zertifikat. Im Heimnetz reicht dann `http://<IP-des-Servers>:3000`.
In dem Fall Port 3000 im Router **nicht** nach außen freigeben. Für Freunde außerhalb des Netzes
ist eine Domain mit HTTPS der saubere Weg.
