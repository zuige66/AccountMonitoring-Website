@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

title Gate Pulse Launcher

echo ==========================================
echo  Gate Pulse Launcher
echo ==========================================
echo.

rem 1. Check Node.js
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node.js 22.5+ first:
  echo https://nodejs.org/
  echo.
  pause
  exit /b 1
)
for /f "tokens=1 delims=v" %%v in ('node -v') do set NODE_VER=%%v
set "NODE_VER=!NODE_VER: =!"
echo [OK] Node version: v!NODE_VER! (requires ^>^= v22.5)

rem Require Node >= 22.5 for built-in node:sqlite
for /f "tokens=1,2 delims=." %%a in ("!NODE_VER!") do (
  set NODE_MAJOR=%%a
  set NODE_MINOR=%%b
)
if !NODE_MAJOR! LSS 22 (
  echo [ERROR] Node.js too old. node:sqlite requires 22.5+. Please upgrade.
  pause
  exit /b 1
)
if !NODE_MAJOR! EQU 22 if !NODE_MINOR! LSS 5 (
  echo [ERROR] Node.js too old. node:sqlite requires 22.5+. Please upgrade.
  pause
  exit /b 1
)

rem 2. Check server.js exists
if not exist "server.js" (
  echo [ERROR] server.js not found. Put this .bat in the project root folder.
  pause
  exit /b 1
)

rem 3. Create .env from template if missing
if not exist ".env" (
  if exist ".env.example" (
    echo [INFO] .env not found, created from .env.example.
    copy /y ".env.example" ".env" >nul
    echo Edit .env and fill in your Gate API Key, then run this script again.
    echo Press any key to open .env ...
    pause >nul
    notepad ".env"
    pause
    exit /b 0
  ) else (
    echo [WARN] Neither .env nor .env.example found. Starting in demo mode.
  )
)

rem 4. Read PORT from .env (default 4173). Tolerates spaces around key/value.
set PORT=4173
if exist ".env" (
  for /f "usebackq eol=# tokens=1* delims==" %%a in (".env") do (
    set "k=%%a"
    set "v=%%b"
    set "k=!k: =!"
    set "v=!v: =!"
    if /i "!k!"=="PORT" if defined v set "PORT=!v!"
  )
)
rem Strip possible surrounding quotes (outside the block on purpose).
set "PORT=%PORT: =%"
set "PORT=%PORT:"=%"

echo [START] Port: %PORT%. Starting server...
echo Browser will open http://localhost:%PORT%
echo Close this window to stop the server.
echo.

rem 5. Warn if the port is already in use (server may already be running).
netstat -ano | findstr /r /c:":%PORT% .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo [WARN] Port %PORT% is already in use. The server may already be running.
  echo If the browser does not open, visit http://localhost:%PORT% directly,
  echo or stop the program using this port and try again.
  echo.
)

rem 6. Open the browser after a 3s delay, in the background.
start /min "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://localhost:%PORT%'"

rem 7. Start the app (no third-party deps, same as npm start).
node server.js
if errorlevel 1 (
  echo.
  echo [ERROR] Start failed. Common causes: port in use / Node below 22.5 / bad .env.
  pause
  exit /b 1
)

echo.
echo Server stopped. Press any key to close.
pause >nul
