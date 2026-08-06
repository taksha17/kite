@echo off
REM Kite Enterprise (Server Edition) — run on the parent/office PC.
REM Child PCs open a browser to http://THIS-PC-IP:8080 (any OS).
setlocal
cd /d "%~dp0"
if not exist "kite-data" mkdir kite-data
echo.
echo  Kite Enterprise starting...
echo  Open http://localhost:8080 on this PC.
echo  From other PCs on the LAN use http://%COMPUTERNAME%:8080 or this PC's IP.
echo  Press Ctrl+C to stop.
echo.
kite-server.exe serve --data-dir "%~dp0kite-data" --web-dir "%~dp0dist" --host 0.0.0.0 --port 8080
endlocal
