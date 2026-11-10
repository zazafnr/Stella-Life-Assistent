#!/usr/bin/env bash
# Stella liefert sich selbst aus: läuft alle 5 Minuten per systemd-Timer (stella-autodeploy.timer) auf dem VPS.
#
#   1. holt den neuesten Stand von main (öffentliches Repo, kein Schlüssel nötig)
#   2. nichts Neues für den Server (nur Website, Doku, iOS …)? → nur merken, fertig
#   3. wartet, bis die CI („CI“ in GitHub Actions) für genau diesen Commit grün ist; rot → wird nicht ausgeliefert
#   4. packt den Stand wie scripts/deploy-vps.sh nach /root/stella-src und ruft deploy/install-vps.sh auf
#
# Abschalten: STELLA_AUTODEPLOY=off in /etc/stella/autodeploy.env, oder `systemctl disable --now stella-autodeploy.timer`.
# Protokoll: journalctl -u stella-autodeploy
set -euo pipefail

CONF=/etc/stella/autodeploy.env
[[ -f $CONF ]] && . "$CONF"
[[ ${STELLA_AUTODEPLOY:-on} == off ]] && exit 0

REPO=${STELLA_AUTODEPLOY_REPO:-zazafnr/Stella-Life-Assistent}
BRANCH=${STELLA_AUTODEPLOY_BRANCH:-main}
DOMAIN=${STELLA_DOMAIN:?STELLA_DOMAIN fehlt in $CONF}
STATE=/var/lib/stella-autodeploy
GIT=$STATE/repo
SRC=/root/stella-src
# Was den Server betrifft. Alles andere (site/, docs/, ios/, desktop/, dashboard/ …) liefert Cloudflare bzw. GitHub aus.
PATHS=(server shared web web-core deploy scripts package.json package-lock.json tsconfig.base.json)

mkdir -p "$STATE"
exec 9>"$STATE/lock"
flock -n 9 || exit 0

if [[ ! -d $GIT/.git ]]; then
  git clone --quiet --filter=blob:none --no-checkout --branch "$BRANCH" "https://github.com/$REPO.git" "$GIT"
fi
git -C "$GIT" fetch --quiet origin "$BRANCH"
new=$(git -C "$GIT" rev-parse "origin/$BRANCH")
old=$(cat "$STATE/deployed" 2>/dev/null || true)
[[ $new == "$old" ]] && exit 0
[[ -f $STATE/skip-$new ]] && exit 0

if [[ -z $old ]]; then
  # Erster Lauf: der Server läuft schon mit einem Stand, den wir nicht kennen – ab jetzt zählen
  echo "$new" > "$STATE/deployed"; echo "Ausgangsstand gemerkt: ${new:0:7}"; exit 0
fi

if git -C "$GIT" merge-base --is-ancestor "$old" "$new" 2>/dev/null; then
  changed=$(git -C "$GIT" diff --name-only "$old" "$new" -- "${PATHS[@]}")
else
  changed=always # Geschichte umgeschrieben: sicherheitshalber ausliefern
fi
if [[ -z $changed ]]; then
  echo "$new" > "$STATE/deployed"; echo "${new:0:7}: nichts für den Server geändert"; exit 0
fi

# CI-Ergebnis für genau diesen Commit (öffentliche API, ohne Anmeldung)
ci=$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/actions/runs?head_sha=$new&event=push&per_page=30" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=(JSON.parse(s).workflow_runs||[]).filter(w=>w.name==="CI");
      if(!r.length)return console.log("missing");const w=r[0];console.log(w.status!=="completed"?"pending":w.conclusion)})') || ci=unreachable
case $ci in
  success) ;;
  pending|missing|unreachable) echo "${new:0:7}: CI noch nicht fertig ($ci), nächster Versuch in 5 Minuten"; exit 0 ;;
  *) echo "${new:0:7}: CI ist $ci – wird nicht ausgeliefert"; touch "$STATE/skip-$new"; exit 0 ;;
esac

echo "==> Ausliefern ${old:0:7} → ${new:0:7}"
rm -rf "$SRC"; mkdir -p "$SRC"
git -C "$GIT" archive "$new" -- . ':(exclude)desktop' ':(exclude)ios' | tar -x -C "$SRC"
if [[ ${STELLA_EDITION_STUDENTS:-} != off ]]; then
  (cd "$SRC" && STELLA_FETCH_STRIP_GIT=1 bash scripts/fetch-edition.sh) || echo "Edition-Plugin nicht geholt – es läuft das eingebaute Schul-Plugin."
fi
cd "$SRC"
STELLA_DOMAIN=$DOMAIN STELLA_ALIASES=${STELLA_ALIASES:-} STELLA_DEPLOYED_SHA=$new bash deploy/install-vps.sh
systemctl is-active --quiet stella
echo "Fertig: ${new:0:7} läuft"
