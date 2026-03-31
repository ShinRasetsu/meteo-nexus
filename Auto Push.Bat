@echo off
SETLOCAL ENABLEDELAYEDEXPANSION

:: --- CONFIGURATION ---
:: Target branch (change if using 'master' instead of 'main')
SET BRANCH=main

:: Set working directory to the script's current location
SET REPO_DIR=%~dp0
cd /d "%REPO_DIR%"

echo [INFO] Initializing automated GitHub sync for: %REPO_DIR%

:: --- VERIFICATION ---
git status >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Target directory is not a valid Git repository.
    echo Ensure this script is placed inside your cloned repository.
    timeout /t 5 >nul
    exit /b 1
)

:: --- TIMESTAMP GENERATION ---
:: Extracts system date and time for automated commit messaging
for /f "tokens=2-4 delims=/ " %%a in ('date /t') do (set mydate=%%c-%%a-%%b)
for /f "tokens=1-2 delims=/:" %%a in ("%TIME%") do (set mytime=%%a:%%b)
SET COMMIT_MSG=Auto-update telemetry build: %mydate% %mytime%

:: --- GIT PIPELINE ---
echo [INFO] Staging modified files...
git add .

echo [INFO] Committing changes...
git commit -m "%COMMIT_MSG%"

echo [INFO] Pushing payload to origin/%BRANCH%...
git push origin %BRANCH%

:: --- ERROR HANDLING ---
if %ERRORLEVEL% EQU 0 (
    echo.
    echo [SUCCESS] Synchronization complete.
    timeout /t 3 >nul
) else (
    echo.
    echo [FATAL] Push failed. Verify network connection and branch parity.
    pause
)

ENDLOCAL