# Stella (oder Stella for Students) am PC bauen und starten – Windows.
#
#   .\ios\PC\scripts\stella-pc.ps1                         Stella, gegen den echten Server (Anmeldung wie am iPhone)
#   .\ios\PC\scripts\stella-pc.ps1 -Demo                   Stella offline: lokaler Server mit Beispieldaten
#   .\ios\PC\scripts\stella-pc.ps1 students [-Demo]        Stella for Students (Repo daneben: ..\Stella-for-Students)
#   .\ios\PC\scripts\stella-pc.ps1 students -Repo C:\Pfad  Students-Repo woanders
#   ... -BuildOnly | -Release
#   ... -AppArgs '-tab','chat'                             weitere Startargumente für die App
#
# Braucht: Swift für Windows (winget install Swift.Toolchain) samt Visual Studio Build Tools,
# für -Demo zusätzlich Node.js 22 (winget install OpenJS.NodeJS.LTS).
param(
    [ValidateSet('stella', 'life', 'students')][string]$App = 'stella',
    [string]$Repo = '',
    [switch]$Demo,
    [switch]$BuildOnly,
    [switch]$Release,
    [string[]]$AppArgs = @()
)
$ErrorActionPreference = 'Stop'
$PC = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$StellaRepo = (Resolve-Path (Join-Path $PC '..\..')).Path

if ($App -eq 'students') {
    $Root = if ($Repo) { $Repo } else { Join-Path (Split-Path $StellaRepo -Parent) 'Stella-for-Students' }
    $Src = Join-Path $Root 'ios\StellaStudents.swiftpm'; $Name = 'StellaStudents'; $Title = 'Stella for Students'; $Bundle = 'app.stella.students.ios'; $DemoPort = 8791
} else {
    $Root = if ($Repo) { $Repo } else { $StellaRepo }
    $Src = Join-Path $Root 'ios\Stella.swiftpm'; $Name = 'Stella'; $Title = 'Stella'; $Bundle = 'app.stella.ios'; $DemoPort = 8790
}
if (-not (Test-Path $Src)) { throw "App-Quellen nicht gefunden: $Src (Pfad mit -Repo angeben)" }
if (-not (Get-Command swift -ErrorAction SilentlyContinue)) { throw 'Swift fehlt: winget install Swift.Toolchain (danach ein neues Terminal öffnen)' }

$Utf8 = New-Object System.Text.UTF8Encoding($false)
$Work = Join-Path $PC ".work\$Name"
$Out = Join-Path $Work "Sources\$Name"
New-Item -ItemType Directory -Force -Path $Out | Out-Null

$pkg = @"
// swift-tools-version: 5.9
// Erzeugt von ios/PC/scripts/stella-pc – nicht von Hand ändern.
import PackageDescription
let package = Package(
    name: "$Name",
    dependencies: [.package(path: "../..")],
    targets: [.executableTarget(name: "$Name", dependencies: [.product(name: "StellaPC", package: "PC")], path: "Sources/$Name")]
)
"@
[IO.File]::WriteAllText((Join-Path $Work 'Package.swift'), $pkg, $Utf8)

# Quellen spiegeln: nur geänderte Dateien neu schreiben, damit der Build schnell bleibt.
# Zwei Anpassungen: die Bundle-ID (erkennt Stella/Students) und eine iOS-Einstellung, die es am PC nicht gibt.
$wanted = @{}
foreach ($d in 'App', 'Core', 'Design', 'Views') {
    $dir = Join-Path $Src $d
    if (-not (Test-Path $dir)) { continue }
    Get-ChildItem -Path $dir -Recurse -Filter '*.swift' | ForEach-Object {
        $rel = $_.FullName.Substring($Src.Length + 1) -replace '[\\/]', '_'
        $text = [IO.File]::ReadAllText($_.FullName)
        $text = $text.Replace('Bundle.main.bundleIdentifier', 'Bundle._pcBundleIdentifier').Replace('.waitsForConnectivity = ', '._pcIgnored = ')
        $wanted[$rel] = $text
    }
}
$wanted['_PCBundle.swift'] = "// Erzeugt: Bundle-ID der PC-Version`nimport Foundation`nextension Bundle { static var _pcBundleIdentifier: String? { `"$Bundle`" } }`n"
foreach ($k in $wanted.Keys) {
    $dst = Join-Path $Out $k
    if (-not (Test-Path $dst) -or [IO.File]::ReadAllText($dst) -ne $wanted[$k]) { [IO.File]::WriteAllText($dst, $wanted[$k], $Utf8) }
}
Get-ChildItem -Path $Out -Filter '*.swift' | Where-Object { -not $wanted.ContainsKey($_.Name) } | Remove-Item

