#!/usr/bin/env bash
# Stella (oder Stella for Students) am PC bauen und starten – Linux und macOS.
# Unter Windows: scripts/stella-pc.ps1 (gleiche Optionen).
#
#   ios/PC/scripts/stella-pc.sh                        Stella, gegen den echten Server (Anmeldung wie am iPhone)
#   ios/PC/scripts/stella-pc.sh --demo                 Stella offline: lokaler Server mit Beispieldaten
#   ios/PC/scripts/stella-pc.sh students [--demo]      Stella for Students (Repo daneben: ../Stella-for-Students)
#   ios/PC/scripts/stella-pc.sh students --repo PFAD   Students-Repo woanders
#   … --build-only | --release
#   … -- -tab chat -open weekplan                      alles nach "--" geht an die App
set -euo pipefail
PC="$(cd "$(dirname "$0")/.." && pwd)"
STELLA_REPO="$(cd "$PC/../.." && pwd)"
APP=stella
case "${1:-}" in stella|life|students) APP="$1"; shift ;; esac
REPO=""; BUILD_ONLY=0; CONFIG=debug; DEMO=0; APP_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --build-only) BUILD_ONLY=1; shift ;;
    --release) CONFIG=release; shift ;;
    --demo) DEMO=1; shift ;;
    --) shift; APP_ARGS=("$@"); break ;;
    *) echo "Unbekannt: $1"; exit 2 ;;
  esac
done
case "$APP" in
  stella|life)
    ROOT="${REPO:-$STELLA_REPO}"; SRC="$ROOT/ios/Stella.swiftpm"; NAME=Stella; TITLE="Stella"; BUNDLE=app.stella.ios; DEMO_PORT=8790 ;;
  students)
    ROOT="${REPO:-$(dirname "$STELLA_REPO")/Stella-for-Students}"; SRC="$ROOT/ios/StellaStudents.swiftpm"; NAME=StellaStudents; TITLE="Stella for Students"; BUNDLE=app.stella.students.ios; DEMO_PORT=8791 ;;
esac
[ -d "$SRC" ] || { echo "App-Quellen nicht gefunden: $SRC (Pfad mit --repo angeben)"; exit 1; }
command -v swift >/dev/null || { echo "Swift fehlt: https://www.swift.org/install"; exit 1; }

WORK="$PC/.work/$NAME"
OUT="$WORK/Sources/$NAME"
mkdir -p "$OUT"
cat > "$WORK/Package.swift" <<PKG
// swift-tools-version: 5.9
// Erzeugt von ios/PC/scripts/stella-pc – nicht von Hand ändern.
import PackageDescription
let package = Package(
    name: "$NAME",
    dependencies: [.package(path: "../..")],
    targets: [.executableTarget(name: "$NAME", dependencies: [.product(name: "StellaPC", package: "PC")], path: "Sources/$NAME")]
)
PKG
# Quellen spiegeln: nur geänderte Dateien neu schreiben, damit der Build schnell bleibt.
# Zwei Anpassungen: die Bundle-ID (erkennt Stella/Students) und eine iOS-Einstellung, die es am PC nicht gibt.
TMP="$(mktemp -d)"
for d in App Core Design Views; do
  [ -d "$SRC/$d" ] || continue
  while IFS= read -r -d '' f; do
    rel="${f#"$SRC"/}"; dst="$TMP/${rel//\//_}"
    sed -e 's/Bundle\.main\.bundleIdentifier/Bundle._pcBundleIdentifier/g' -e 's/\.waitsForConnectivity = /._pcIgnored = /g' "$f" > "$dst"
  done < <(find "$SRC/$d" -name '*.swift' -print0)
done
printf '// Erzeugt: Bundle-ID der PC-Version\nimport Foundation\nextension Bundle { static var _pcBundleIdentifier: String? { "%s" } }\n' "$BUNDLE" > "$TMP/_PCBundle.swift"
for f in "$TMP"/*.swift; do b="$(basename "$f")"; cmp -s "$f" "$OUT/$b" || cp "$f" "$OUT/$b"; done
for f in "$OUT"/*.swift; do [ -e "$TMP/$(basename "$f")" ] || rm -f -- "$f"; done
rm -rf -- "$TMP"

echo "Baue $TITLE ($CONFIG) …"
( cd "$WORK" && swift build -c "$CONFIG" --product "$NAME" )
BIN="$WORK/.build/$CONFIG/$NAME"
[ "$BUILD_ONLY" = 1 ] && { echo "Fertig: $BIN"; exit 0; }
export STELLA_PC_TITLE="$TITLE"

if [ "$DEMO" = 1 ]; then
  # Offline: echter Stella-Server auf diesem Rechner, mit denselben Beispieldaten wie die iOS-Vorschau
  command -v npm >/dev/null || { echo "Für --demo braucht es Node.js 22: https://nodejs.org"; exit 1; }
  DATA="$PC/.work/demo-$NAME"
  mkdir -p "$DATA"
  export STELLA_DATA_DIR="$DATA/data" STELLA_SECRET="pc-demo-nur-lokal"
  if [ ! -d "$ROOT/node_modules" ]; then echo "Installiere die Server-Pakete (einmalig) …"; ( cd "$ROOT" && PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci --no-audit --no-fund ); fi
  if [ ! -s "$DATA/token" ]; then
    echo "Lege Beispieldaten an (einmalig) …"
    mkdir -p "$STELLA_DATA_DIR"
    if [ "$APP" = students ]; then ( cd "$ROOT" && npx tsx scripts/demo-seed.mts > "$DATA/token" ); else ( cd "$ROOT" && npx tsx server/scripts/demo-seed.ts > "$DATA/token" ); fi
  fi
  if [ "$APP" = students ]; then SERVER_DIR="$ROOT/core/server"; export STELLA_EDITION_STUDENTS="$ROOT/server-plugin"; else SERVER_DIR="$ROOT/server"; fi
  ( cd "$SERVER_DIR" && PORT=$DEMO_PORT HOST=127.0.0.1 npx tsx src/main.ts > "$DATA/server.log" 2>&1 ) &
  SERVER_PID=$!
  trap 'kill $SERVER_PID 2>/dev/null; pkill -P $SERVER_PID 2>/dev/null || true' EXIT
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$DEMO_PORT/api/status" >/dev/null && break; sleep 1; done
  curl -sf "http://127.0.0.1:$DEMO_PORT/api/status" >/dev/null || { echo "Demo-Server startet nicht, siehe $DATA/server.log"; exit 1; }
  echo "Demo-Server läuft auf http://127.0.0.1:$DEMO_PORT"
  "$BIN" -server "http://127.0.0.1:$DEMO_PORT" -demoToken "$(cat "$DATA/token")" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
else
  exec "$BIN" ${APP_ARGS[@]+"${APP_ARGS[@]}"}
fi
