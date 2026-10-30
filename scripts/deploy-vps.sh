#!/usr/bin/env bash
# Stella auf den VPS ausliefern, über den Ops-Agent (Repo zazafnr/coinchecker, CLI deploy/ops).
#
#   OPS=/pfad/zu/coinchecker/deploy/ops scripts/deploy-vps.sh
#
# Ablauf: Code (ohne desktop/ und ios/) als tar → Base64 → 100-KB-Teile → hochladen →
# auf dem VPS zusammensetzen, Prüfsumme vergleichen, nach /root/stella-src entpacken →
# deploy/install-vps.sh asynchron starten → warten → systemctl is-active stella.
# Es kommen keine Schlüssel oder Tokens vor: den Token hängt der Proxy an.
set -euo pipefail

OPS=${OPS:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/coinchecker/deploy/ops}
DOMAIN=${STELLA_DOMAIN:-stella.evolsior.com}
# die frühere Adresse bleibt als Zweitname erreichbar (ältere App-Versionen, Kurzbefehle)
ALIASES=${STELLA_ALIASES-stella.5-189-157-214.sslip.io}
UPLOAD=/root/stella-upload
SRC=/root/stella-src
CHUNK=${CHUNK_BYTES:-100000}

[[ -x $OPS ]] || { echo "deploy/ops nicht gefunden: $OPS (Variable OPS setzen)" >&2; exit 2; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

echo "==> Code packen (HEAD, ohne desktop/ und ios/)"
git archive HEAD -- . ':(exclude)desktop' ':(exclude)ios' > "$work/stella.tar"
sum=$(sha256sum "$work/stella.tar" | cut -d' ' -f1)
base64 -w0 "$work/stella.tar" > "$work/stella.b64"
split -b "$CHUNK" -d -a 4 "$work/stella.b64" "$work/part-"
parts=$(ls "$work"/part-* | wc -l)
echo "    $(stat -c%s "$work/stella.tar") Bytes, $parts Teile, sha256 $sum"

echo "==> Hochladen nach $UPLOAD"
"$OPS" exec "rm -rf $UPLOAD && mkdir -p $UPLOAD" >/dev/null
n=0
for f in "$work"/part-*; do
  "$OPS" put "$UPLOAD/$(basename "$f")" --from "$f" >/dev/null
  n=$((n + 1))
  (( n % 10 == 0 )) && echo "    $n/$parts"
done

echo "==> Zusammensetzen und prüfen"
"$OPS" exec "cd $UPLOAD && cat part-* | base64 -d > stella.tar && [ \"\$(sha256sum stella.tar | cut -d' ' -f1)\" = \"$sum\" ] && echo Prüfsumme-ok" \
  | grep -q 'Prüfsumme-ok' || { echo "Prüfsumme stimmt nicht – Abbruch." >&2; exit 1; }
"$OPS" exec "rm -rf $SRC && mkdir -p $SRC && tar -xf $UPLOAD/stella.tar -C $SRC && rm -rf $UPLOAD" >/dev/null

echo "==> Installieren (asynchron)"
resp=$("$OPS" exec "cd $SRC && STELLA_DOMAIN=$DOMAIN STELLA_ALIASES=\"$ALIASES\" bash deploy/install-vps.sh" --async)
job=$(node -e 'const d=JSON.parse(process.argv[1]);console.log(d.job_id||(d.result&&d.result.job_id)||"")' "$resp")
[[ -n $job ]] || { echo "Keine Job-Id erhalten: $resp" >&2; exit 1; }
"$OPS" job "$job" --wait || { echo "Installation fehlgeschlagen (Job $job)." >&2; exit 1; }

echo "==> Prüfen"
state=$("$OPS" exec 'systemctl is-active stella' || true)
echo "    stella: $state"
[[ $state == active* ]] || { "$OPS" exec 'journalctl -u stella -n 40 --no-pager' || true; exit 1; }
echo "Fertig: https://$DOMAIN"
