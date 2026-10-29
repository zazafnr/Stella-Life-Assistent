#!/usr/bin/env bash
# Stella auf einem Ubuntu-VPS installieren, auf dem schon Caddy läuft (z. B. neben RugScan).
# Ohne Docker: eigener systemd-Dienst, eigener Benutzer, eigener Caddy-Eintrag.
# Läuft beliebig oft (Updates = einfach nochmal ausführen).
#
#   sudo STELLA_DOMAIN=stella.example.at ./deploy/install-vps.sh
#
# Optional: STELLA_PORT (Standard 8795), OPENROUTER_API_KEY (nur beim ersten Mal nötig).
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP=/opt/stella
DATA=/var/lib/stella
ENV_DIR=/etc/stella
ENV_FILE=$ENV_DIR/stella.env
PORT=${STELLA_PORT:-8795}
DOMAIN=${STELLA_DOMAIN:?STELLA_DOMAIN setzen, z. B. stella.example.at}
CADDYFILE=/etc/caddy/Caddyfile
BROWSERS=$APP/ms-playwright

log() { echo "==> $*"; }

[[ $EUID -eq 0 ]] || { echo "Bitte als root ausführen." >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js fehlt (mind. Version 22)." >&2; exit 1; }

log "Benutzer und Ordner"
id stella >/dev/null 2>&1 || useradd --system --home-dir "$DATA" --shell /usr/sbin/nologin stella
mkdir -p "$APP" "$DATA" "$ENV_DIR"

log "Code nach $APP kopieren"
if [[ "$SRC" != "$APP" ]]; then
  find "$APP" -mindepth 1 -maxdepth 1 ! -name ms-playwright ! -name node_modules -exec rm -rf {} +
  tar -C "$SRC" --exclude=./node_modules --exclude=./data --exclude=./.git --exclude='./*/node_modules' -cf - . | tar -C "$APP" -xf -
fi

log "Abhängigkeiten installieren und Web-App bauen"
cd "$APP"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund
npm run build

log "Chromium für Schulbücher und Handschrift"
PLAYWRIGHT_BROWSERS_PATH=$BROWSERS npx playwright install --with-deps chromium

log "Konfiguration ($ENV_FILE)"
if [[ ! -f $ENV_FILE ]]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
STELLA_PUBLIC_URL=https://$DOMAIN
STELLA_SECRET=$(openssl rand -base64 32)
OPENROUTER_API_KEY=${OPENROUTER_API_KEY:-}
STELLA_LLM_DAILY_LIMIT=50
STELLA_TIMEZONE=Europe/Vienna
STELLA_ALLOW_REGISTRATION=false
EOF
fi
# Diese Werte gehören zur Installation und werden immer gesetzt
set_env() { grep -q "^$1=" "$ENV_FILE" && sed -i "s|^$1=.*|$1=$2|" "$ENV_FILE" || echo "$1=$2" >> "$ENV_FILE"; }
set_env STELLA_PUBLIC_URL "https://$DOMAIN"
set_env PORT "$PORT"
set_env HOST 127.0.0.1
set_env STELLA_DATA_DIR "$DATA"
set_env PLAYWRIGHT_BROWSERS_PATH "$BROWSERS"
chmod 600 "$ENV_FILE"

chown -R stella:stella "$DATA"
chmod -R a+rX "$APP"

log "systemd-Dienst"
cat > /etc/systemd/system/stella.service <<EOF
[Unit]
Description=Stella Life Assistant
After=network-online.target
Wants=network-online.target

[Service]
User=stella
Group=stella
WorkingDirectory=$APP/server
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $APP/node_modules/tsx/dist/cli.mjs src/main.ts
Restart=always
RestartSec=5
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=$DATA

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable stella >/dev/null
systemctl restart stella

log "Caddy ($DOMAIN → 127.0.0.1:$PORT)"
BLOCK="# stella-begin
$DOMAIN {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}
# stella-end"
cp "$CADDYFILE" "$CADDYFILE.vor-stella"
# alten Stella-Block entfernen, neuen anhängen – der Rest der Datei bleibt unangetastet
sed -i '/^# stella-begin$/,/^# stella-end$/d' "$CADDYFILE"
printf '\n%s\n' "$BLOCK" >> "$CADDYFILE"
if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  systemctl reload caddy
else
  echo "Caddy-Konfiguration ungültig – alte Version wiederhergestellt." >&2
  cp "$CADDYFILE.vor-stella" "$CADDYFILE"
  exit 1
fi

log "Prüfen"
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/api/status" && echo
echo "Fertig: https://$DOMAIN"
