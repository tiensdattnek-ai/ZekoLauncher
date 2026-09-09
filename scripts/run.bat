@echo off
REM -------------------------------------------------------------
REM  Zeko Launcher - script khoi dong (Windows)
REM -------------------------------------------------------------
setlocal
cd /d "%~dp0\.."

if "%ZEKO_PORT%"=="" set ZEKO_PORT=4179

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Can Node.js 18 tro len. Tai tai https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\express" (
  echo -^> Cai phu thuoc lan dau...
  call npm install --no-audit --no-fund
)

echo -^> Khoi dong Zeko Launcher tai http://localhost:%ZEKO_PORT%
start "" http://localhost:%ZEKO_PORT%
node server\index.js
endlocal
