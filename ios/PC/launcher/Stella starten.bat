@echo off
rem Stella-Launcher: waehlt Stella oder Stella for Students, holt auf Knopfdruck (oder automatisch)
rem die neueste Version von GitHub, baut sie und startet sie im Simulator.
rem Liegt neben dem Ordner Stella-Life-Assistent. Zum Beenden das Fenster schliessen (beendet auch den Simulator).
title Stella-Launcher

rem Falls dieses Fenster die Swift-Einstellung noch nicht kennt
if not defined SDKROOT set "SDKROOT=%LOCALAPPDATA%\Programs\Swift\Platforms\6.4.2\Windows.platform\Developer\SDKs\Windows.sdk\"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js fehlt: winget install OpenJS.NodeJS.LTS
    pause
    exit /b 1
)

set "LAUNCHER=%~dp0Stella-Life-Assistent\ios\PC\launcher\launcher.mjs"
if not exist "%LAUNCHER%" (
    echo Launcher nicht gefunden: %LAUNCHER%
    pause
    exit /b 1
)

node "%LAUNCHER%"
if errorlevel 1 pause
