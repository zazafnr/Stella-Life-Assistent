#!/usr/bin/env bash
# Lädt die IP-Ortsdatenbank DB-IP Lite (City) in den Datenordner. Monatlich ausführen (cron/systemd-Timer):
#   0 4 3 * *  /opt/stella/scripts/update-geoip.sh
# Quelle und Lizenz: https://db-ip.com/db/download/ip-to-city-lite – CC BY 4.0, Quellenangabe steht in den Datenschutzinfos.
set -euo pipefail
DATA_DIR="${STELLA_DATA_DIR:-$(dirname "$0")/../data}"
TARGET="${STELLA_GEOIP_DB:-$DATA_DIR/geoip/dbip-city-lite.mmdb}"
mkdir -p "$(dirname "$TARGET")"
for offset in 0 1; do
  month="$(date -u -d "-$offset month" +%Y-%m 2>/dev/null || date -u -v-"$offset"m +%Y-%m)"
  url="https://download.db-ip.com/free/dbip-city-lite-$month.mmdb.gz"
  if curl -fsSL --max-time 300 "$url" -o "$TARGET.gz"; then
    gunzip -f "$TARGET.gz"
    echo "DB-IP Lite $month → $TARGET"
    exit 0
  fi
done
echo "DB-IP Lite konnte nicht geladen werden." >&2
exit 1
