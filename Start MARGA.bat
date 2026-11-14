@echo off
setlocal
title MARGA - Mars Adaptive Route Guidance
cd /d "%~dp0"

rem --- Find Node.js -------------------------------------------------------------------------
rem winget installs Node per user; a window opened before the install may not see it on PATH yet.
where node >nul 2>nul
if errorlevel 1 (
  for /d %%D in ("%LOCALAPPDATA%\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_*") do (
    for /d %%N in ("%%D\node-v*") do set "PATH=%%N;%PATH%"
  )
)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed. Install it with this command, then run this file again:
  echo.
  echo      winget install OpenJS.NodeJS.LTS
  echo.
  echo  or download the LTS installer from https://nodejs.org
  echo.
  pause
  exit /b 1
)

rem --- First run: install the frontend's packages --------------------------------------------
if not exist "frontend\node_modules\" (
  echo Installing frontend packages - first run only, this takes about a minute...
  call npm --prefix frontend install --no-fund --no-audit
  if errorlevel 1 (
    echo.
    echo  Package install failed. Check your internet connection and run this file again.
    pause
    exit /b 1
  )
)

rem --- Start the app -------------------------------------------------------------------------
echo.
echo  Starting MARGA. Your browser will open automatically (usually http://localhost:3000).
echo  Keep this window open while you use the app; close it to stop MARGA.
echo.
call npm --prefix frontend run dev
pause
