#!/usr/bin/env bash
# Stella auf einem Ubuntu-VPS installieren, auf dem schon Caddy läuft (z. B. neben RugScan).
# Ohne Docker: eigener systemd-Dienst, eigener Benutzer, eigener Caddy-Eintrag.
# Läuft beliebig oft (Updates = einfach nochmal ausführen).
#
#   sudo STELLA_DOMAIN=stella.example.at ./deploy/install-vps.sh
#
# Optional: STELLA_PORT (Standard 8795), OPENROUTER_API_KEY (nur beim ersten Mal nötig), STELLA_LOGIN_HOST (Standard login.<domain>),
# STELLA_ALIASES (weitere Adressen, durch Leerzeichen getrennt, die auf dieselbe App zeigen).
set -euo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
APP=/opt/stella
DATA=/var/lib/stella
ENV_DIR=/etc/stella
ENV_FILE=$ENV_DIR/stella.env
PORT=${STELLA_PORT:-8795}
DOMAIN=${STELLA_DOMAIN:?STELLA_DOMAIN setzen, z. B. stella.example.at}
ALIASES=${STELLA_ALIASES:-}
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

log "Edition-Plugin (Stella for Students)"
# Kommt der Code per Git-Klon statt per scripts/deploy-vps.sh, fehlt das Plugin noch: holen. STELLA_EDITION_STUDENTS=off schaltet es ab.
if [[ ${STELLA_EDITION_STUDENTS:-} != off && ! -d $APP/editions/students/server-plugin ]]; then
  if command -v git >/dev/null; then (cd "$APP" && STELLA_FETCH_STRIP_GIT=1 bash scripts/fetch-edition.sh) || echo "Plugin nicht geholt – es läuft das eingebaute Schul-Plugin."
  else echo "git fehlt – es läuft das eingebaute Schul-Plugin."; fi
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
# Anmelde-Links aus den Mails liegen auf eigenem Namen (login.<domain>), DNS: A-Record auf diese IP
LOGIN_HOST=${STELLA_LOGIN_HOST:-login.$DOMAIN}
set_env STELLA_LOGIN_URL "https://$LOGIN_HOST"
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
# IP-Ortsdatenbank (DB-IP Lite) für das ungefähre Wetter ohne Standort: einmal jetzt, danach monatlich
cat > /etc/systemd/system/stella-geoip.service <<EOF
[Unit]
Description=Stella: DB-IP Lite aktualisieren

[Service]
Type=oneshot
Environment=STELLA_DATA_DIR=$DATA
ExecStart=$APP/scripts/update-geoip.sh
EOF
cat > /etc/systemd/system/stella-geoip.timer <<EOF
[Unit]
Description=Stella: DB-IP Lite monatlich aktualisieren

[Timer]
OnCalendar=*-*-03 04:15:00
Persistent=true

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now stella-geoip.timer >/dev/null
systemctl start stella-geoip.service || echo "DB-IP Lite konnte nicht geladen werden – das Wetter ohne Standort nutzt dann die Hauptstadt."
systemctl enable stella >/dev/null
systemctl restart stella

log "Caddy ($DOMAIN → 127.0.0.1:$PORT)"
NAMES="$DOMAIN"
for a in $ALIASES; do NAMES="$NAMES, $a"; done
BLOCK="# stella-begin
$NAMES {
	encode zstd gzip
	reverse_proxy 127.0.0.1:$PORT
}

# Anmelde-Links: nur die Link-Seite und die Apple-Datei sind unter diesem Namen erreichbar
$LOGIN_HOST {
	encode zstd gzip
	@link path /v/* /.well-known/apple-app-site-association
	handle @link {
		reverse_proxy 127.0.0.1:$PORT
	}
	handle {
		respond \"Not found\" 404
	}
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
