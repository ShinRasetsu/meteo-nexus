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

:: Prevent the deployment script itself from being pushed to the remote repository
echo [INFO] Excluding deployment script from staging...
:: 1. Unstage the file if it was added
git reset HEAD "%~nx0" >nul 2>&1
:: 2. Drop it from the tracking index completely if it was previously committed
git rm --cached "%~nx0" >nul 2>&1

:: Check for staged changes only (ignore untracked deploy.bat after exclusion above)
git diff --cached --quiet
if !ERRORLEVEL! NEQ 0 (
    echo [INFO] Committing changes...
    git commit -m "%COMMIT_MSG%"
    if !ERRORLEVEL! NEQ 0 (
        echo [FATAL] Commit operation failed.
        pause
        exit /b 1
    )
) else (
    echo [INFO] No staged changes to commit locally.
)

:: Synchronize with remote state now that the local working tree is clean
echo [INFO] Synchronizing with remote state...
git pull origin %BRANCH% --rebase
if !ERRORLEVEL! NEQ 0 (
    echo [FATAL] Pull failed. Resolve network issues or merge conflicts before proceeding.
    pause
    exit /b 1
)

:: Execute push payload regardless of whether new local files were added this specific run
echo [INFO] Pushing payload to origin/%BRANCH%...
git push origin %BRANCH%
if !ERRORLEVEL! NEQ 0 (
    echo [FATAL] Push failed. Verify network connection and repository permissions.
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Synchronization complete.
timeout /t 3 >nul

ENDLOCAL