$config = if ($Release) { 'release' } else { 'debug' }
Write-Host "Baue $Title ($config) ..."
Push-Location $Work
try {
    swift build -c $config --product $Name
    if ($LASTEXITCODE -ne 0) { throw 'Build fehlgeschlagen' }
    $bin = Join-Path (swift build -c $config --show-bin-path) "$Name.exe"
} finally { Pop-Location }
if ($BuildOnly) { Write-Host "Fertig: $bin"; return }
$env:STELLA_PC_TITLE = $Title

if (-not $Demo) { & $bin @AppArgs; return }

# Offline: echter Stella-Server auf diesem Rechner, mit denselben Beispieldaten wie die iOS-Vorschau
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { throw 'Für -Demo braucht es Node.js 22: winget install OpenJS.NodeJS.LTS' }
$Data = Join-Path $PC ".work\demo-$Name"
New-Item -ItemType Directory -Force -Path (Join-Path $Data 'data') | Out-Null
$env:STELLA_DATA_DIR = Join-Path $Data 'data'
$env:STELLA_SECRET = 'pc-demo-nur-lokal'
$env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = '1'
if (-not (Test-Path (Join-Path $Root 'node_modules'))) {
    Write-Host 'Installiere die Server-Pakete (einmalig) ...'
    Push-Location $Root; try { npm ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw 'npm ci fehlgeschlagen' } } finally { Pop-Location }
}
$tokenFile = Join-Path $Data 'token'
if (-not (Test-Path $tokenFile) -or (Get-Item $tokenFile).Length -eq 0) {
    Write-Host 'Lege Beispieldaten an (einmalig) ...'
    $seed = if ($App -eq 'students') { 'scripts/demo-seed.mts' } else { 'server/scripts/demo-seed.ts' }
    Push-Location $Root
    try { $token = (npx tsx $seed | Select-Object -Last 1).Trim() } finally { Pop-Location }
    [IO.File]::WriteAllText($tokenFile, $token, $Utf8)
}
$token = [IO.File]::ReadAllText($tokenFile).Trim()
if ($App -eq 'students') { $serverDir = Join-Path $Root 'core\server'; $env:STELLA_EDITION_STUDENTS = Join-Path $Root 'server-plugin' } else { $serverDir = Join-Path $Root 'server' }
$env:PORT = "$DemoPort"; $env:HOST = '127.0.0.1'
$log = Join-Path $Data 'server.log'
$server = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "npx tsx src/main.ts > `"$log`" 2>&1" -WorkingDirectory $serverDir -WindowStyle Hidden -PassThru
try {
    $up = $false
    for ($i = 0; $i -lt 40 -and -not $up; $i++) {
        try { Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$DemoPort/api/status" -TimeoutSec 2 | Out-Null; $up = $true } catch { Start-Sleep -Seconds 1 }
    }
    if (-not $up) { throw "Demo-Server startet nicht, siehe $log" }
    Write-Host "Demo-Server läuft auf http://127.0.0.1:$DemoPort"
    & $bin -server "http://127.0.0.1:$DemoPort" -demoToken $token @AppArgs
} finally {
    # Server samt Kindprozessen beenden
    & taskkill.exe /PID $server.Id /T /F | Out-Null
}
