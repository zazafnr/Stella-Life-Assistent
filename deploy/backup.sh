#!/usr/bin/env sh
# Tägliches Backup der Datenbank (per cron: 0 3 * * * /pfad/deploy/backup.sh)
set -eu
mkdir -p "$HOME/stella-backups"
docker compose -f "$(dirname "$0")/docker-compose.yml" exec -T stella \
  node -e "require('better-sqlite3')('/data/stella.db').backup('/data/backup.db').then(()=>process.exit(0))"
docker compose -f "$(dirname "$0")/docker-compose.yml" cp stella:/data/backup.db "$HOME/stella-backups/stella-$(date +%F).db"
find "$HOME/stella-backups" -name 'stella-*.db' -mtime +30 -delete
